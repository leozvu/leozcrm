import type { Knex } from 'knex';
import { credentialFingerprint } from '../../domain/g6Policy';
import {
  G7BoundedAutonomyPolicyManifest,
  g7TargetFingerprint,
} from '../../domain/g7Policy';
import { ActionAdapterRegistry } from '../../integrations/actions/actionAdapterRegistry';
import { BoundedAutonomyRepository } from '../../repositories/boundedAutonomyRepository';
import { BoundedAutonomyService } from '../../services/boundedAutonomyService';
import {
  APPROVAL_CREDENTIAL,
  OPERATOR_CREDENTIAL,
  createSupervisedActionScenario,
  proposePreviewApprove,
} from './supervisedActionScenario';

export const G7_RELEASE_CREDENTIAL = 'test-g7-release-credential-0004';
export const G7_EXECUTOR_CREDENTIAL = 'test-g7-executor-credential-0005';
export const G7_KILL_SWITCH_CREDENTIAL = 'test-g7-kill-switch-credential-0006';

export async function createBoundedAutonomyScenario(
  db: Knex,
  name: string,
  options: {
    qualifyHistory?: boolean;
    releaseKillSwitch?: boolean;
    maxPerHour?: number;
    maxPerDay?: number;
    maxDailyCost?: number;
    cooldownSeconds?: number;
  } = {},
) {
  const supervised = await createSupervisedActionScenario(db, `g7-${name}`, {
    maxPerHour: 10,
    maxPerDay: 20,
    maxCostMinor: 500,
  });
  const supervisedExecutions = [];
  if (options.qualifyHistory !== false) {
    for (let index = 0; index < 5; index += 1) {
      const suffix = `${name.replace(/[^a-z0-9]/gi, '').slice(0, 8)}${String(index).padStart(8, '0')}`;
      const prepared = await proposePreviewApprove(supervised, suffix);
      const execution = await supervised.service.execute({
        proposalId: prepared.proposal.id,
        operator: 'Leoz',
        operatorCredential: OPERATOR_CREDENTIAL,
      });
      supervisedExecutions.push({ ...prepared, execution });
    }
    const rollbackSubject = supervisedExecutions[0];
    const rollbackPreview = await supervised.service.previewRollback({
      proposalId: rollbackSubject.proposal.id,
      operator: 'Leoz',
      operatorCredential: OPERATOR_CREDENTIAL,
    });
    await supervised.service.decide({
      proposalId: rollbackSubject.proposal.id,
      kind: 'rollback',
      decision: 'approved',
      approver: 'Leoz',
      approvalCredential: APPROVAL_CREDENTIAL,
      reasonCode: 'ceo_approved_rollback_drill',
      nonce: `approval:g7-rollback:${name}:0001`,
      maxCostMinor: rollbackPreview.estimated_cost_minor,
    });
    await supervised.service.rollback({
      proposalId: rollbackSubject.proposal.id,
      operator: 'Leoz',
      operatorCredential: OPERATOR_CREDENTIAL,
    });
  }

  const policy: G7BoundedAutonomyPolicyManifest = {
    schema_version: 'leozops_g7_bounded_autonomy_policy_v1',
    policy_id: `G7-${name}`,
    status: 'accepted',
    environment: 'test',
    approved_by: 'Leoz',
    approved_at: '2026-08-17T13:45:00.000Z',
    valid_from: '2026-08-17T13:50:00.000Z',
    valid_until: '2026-08-18T13:30:00.000Z',
    tenant_id: supervised.seeded.tenant.id,
    source_connection_id: supervised.seeded.connection.id,
    g6_policy: {
      policy_id: supervised.policy.policy_id,
      policy_fingerprint: supervised.policyRecord.policy_fingerprint,
      command_key: supervised.policy.command.key,
      command_version: supervised.policy.command.version,
      adapter_id: supervised.policy.command.adapter_id,
      target_fingerprint: g7TargetFingerprint(supervised.policy),
    },
    identities: {
      release_authority: 'Leoz',
      release_credential_sha256: credentialFingerprint(G7_RELEASE_CREDENTIAL),
      executor: 'Leoz',
      executor_credential_sha256: credentialFingerprint(G7_EXECUTOR_CREDENTIAL),
      kill_switch_operator: 'Leoz',
      kill_switch_credential_sha256: credentialFingerprint(G7_KILL_SWITCH_CREDENTIAL),
    },
    history: {
      window_days: 30,
      min_successful_executions: 5,
      require_successful_rollback_drill: true,
      max_non_successful_executions: 0,
    },
    limits: {
      max_cost_minor_per_action: 25,
      max_cost_minor_per_day: options.maxDailyCost ?? 100,
      currency: 'USD',
      max_executions_per_hour: options.maxPerHour ?? 3,
      max_executions_per_day: options.maxPerDay ?? 5,
      cooldown_seconds: options.cooldownSeconds ?? 60,
      max_source_age_minutes: 30,
      execution_lease_seconds: 60,
      mutation_count_max: 1,
    },
    safety: {
      scenario_set_version: 'g7-core-v1',
      initial_kill_switch_state: 'engaged',
      require_no_open_incident: true,
      halt_on_any_failure: true,
      halt_on_unknown_outcome: true,
    },
    verdict: 'accepted',
  };
  const repository = new BoundedAutonomyRepository(db);
  const service = new BoundedAutonomyService(
    repository,
    new ActionAdapterRegistry([supervised.adapter]),
    () => new Date(supervised.clock.now),
  );
  const simulation = await service.simulatePolicy(policy, 'Leoz');
  let policyRecord = null;
  if (options.qualifyHistory !== false) {
    policyRecord = await service.acceptPolicy(policy, G7_RELEASE_CREDENTIAL);
    if (options.releaseKillSwitch !== false) {
      await service.releaseKillSwitch({
        policyId: policy.policy_id,
        actor: 'Leoz',
        releaseCredential: G7_RELEASE_CREDENTIAL,
        killSwitchCredential: G7_KILL_SWITCH_CREDENTIAL,
        reasonCode: 'ceo_released_bounded_rehearsal',
      });
    }
  }
  return { supervised, supervisedExecutions, policy, repository, service, simulation, policyRecord };
}

export function autonomyCandidate(policyId: string, suffix: string) {
  return {
    policyId,
    payload: { lead_id: `lead_auto_${suffix}`, status_code: 'contacted' },
    reasonCode: 'bounded_priority_follow_up',
    evidenceRefs: ['brief.current', 'recommendation.follow_up'],
    idempotencyKey: `autonomy:${suffix.padEnd(16, '0')}`,
    executor: 'Leoz',
    executorCredential: G7_EXECUTOR_CREDENTIAL,
  };
}
