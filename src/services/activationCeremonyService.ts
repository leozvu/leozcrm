import { canonicalStringify } from '../domain/businessMemory';
import {
  ActivationCeremonyError,
  activationCeremonyCredentialMatches,
  activationCeremonyFingerprint,
  activationCeremonyPolicyIsActive,
} from '../domain/activationCeremony';
import {
  ActivationCeremonyPolicyManifest,
  validateActivationCeremonyPolicy,
} from '../domain/activationCeremonyPolicy';
import { PHASE6_EVIDENCE_MATRIX } from '../domain/externalEvidencePolicy';
import { actionActor, actionHash, actionIdempotencyKey, actionIso } from '../domain/supervisedAction';
import { ActionAdapterRegistry } from '../integrations/actions/actionAdapterRegistry';
import { ActivationCeremonyRepository } from '../repositories/activationCeremonyRepository';
import { ExternalEvidenceService } from './externalEvidenceService';

type FoundPolicy = Awaited<ReturnType<ActivationCeremonyRepository['findPolicy']>>;
type Phase6Readiness = Awaited<ReturnType<ExternalEvidenceService['readiness']>>;

export class ActivationCeremonyService {
  constructor(
    private readonly repository: ActivationCeremonyRepository,
    private readonly phase6: ExternalEvidenceService,
    private readonly productionRegistry: ActionAdapterRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async acceptPolicy(input: unknown, authorityCredential: string) {
    const initial = validateActivationCeremonyPolicy(input);
    if (!initial.ok || !initial.value) {
      throw new ActivationCeremonyError('invalid_activation_policy', initial.issues.join('; '), 400);
    }
    const phase6 = await this.repository.findPhase6Policy(initial.value.phase6.policy_id);
    const validation = validateActivationCeremonyPolicy(
      input,
      phase6.manifest,
      phase6.phase5.manifest,
      phase6.phase5.g7.manifest,
      phase6.phase5.g7.g6.manifest,
    );
    if (!validation.ok || !validation.value || !validation.fingerprint) {
      throw new ActivationCeremonyError('invalid_activation_policy', validation.issues.join('; '), 400);
    }
    const policy = validation.value;
    this.assertRegistryEmpty();
    this.assertActive(policy);
    this.assertIdentity(
      policy.identities.ceremony_authority,
      policy.identities.authority_credential_sha256,
      policy.approved_by,
      authorityCredential,
      'activation_authority',
    );
    const current = await this.assertCurrentPhase6({ record: null, manifest: policy, phase6 });
    return this.repository.recordPolicy({
      manifest: policy,
      phase6,
      expectedEvidence: this.evidenceRows(current.readiness),
    });
  }

  async createDossier(input: {
    policyId: string;
    dossierKey: string;
    actor: string;
    authorityCredential: string;
  }) {
    const found = await this.repository.findPolicy(input.policyId);
    this.assertAuthority(found.manifest, input.actor, input.authorityCredential);
    const dossierKey = actionIdempotencyKey(input.dossierKey);
    const existing = await this.repository.findDossierIfExists(found.record.id, dossierKey);
    if (existing) return existing.record;
    const current = await this.assertCurrentPhase6(found);
    const createdAt = actionIso(this.now());
    const evidence = this.evidenceRows(current.readiness);
    return this.repository.recordDossier({
      policy: found.record,
      dossierKey,
      createdBy: actionActor(input.actor, 'invalid_activation_actor'),
      facts: {
        created_at: createdAt,
        phase6_assessed_at: current.assessment.assessed_at,
        phase6_evidence_set_fingerprint: current.readiness.evidence_set_fingerprint,
        evidence,
        deployment_id: found.manifest.target.deployment_id,
        target_fingerprint: found.manifest.target.target_fingerprint,
        target_contract_fingerprint: activationCeremonyFingerprint(found.manifest.target),
        canary_contract_fingerprint: activationCeremonyFingerprint(found.manifest.canary),
        rollback_contract_fingerprint: activationCeremonyFingerprint(found.manifest.rollback),
      },
    });
  }

  async verifyDossier(input: {
    policyId: string;
    dossierKey: string;
    verificationKey: string;
    decision: 'approved' | 'rejected';
    reasonCode: string;
    actor: string;
    verifierCredential: string;
  }) {
    const found = await this.repository.findPolicy(input.policyId);
    this.assertVerifier(found.manifest, input.actor, input.verifierCredential);
    this.assertRegistryEmpty();
    this.assertActive(found.manifest);
    const dossier = await this.repository.findDossier(found.record.id, input.dossierKey);
    const existing = await this.repository.findVerificationIfExists(dossier.record.id);
    if (existing) {
      if (
        existing.verification_key !== actionIdempotencyKey(input.verificationKey)
        || existing.decision !== input.decision
        || existing.reason_code !== input.reasonCode
      ) throw new ActivationCeremonyError('activation_dossier_already_verified', 'dossier already has a different verification');
      return existing;
    }
    if (input.decision !== 'approved' && input.decision !== 'rejected') {
      throw new ActivationCeremonyError('invalid_activation_decision', 'decision must be approved or rejected', 400);
    }
    if (input.decision === 'approved') await this.assertCurrentPhase6(found);
    const verifiedAt = actionIso(this.now());
    const expiresAt = new Date(
      Date.parse(verifiedAt) + found.manifest.limits.max_verification_age_minutes * 60_000,
    ).toISOString();
    return this.repository.recordVerification({
      policy: found.record,
      dossier: dossier.record,
      verificationKey: input.verificationKey,
      decision: input.decision,
      reasonCode: input.reasonCode,
      verifiedBy: input.actor,
      verifiedAt,
      expiresAt,
    });
  }

  async sealHandoff(input: {
    policyId: string;
    dossierKey: string;
    handoffKey: string;
    actor: string;
    operatorCredential: string;
  }) {
    const found = await this.repository.findPolicy(input.policyId);
    this.assertOperator(found.manifest, input.actor, input.operatorCredential);
    const handoffKey = actionIdempotencyKey(input.handoffKey);
    const dossier = await this.repository.findDossier(found.record.id, input.dossierKey);
    const existing = await this.repository.findHandoffIfExists(found.record.id, handoffKey);
    if (existing) {
      if (existing.dossier_id !== dossier.record.id) {
        throw new ActivationCeremonyError('activation_handoff_conflict', 'handoff key already binds a different dossier');
      }
      return existing;
    }
    this.assertRegistryEmpty();
    this.assertActive(found.manifest);
    const verification = await this.repository.findVerification(dossier.record.id);
    if (verification.decision !== 'approved') {
      throw new ActivationCeremonyError('activation_dossier_not_approved', 'rejected dossier cannot be sealed');
    }
    const sealedAt = actionIso(this.now());
    if (Date.parse(verification.expires_at) <= Date.parse(sealedAt)) {
      throw new ActivationCeremonyError('activation_verification_expired', 'dossier verification has expired');
    }
    const current = await this.assertCurrentPhase6(found);
    if (current.readiness.evidence_set_fingerprint !== dossier.facts.phase6_evidence_set_fingerprint) {
      throw new ActivationCeremonyError('phase6_evidence_set_changed', 'Phase 6 evidence changed after dossier creation');
    }
    return this.repository.recordHandoff({
      policy: found.record,
      dossier: dossier.record,
      verification,
      handoffKey,
      evidenceSetFingerprint: current.readiness.evidence_set_fingerprint,
      expectedEvidence: dossier.facts.evidence,
      sealedBy: input.actor,
      sealedAt,
    });
  }

  async recallHandoff(input: {
    policyId: string;
    recallKey: string;
    reasonCode: string;
    evidenceFingerprint: string;
    authorityActor: string;
    authorityCredential: string;
    verifierActor: string;
    verifierCredential: string;
  }) {
    const found = await this.repository.findPolicy(input.policyId);
    this.assertAuthority(found.manifest, input.authorityActor, input.authorityCredential);
    this.assertVerifier(found.manifest, input.verifierActor, input.verifierCredential);
    const handoff = await this.repository.latestHandoff(found.record.id);
    if (!handoff) throw new ActivationCeremonyError('missing_activation_handoff', 'no sealed handoff exists', 404);
    const existing = await this.repository.findRecallIfExists(handoff.id);
    if (existing) {
      if (
        existing.recall_key !== actionIdempotencyKey(input.recallKey)
        || existing.reason_code !== input.reasonCode
        || existing.evidence_fingerprint !== actionHash(input.evidenceFingerprint, 'invalid_activation_evidence')
      ) throw new ActivationCeremonyError('activation_handoff_already_recalled', 'handoff already has a different recall');
      return existing;
    }
    return this.repository.recordRecall({
      policy: found.record,
      handoff,
      recallKey: input.recallKey,
      reasonCode: input.reasonCode,
      evidenceFingerprint: input.evidenceFingerprint,
      recalledBy: input.authorityActor,
      verifiedBy: input.verifierActor,
      recalledAt: actionIso(this.now()),
    });
  }

  async status(policyId: string) {
    const found = await this.repository.findPolicy(policyId);
    const handoff = await this.repository.latestHandoff(found.record.id);
    const recall = handoff ? await this.repository.findRecallIfExists(handoff.id) : null;
    return {
      policy: found.record,
      latest_handoff: handoff,
      recall,
      events: await this.repository.listEvents(found.record.id),
      ceremony_status: recall ? 'recalled' as const : handoff ? 'sealed_external_handoff' as const : 'not_sealed' as const,
      activation_status: 'not_executed' as const,
      external_execution_required: true,
      execution_implemented: false,
      activation_possible: false,
    };
  }

  async readiness(policyId: string) {
    const found = await this.repository.findPolicy(policyId);
    const current = await this.assertCurrentPhase6(found);
    return {
      policy: found.record,
      phase6_assessment: current.assessment,
      phase6_evidence_set_fingerprint: current.readiness.evidence_set_fingerprint,
      evidence_count: current.readiness.matrix.length,
      target_fingerprint: found.manifest.target.target_fingerprint,
      ceremony_status: 'ready_for_local_handoff_ceremony' as const,
      activation_status: 'not_executed' as const,
      external_execution_required: true,
      execution_implemented: false,
      activation_possible: false,
    };
  }

  private async assertCurrentPhase6(found: {
    record: FoundPolicy['record'] | null;
    manifest: ActivationCeremonyPolicyManifest;
    phase6: FoundPolicy['phase6'];
  }): Promise<{ assessment: NonNullable<Awaited<ReturnType<ActivationCeremonyRepository['latestPhase6Assessment']>>>; readiness: Phase6Readiness }> {
    this.assertRegistryEmpty();
    this.assertActive(found.manifest);
    const assessment = await this.repository.latestPhase6Assessment(found.phase6.record.id);
    if (
      !assessment
      || assessment.assessment_fingerprint !== found.manifest.phase6.assessment_fingerprint
      || assessment.policy_fingerprint !== found.manifest.phase6.policy_fingerprint
      || assessment.status !== 'complete_unreleased'
      || assessment.release_status !== 'blocked_external_activation'
    ) throw new ActivationCeremonyError('phase6_assessment_not_current', 'exact complete-unreleased Phase 6 assessment is no longer current');
    const now = this.now().getTime();
    const age = now - Date.parse(assessment.assessed_at);
    if (age < 0 || age > found.manifest.limits.max_phase6_assessment_age_minutes * 60_000) {
      throw new ActivationCeremonyError('phase6_assessment_stale', 'bound Phase 6 assessment is outside the freshness limit');
    }
    const readiness = await this.phase6.readiness(found.manifest.phase6.policy_id);
    if (
      readiness.record.id !== found.phase6.record.id
      || readiness.status !== 'complete_unreleased'
      || readiness.release_status !== 'blocked_external_activation'
      || canonicalStringify(readiness.matrix) !== assessment.matrix_json
      || readiness.attestations.length !== PHASE6_EVIDENCE_MATRIX.length
    ) throw new ActivationCeremonyError('phase6_readiness_changed', 'current Phase 6 readiness no longer matches the bound assessment');
    for (const item of readiness.attestations) {
      if (
        item.envelope.attestation.statement !== 'pass'
        || item.envelope.attestation.subject.deployment_id !== found.manifest.target.deployment_id
        || item.envelope.attestation.subject.target_fingerprint !== found.manifest.target.target_fingerprint
      ) throw new ActivationCeremonyError('phase6_target_binding_changed', 'Phase 6 evidence does not bind the exact activation target');
    }
    return { assessment, readiness };
  }

  private assertRegistryEmpty(): void {
    if (this.productionRegistry.size() !== 0) {
      throw new ActivationCeremonyError('production_registry_not_empty', 'Phase 7 requires the production registry to remain empty');
    }
  }

  private evidenceRows(readiness: Phase6Readiness) {
    return PHASE6_EVIDENCE_MATRIX.map((expected) => {
      const row = readiness.matrix.find((item) => item.evidence_type === expected.evidence_type);
      if (!row?.attestation_id || !row.envelope_fingerprint) {
        throw new ActivationCeremonyError('phase6_matrix_incomplete', 'Phase 6 evidence matrix is incomplete');
      }
      return {
        evidence_type: expected.evidence_type,
        attestation_id: row.attestation_id,
        envelope_fingerprint: row.envelope_fingerprint,
      };
    });
  }

  private assertActive(policy: ActivationCeremonyPolicyManifest): void {
    if (!activationCeremonyPolicyIsActive(policy, actionIso(this.now()))) {
      throw new ActivationCeremonyError('activation_policy_not_active', 'activation-ceremony policy is not active');
    }
  }

  private assertAuthority(policy: ActivationCeremonyPolicyManifest, actor: string, credential: string): void {
    this.assertIdentity(
      policy.identities.ceremony_authority,
      policy.identities.authority_credential_sha256,
      actor,
      credential,
      'activation_authority',
    );
  }

  private assertVerifier(policy: ActivationCeremonyPolicyManifest, actor: string, credential: string): void {
    this.assertIdentity(
      policy.identities.independent_verifier,
      policy.identities.verifier_credential_sha256,
      actor,
      credential,
      'activation_verifier',
    );
  }

  private assertOperator(policy: ActivationCeremonyPolicyManifest, actor: string, credential: string): void {
    this.assertIdentity(
      policy.identities.activation_operator,
      policy.identities.operator_credential_sha256,
      actor,
      credential,
      'activation_operator',
    );
  }

  private assertIdentity(
    expectedActor: string,
    expectedCredential: string,
    actor: string,
    credential: string,
    codePrefix: string,
  ): void {
    if (actor !== expectedActor) {
      throw new ActivationCeremonyError(`${codePrefix}_actor_rejected`, 'actor does not match policy', 403);
    }
    if (!activationCeremonyCredentialMatches(credential, expectedCredential)) {
      throw new ActivationCeremonyError(`${codePrefix}_credential_rejected`, 'credential does not match policy', 403);
    }
  }
}
