import type { Knex } from 'knex';
import { credentialFingerprint } from '../../domain/g6Policy';
import { assuranceFingerprint } from '../../domain/operationalAssurance';
import type { OperationalAssurancePolicyManifest } from '../../domain/operationalAssurancePolicy';
import { ActionAdapterRegistry } from '../../integrations/actions/actionAdapterRegistry';
import { OperationalAssuranceRepository } from '../../repositories/operationalAssuranceRepository';
import { OperationalAssuranceService } from '../../services/operationalAssuranceService';
import {
  G7_EXECUTOR_CREDENTIAL,
  G7_KILL_SWITCH_CREDENTIAL,
  G7_RELEASE_CREDENTIAL,
  autonomyCandidate,
  createBoundedAutonomyScenario,
} from './boundedAutonomyScenario';

export const PHASE5_AUTHORITY_CREDENTIAL = 'test-phase5-authority-credential-0007';
export const PHASE5_ASSESSOR_CREDENTIAL = 'test-phase5-assessor-credential-0008';
export const PHASE5_REVIEWER_CREDENTIAL = 'test-phase5-reviewer-credential-0009';

export async function createOperationalAssuranceScenario(
  db: Knex,
  name: string,
  options: { acceptPolicy?: boolean } = {},
) {
  const bounded = await createBoundedAutonomyScenario(db, `p5-${name}`);
  const policy: OperationalAssurancePolicyManifest = {
    schema_version: 'leozops_phase5_operational_assurance_policy_v1',
    policy_id: `P5-${name}`,
    status: 'accepted',
    assurance_mode: 'local_rehearsal',
    environment: 'test',
    approved_by: 'Leoz',
    approved_at: '2026-08-17T13:51:00.000Z',
    valid_from: '2026-08-17T13:55:00.000Z',
    valid_until: '2026-08-18T13:00:00.000Z',
    tenant_id: bounded.policy.tenant_id,
    source_connection_id: bounded.policy.source_connection_id,
    g7_policy: {
      policy_id: bounded.policy.policy_id,
      policy_fingerprint: bounded.policyRecord!.policy_fingerprint,
    },
    identities: {
      assurance_authority: 'Leoz',
      authority_credential_sha256: credentialFingerprint(PHASE5_AUTHORITY_CREDENTIAL),
      assessor: 'Leoz',
      assessor_credential_sha256: credentialFingerprint(PHASE5_ASSESSOR_CREDENTIAL),
      release_reviewer: 'Leoz',
      reviewer_credential_sha256: credentialFingerprint(PHASE5_REVIEWER_CREDENTIAL),
    },
    window: {
      days: 7,
      max_assessment_age_minutes: 15,
      min_successful_executions: 1,
      max_failed_executions: 0,
      max_reconciliation_required_executions: 0,
      require_successful_human_recovery: true,
      require_resolved_incident_halt_drill: true,
    },
    safety: {
      release_package_must_remain_blocked_external: true,
      external_evidence_may_not_be_inferred: true,
      production_adapter_registry_must_remain_empty: true,
      waivers_allowed: false,
    },
    verdict: 'accepted',
  };
  const repository = new OperationalAssuranceRepository(db);
  const service = new OperationalAssuranceService(
    repository,
    new ActionAdapterRegistry(),
    () => new Date(bounded.supervised.clock.now),
  );
  const policyRecord = options.acceptPolicy === false
    ? null
    : await service.acceptPolicy(policy, PHASE5_AUTHORITY_CREDENTIAL);
  return { bounded, policy, repository, service, policyRecord };
}

export async function preparePassingAssuranceEvidence(
  scenario: Awaited<ReturnType<typeof createOperationalAssuranceScenario>>,
) {
  const execution = await scenario.bounded.service.runCandidate(
    autonomyCandidate(scenario.bounded.policy.policy_id, 'phase5pass000001'),
  );
  if (!execution.attempt) throw new Error('expected bounded execution attempt');
  scenario.bounded.supervised.clock.now = new Date('2026-08-17T14:02:00.000Z');
  await scenario.bounded.service.engageKillSwitch({
    policyId: scenario.bounded.policy.policy_id,
    actor: 'Leoz',
    killSwitchCredential: G7_KILL_SWITCH_CREDENTIAL,
    reasonCode: 'phase5_recovery_drill_start',
  });
  const preview = await scenario.bounded.service.previewRecovery({
    policyId: scenario.bounded.policy.policy_id,
    subjectAttemptId: execution.attempt.id,
    actor: 'Leoz',
    executorCredential: G7_EXECUTOR_CREDENTIAL,
  });
  await scenario.bounded.service.decideRecovery({
    policyId: scenario.bounded.policy.policy_id,
    subjectAttemptId: execution.attempt.id,
    decision: 'approved',
    actor: 'Leoz',
    releaseCredential: G7_RELEASE_CREDENTIAL,
    killSwitchCredential: G7_KILL_SWITCH_CREDENTIAL,
    reasonCode: 'phase5_human_recovery_approved',
    nonce: `approval:phase5-recovery:${scenario.policy.policy_id}:0001`,
    maxCostMinor: preview.estimated_cost_minor,
  });
  const recovery = await scenario.bounded.service.recover({
    policyId: scenario.bounded.policy.policy_id,
    subjectAttemptId: execution.attempt.id,
    actor: 'Leoz',
    executorCredential: G7_EXECUTOR_CREDENTIAL,
  });
  scenario.bounded.supervised.clock.now = new Date('2026-08-17T14:04:00.000Z');
  const incidentEvidence = assuranceFingerprint({
    drill: 'phase5_incident_halt',
    policy_fingerprint: scenario.bounded.policyRecord!.policy_fingerprint,
  });
  const opened = await scenario.bounded.repository.openControlIncident({
    policy: scenario.bounded.policyRecord!,
    actor: 'Leoz',
    reasonCode: 'phase5_incident_halt_drill',
    evidenceFingerprint: incidentEvidence,
    occurredAt: scenario.bounded.supervised.clock.now.toISOString(),
  });
  scenario.bounded.supervised.clock.now = new Date('2026-08-17T14:05:00.000Z');
  await scenario.bounded.service.resolveIncident({
    policyId: scenario.bounded.policy.policy_id,
    incidentId: opened.incident.incident_id,
    actor: 'Leoz',
    releaseCredential: G7_RELEASE_CREDENTIAL,
    killSwitchCredential: G7_KILL_SWITCH_CREDENTIAL,
    reasonCode: 'phase5_incident_drill_resolved',
    evidenceRefs: ['drill.phase5.incident', 'drill.phase5.kill_switch'],
  });
  return { execution, recovery, incident: opened.incident };
}
