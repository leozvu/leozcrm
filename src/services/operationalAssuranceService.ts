import {
  OperationalAssuranceError,
  assuranceCredentialMatches,
  evaluateOperationalAssurance,
  operationalAssurancePolicyIsActive,
} from '../domain/operationalAssurance';
import {
  OperationalAssurancePolicyManifest,
  validateOperationalAssurancePolicy,
} from '../domain/operationalAssurancePolicy';
import { g7PolicyIsActive } from '../domain/boundedAutonomy';
import { actionIdempotencyKey, actionIso, policyIsActive } from '../domain/supervisedAction';
import { ActionAdapterRegistry } from '../integrations/actions/actionAdapterRegistry';
import { OperationalAssuranceRepository } from '../repositories/operationalAssuranceRepository';

export class OperationalAssuranceService {
  constructor(
    private readonly repository: OperationalAssuranceRepository,
    private readonly productionRegistry: ActionAdapterRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async acceptPolicy(input: unknown, authorityCredential: string) {
    const initial = validateOperationalAssurancePolicy(input);
    if (!initial.ok || !initial.value) {
      throw new OperationalAssuranceError('invalid_assurance_policy', initial.issues.join('; '), 400);
    }
    const g7 = await this.repository.findG7Policy(initial.value.g7_policy.policy_id);
    const validation = validateOperationalAssurancePolicy(input, g7.manifest, g7.g6.manifest);
    if (!validation.ok || !validation.value || !validation.fingerprint) {
      throw new OperationalAssuranceError('invalid_assurance_policy', validation.issues.join('; '), 400);
    }
    const policy = validation.value;
    if (!assuranceCredentialMatches(authorityCredential, policy.identities.authority_credential_sha256)) {
      throw new OperationalAssuranceError('assurance_authority_credential_rejected', 'assurance authority credential does not match', 403);
    }
    if (this.productionRegistry.size() !== 0) {
      throw new OperationalAssuranceError('production_registry_not_empty', 'local assurance requires the production registry to remain empty');
    }
    const at = actionIso(this.now());
    if (!operationalAssurancePolicyIsActive(policy, at)) {
      throw new OperationalAssuranceError('assurance_policy_not_active', 'operational-assurance policy is not active');
    }
    if (!g7PolicyIsActive(g7.manifest, at) || !policyIsActive(g7.g6.manifest, at)) {
      throw new OperationalAssuranceError('upstream_policy_not_active', 'bound G6/G7 policy is not active');
    }
    if (!g7.simulation.passed) {
      throw new OperationalAssuranceError('g7_simulation_not_passed', 'bound G7 simulation has not passed');
    }
    const g5 = await this.repository.findLatestG5Decision(policy.tenant_id, policy.source_connection_id);
    if (!g5 || g5.id !== g7.record.g5_release_decision_id || g5.decision !== 'go') {
      throw new OperationalAssuranceError('g5_not_current_go', 'latest G5 decision is not the bound go');
    }
    return this.repository.recordPolicy({ manifest: policy, g7 });
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
    const at = actionIso(this.now());
    const g5 = await this.repository.findLatestG5Decision(found.record.tenant_id, found.record.source_connection_id);
    const facts = await this.repository.deriveFacts({
      policy: found.record,
      windowDays: found.manifest.window.days,
      assessedAt: at,
      assurancePolicyActive: operationalAssurancePolicyIsActive(found.manifest, at),
      g5CurrentGo: Boolean(g5 && g5.id === found.g7.record.g5_release_decision_id && g5.decision === 'go'),
      g6Active: policyIsActive(found.g7.g6.manifest, at),
      g7Active: g7PolicyIsActive(found.g7.manifest, at),
      simulationPassed: Boolean(found.g7.simulation.passed),
      productionRegistrySize: this.productionRegistry.size(),
    });
    const result = evaluateOperationalAssurance(found.manifest, facts);
    return this.repository.recordAssessment({
      policy: found.record,
      assessmentKey,
      facts,
      checks: result.checks,
      localStatus: result.local_status,
      assessedBy: input.actor,
    });
  }

  async createReleasePackage(input: {
    policyId: string;
    assessmentKey: string;
    packageKey: string;
    actor: string;
    reviewerCredential: string;
  }) {
    const found = await this.repository.findPolicy(input.policyId);
    this.assertReviewer(found.manifest, input.actor, input.reviewerCredential);
    const assessment = await this.repository.findAssessment(found.record.id, input.assessmentKey);
    const packageKey = actionIdempotencyKey(input.packageKey);
    const existingPackage = await this.repository.findReleasePackageIfExists(found.record.id, packageKey);
    if (existingPackage) {
      if (existingPackage.assessment_id !== assessment.id) {
        throw new OperationalAssuranceError('release_package_conflict', 'package key binds a different assessment');
      }
      return existingPackage;
    }
    if (assessment.local_status !== 'pass') {
      throw new OperationalAssuranceError('local_assurance_not_passed', 'release package requires a passing local assessment');
    }
    const latest = await this.repository.latestAssessment(found.record.id);
    if (!latest || latest.id !== assessment.id) {
      throw new OperationalAssuranceError('assessment_not_latest', 'release package requires the latest assessment');
    }
    const reviewedAt = actionIso(this.now());
    const assessmentAge = Date.parse(reviewedAt) - Date.parse(assessment.assessed_at);
    if (
      assessmentAge < 0
      || assessmentAge > found.manifest.window.max_assessment_age_minutes * 60_000
    ) throw new OperationalAssuranceError('assessment_stale', 'latest assessment is outside its freshness window');
    const g5 = await this.repository.findLatestG5Decision(found.record.tenant_id, found.record.source_connection_id);
    const currentFacts = await this.repository.deriveFacts({
      policy: found.record,
      windowDays: found.manifest.window.days,
      assessedAt: reviewedAt,
      assurancePolicyActive: operationalAssurancePolicyIsActive(found.manifest, reviewedAt),
      g5CurrentGo: Boolean(g5 && g5.id === found.g7.record.g5_release_decision_id && g5.decision === 'go'),
      g6Active: policyIsActive(found.g7.g6.manifest, reviewedAt),
      g7Active: g7PolicyIsActive(found.g7.manifest, reviewedAt),
      simulationPassed: Boolean(found.g7.simulation.passed),
      productionRegistrySize: this.productionRegistry.size(),
    });
    if (evaluateOperationalAssurance(found.manifest, currentFacts).local_status !== 'pass') {
      throw new OperationalAssuranceError('assurance_state_changed', 'current assurance state no longer passes');
    }
    let assessedFacts: { event_count?: unknown; event_chain_fingerprint?: unknown };
    try {
      assessedFacts = JSON.parse(assessment.facts_json) as typeof assessedFacts;
    } catch {
      throw new OperationalAssuranceError('corrupt_assurance_assessment', 'assessment facts are invalid');
    }
    if (
      assessedFacts.event_count !== currentFacts.event_count
      || assessedFacts.event_chain_fingerprint !== currentFacts.event_chain_fingerprint
    ) throw new OperationalAssuranceError('assessment_event_chain_stale', 'G7 event chain changed after assessment');
    return this.repository.recordReleasePackage({
      policy: found.record,
      assessment,
      packageKey,
      reviewedBy: input.actor,
      reviewedAt,
    });
  }

  async status(policyId: string) {
    const found = await this.repository.findPolicy(policyId);
    return {
      policy: found.record,
      latest_assessment: await this.repository.latestAssessment(found.record.id),
      latest_release_package: await this.repository.latestReleasePackage(found.record.id),
      events: await this.repository.listEvents(found.record.id),
      external_release_possible: false,
    };
  }

  private assertAssessor(policy: OperationalAssurancePolicyManifest, actor: string, credential: string): void {
    if (actor !== policy.identities.assessor) {
      throw new OperationalAssuranceError('assessor_actor_rejected', 'assessor actor does not match policy', 403);
    }
    if (!assuranceCredentialMatches(credential, policy.identities.assessor_credential_sha256)) {
      throw new OperationalAssuranceError('assessor_credential_rejected', 'assessor credential does not match', 403);
    }
  }

  private assertReviewer(policy: OperationalAssurancePolicyManifest, actor: string, credential: string): void {
    if (actor !== policy.identities.release_reviewer) {
      throw new OperationalAssuranceError('release_reviewer_actor_rejected', 'release reviewer does not match policy', 403);
    }
    if (!assuranceCredentialMatches(credential, policy.identities.reviewer_credential_sha256)) {
      throw new OperationalAssuranceError('release_reviewer_credential_rejected', 'release reviewer credential does not match', 403);
    }
  }
}
