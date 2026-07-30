import {
  ExternalEvidenceEnvelope,
  ExternalEvidenceError,
  ExternalEvidenceMatrixRow,
  externalEvidenceCredentialMatches,
  externalEvidencePolicyIsActive,
  validateExternalEvidenceEnvelope,
  verifyExternalEvidenceEnvelope,
} from '../domain/externalEvidence';
import {
  ExternalEvidencePolicyManifest,
  PHASE6_EVIDENCE_MATRIX,
  validateExternalEvidencePolicy,
} from '../domain/externalEvidencePolicy';
import { evaluateOperationalAssurance, operationalAssurancePolicyIsActive } from '../domain/operationalAssurance';
import { g7PolicyIsActive } from '../domain/boundedAutonomy';
import { actionActor, actionIdempotencyKey, actionIso, policyIsActive } from '../domain/supervisedAction';
import { ActionAdapterRegistry } from '../integrations/actions/actionAdapterRegistry';
import { ExternalEvidenceRepository } from '../repositories/externalEvidenceRepository';

export class ExternalEvidenceService {
  constructor(
    private readonly repository: ExternalEvidenceRepository,
    private readonly productionRegistry: ActionAdapterRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async acceptPolicy(input: unknown, authorityCredential: string) {
    const initial = validateExternalEvidencePolicy(input);
    if (!initial.ok || !initial.value) {
      throw new ExternalEvidenceError('invalid_external_evidence_policy', initial.issues.join('; '), 400);
    }
    const phase5 = await this.repository.findPhase5Policy(initial.value.phase5.policy_id);
    const validation = validateExternalEvidencePolicy(
      input,
      phase5.manifest,
      phase5.g7.manifest,
      phase5.g7.g6.manifest,
    );
    if (!validation.ok || !validation.value || !validation.fingerprint) {
      throw new ExternalEvidenceError('invalid_external_evidence_policy', validation.issues.join('; '), 400);
    }
    const policy = validation.value;
    if (!externalEvidenceCredentialMatches(authorityCredential, policy.identities.authority_credential_sha256)) {
      throw new ExternalEvidenceError('external_evidence_authority_credential_rejected', 'trust-authority credential does not match', 403);
    }
    await this.assertUpstream(policy, phase5);
    return this.repository.recordPolicy({ manifest: policy, phase5 });
  }

  async admit(input: {
    policyId: string;
    envelope: unknown;
    actor: string;
    assessorCredential: string;
  }) {
    const found = await this.repository.findPolicy(input.policyId);
    this.assertAssessor(found.manifest, input.actor, input.assessorCredential);
    await this.assertUpstream(found.manifest, found.phase5);
    const validation = validateExternalEvidenceEnvelope(input.envelope, found.manifest);
    if (!validation.ok || !validation.value || !validation.fingerprint) {
      throw new ExternalEvidenceError('invalid_external_attestation', validation.issues.join('; '), 400);
    }
    if (!verifyExternalEvidenceEnvelope(validation.value, found.manifest)) {
      throw new ExternalEvidenceError('external_attestation_signature_rejected', 'attestation signature is invalid', 403);
    }
    this.assertCurrentEnvelope(validation.value, found.manifest, actionIso(this.now()));
    return this.repository.recordAttestation({
      policy: found.record,
      manifest: found.manifest,
      envelope: validation.value,
      envelopeFingerprint: validation.fingerprint,
      admittedBy: actionActor(input.actor, 'invalid_external_evidence_actor'),
      admittedAt: actionIso(this.now()),
    });
  }

  async assess(input: {
    policyId: string;
    assessmentKey: string;
    actor: string;
    assessorCredential: string;
  }) {
    const found = await this.repository.findPolicy(input.policyId);
    this.assertAssessor(found.manifest, input.actor, input.assessorCredential);
    const assessmentKey = actionIdempotencyKey(input.assessmentKey);
    const existing = await this.repository.findAssessmentIfExists(found.record.id, assessmentKey);
    if (existing) return existing;
    await this.assertUpstream(found.manifest, found.phase5);
    const assessedAt = actionIso(this.now());
    const latest = await this.repository.latestAttestations(found.record.id, found.manifest);
    const matrix: ExternalEvidenceMatrixRow[] = PHASE6_EVIDENCE_MATRIX.map((expected) => {
      const item = latest.get(expected.evidence_type);
      if (!item) {
        return { ...expected, status: 'missing', attestation_id: null, envelope_fingerprint: null };
      }
      const attestation = item.envelope.attestation;
      let status: ExternalEvidenceMatrixRow['status'];
      if (attestation.statement === 'revoke') status = 'revoked';
      else if (!this.envelopeIsCurrent(item.envelope, found.manifest, assessedAt)) status = 'expired';
      else status = 'satisfied';
      return {
        ...expected,
        status,
        attestation_id: item.record.attestation_id,
        envelope_fingerprint: item.record.envelope_fingerprint,
      };
    });
    const status = matrix.every((item) => item.status === 'satisfied')
      ? 'complete_unreleased' as const
      : 'incomplete' as const;
    return this.repository.recordAssessment({
      policy: found.record,
      assessmentKey,
      matrix,
      status,
      assessedBy: input.actor,
      assessedAt,
    });
  }

  async status(policyId: string) {
    const found = await this.repository.findPolicy(policyId);
    return {
      policy: found.record,
      latest_assessment: await this.repository.latestAssessment(found.record.id),
      latest_attestations: [...(await this.repository.latestAttestations(found.record.id, found.manifest)).values()]
        .map((item) => item.record),
      events: await this.repository.listEvents(found.record.id),
      matrix_size: PHASE6_EVIDENCE_MATRIX.length,
      release_status: 'blocked_external_activation' as const,
      external_release_possible: false,
      activation_possible: false,
    };
  }

  private async assertUpstream(
    policy: ExternalEvidencePolicyManifest,
    phase5: Awaited<ReturnType<ExternalEvidenceRepository['findPhase5Policy']>>,
  ): Promise<void> {
    if (this.productionRegistry.size() !== 0) {
      throw new ExternalEvidenceError('production_registry_not_empty', 'Phase 6 requires the production registry to remain empty');
    }
    const at = actionIso(this.now());
    if (!externalEvidencePolicyIsActive(policy, at)) {
      throw new ExternalEvidenceError('external_evidence_policy_not_active', 'external-evidence policy is not active');
    }
    if (
      !operationalAssurancePolicyIsActive(phase5.manifest, at)
      || !g7PolicyIsActive(phase5.g7.manifest, at)
      || !policyIsActive(phase5.g7.g6.manifest, at)
    ) throw new ExternalEvidenceError('upstream_policy_not_active', 'bound Phase 5/G7/G6 policy is not active');
    const [assessment, releasePackage, g5] = await Promise.all([
      this.repository.latestPhase5Assessment(phase5.record.id),
      this.repository.latestPhase5ReleasePackage(phase5.record.id),
      this.repository.findLatestG5Decision(phase5.record.tenant_id, phase5.record.source_connection_id),
    ]);
    if (
      !assessment
      || assessment.local_status !== 'pass'
      || assessment.assessment_fingerprint !== policy.phase5.assessment_fingerprint
    ) throw new ExternalEvidenceError('phase5_assessment_binding_changed', 'exact passing Phase 5 assessment is no longer latest');
    if (
      !releasePackage
      || releasePackage.local_status !== 'pass'
      || releasePackage.release_status !== 'blocked_external'
      || releasePackage.assessment_fingerprint !== assessment.assessment_fingerprint
      || releasePackage.package_fingerprint !== policy.phase5.release_package_fingerprint
    ) throw new ExternalEvidenceError('phase5_package_binding_changed', 'exact blocked Phase 5 package is no longer current');
    if (!g5 || g5.id !== phase5.g7.record.g5_release_decision_id || g5.decision !== 'go') {
      throw new ExternalEvidenceError('g5_not_current_go', 'latest G5 decision is not the locally bound go');
    }
    const currentFacts = await this.repository.deriveCurrentPhase5Facts({
      policy: phase5.record,
      windowDays: phase5.manifest.window.days,
      assessedAt: at,
      assurancePolicyActive: operationalAssurancePolicyIsActive(phase5.manifest, at),
      g5CurrentGo: true,
      g6Active: policyIsActive(phase5.g7.g6.manifest, at),
      g7Active: g7PolicyIsActive(phase5.g7.manifest, at),
      simulationPassed: Boolean(phase5.g7.simulation.passed),
      productionRegistrySize: this.productionRegistry.size(),
    });
    if (evaluateOperationalAssurance(phase5.manifest, currentFacts).local_status !== 'pass') {
      throw new ExternalEvidenceError('phase5_state_changed', 'current local Phase 5 assurance state no longer passes');
    }
    let assessedFacts: { event_count?: unknown; event_chain_fingerprint?: unknown };
    try {
      assessedFacts = JSON.parse(assessment.facts_json) as typeof assessedFacts;
    } catch {
      throw new ExternalEvidenceError('corrupt_phase5_assessment', 'bound Phase 5 facts are invalid');
    }
    if (
      assessedFacts.event_count !== currentFacts.event_count
      || assessedFacts.event_chain_fingerprint !== currentFacts.event_chain_fingerprint
    ) throw new ExternalEvidenceError('phase5_event_chain_changed', 'G7 event chain changed after the bound Phase 5 package');
  }

  private assertAssessor(policy: ExternalEvidencePolicyManifest, actor: string, credential: string): void {
    if (actor !== policy.identities.assessor) {
      throw new ExternalEvidenceError('external_evidence_assessor_actor_rejected', 'assessor actor does not match policy', 403);
    }
    if (!externalEvidenceCredentialMatches(credential, policy.identities.assessor_credential_sha256)) {
      throw new ExternalEvidenceError('external_evidence_assessor_credential_rejected', 'assessor credential does not match', 403);
    }
  }

  private assertCurrentEnvelope(
    envelope: ExternalEvidenceEnvelope,
    policy: ExternalEvidencePolicyManifest,
    at: string,
  ): void {
    const attestation = envelope.attestation;
    const now = Date.parse(at);
    const skew = policy.limits.max_clock_skew_seconds * 1_000;
    if (Date.parse(attestation.issued_at) > now + skew) {
      throw new ExternalEvidenceError('attestation_from_future', 'attestation issuance exceeds allowed clock skew');
    }
    if (Date.parse(attestation.expires_at) <= now) {
      throw new ExternalEvidenceError('attestation_expired', 'attestation has expired');
    }
    if (now - Date.parse(attestation.observed_until) > policy.limits.max_attestation_age_hours * 3_600_000) {
      throw new ExternalEvidenceError('attestation_stale', 'attestation observation is stale');
    }
  }

  private envelopeIsCurrent(
    envelope: ExternalEvidenceEnvelope,
    policy: ExternalEvidencePolicyManifest,
    at: string,
  ): boolean {
    try {
      this.assertCurrentEnvelope(envelope, policy, at);
      return verifyExternalEvidenceEnvelope(envelope, policy);
    } catch {
      return false;
    }
  }
}
