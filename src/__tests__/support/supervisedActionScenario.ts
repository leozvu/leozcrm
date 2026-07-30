import type { Knex } from 'knex';
import { actionFingerprint, SupervisedActionAdapter } from '../../domain/supervisedAction';
import { credentialFingerprint, G6ActionPolicyManifest } from '../../domain/g6Policy';
import { ActionAdapterRegistry } from '../../integrations/actions/actionAdapterRegistry';
import { ShadowTrustRepository } from '../../repositories/shadowTrustRepository';
import { SupervisedActionRepository } from '../../repositories/supervisedActionRepository';
import {
  SupervisedActionService,
  supervisedRequestFingerprint,
  supervisedRollbackRequestFingerprint,
  supervisedTargetFingerprint,
} from '../../services/supervisedActionService';
import { autonomyRecoveryRequestFingerprint } from '../../services/boundedAutonomyService';
import { seedEgoricMemory } from './egoricMemoryScenario';

export const APPROVAL_CREDENTIAL = 'test-approval-credential-0001';
export const OPERATOR_CREDENTIAL = 'test-operator-credential-0002';
export const COMMAND_CREDENTIAL = 'test-command-credential-0003';

export class DeterministicActionAdapter implements SupervisedActionAdapter {
  readonly descriptor;
  executeCalls = 0;
  rollbackCalls = 0;
  previewCalls = 0;
  rollbackPreviewCalls = 0;
  recoveryPreviewCalls = 0;
  recoveryCalls = 0;
  throwOnExecute = false;
  mismatchPreview = false;
  actualCostMinor = 25;

  constructor(
    commandKey = 'egoric.lead.set_status.v1',
    commandVersion = 'v1',
    adapterId = 'egoric-test-action-adapter',
  ) {
    this.descriptor = {
      adapter_id: adapterId,
      adapter_version: 'test_adapter_v1',
      command_key: commandKey,
      command_version: commandVersion,
      environment: 'test' as const,
      target_endpoint_url: 'https://test-actions.example/api/integrations/leozops/v1/commands/set-lead-status',
      supports_dry_run: true as const,
      supports_idempotency: true as const,
      supports_rollback: true as const,
    };
  }

  validatePayload(payload: unknown): void {
    if (
      typeof payload !== 'object'
      || payload === null
      || Array.isArray(payload)
      || Object.keys(payload).sort().join(',') !== 'lead_id,status_code'
      || typeof (payload as Record<string, unknown>).lead_id !== 'string'
      || typeof (payload as Record<string, unknown>).status_code !== 'string'
    ) throw new Error('payload must contain exact lead_id and status_code fields');
  }

  async preview(input: Parameters<SupervisedActionAdapter['preview']>[0]) {
    this.previewCalls += 1;
    const request = supervisedRequestFingerprint({
      commandKey: this.descriptor.command_key,
      commandVersion: this.descriptor.command_version,
      targetProjectId: input.targetProjectId,
      targetTenantKey: input.targetTenantKey,
      targetEndpointUrl: input.targetEndpointUrl,
      targetCredentialFingerprint: input.targetCredentialFingerprint,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      summary_code: 'lead_status_will_change',
      request_fingerprint: this.mismatchPreview ? actionFingerprint('wrong-request') : request,
      target_fingerprint: supervisedTargetFingerprint({
        projectId: input.targetProjectId,
        tenantKey: input.targetTenantKey,
        endpointUrl: input.targetEndpointUrl,
        credentialFingerprint: input.targetCredentialFingerprint,
      }),
      effect_fingerprint: actionFingerprint({ from: 'new', to: 'contacted' }),
      rollback_strategy_code: 'restore_previous_status',
      estimated_cost_minor: 25,
      currency: 'USD',
      external_mutation_count: 0 as const,
    };
  }

  async execute(input: Parameters<SupervisedActionAdapter['execute']>[0]) {
    this.executeCalls += 1;
    if (this.throwOnExecute) throw new Error('simulated unknown adapter outcome');
    return {
      outcome: 'succeeded' as const,
      external_request_id: `request_${String(this.executeCalls).padStart(4, '0')}`,
      result_fingerprint: actionFingerprint({
        request: input.preview.request_fingerprint,
        result: 'changed',
      }),
      result_code: 'lead_status_changed',
      actual_cost_minor: this.actualCostMinor,
      currency: 'USD',
      external_mutation_count: 1 as const,
    };
  }

  async previewRollback(input: Parameters<SupervisedActionAdapter['previewRollback']>[0]) {
    this.rollbackPreviewCalls += 1;
    return {
      summary_code: 'lead_status_will_restore',
      request_fingerprint: supervisedRollbackRequestFingerprint({
        commandKey: this.descriptor.command_key,
        commandVersion: this.descriptor.command_version,
        targetProjectId: input.targetProjectId,
        targetTenantKey: input.targetTenantKey,
        targetEndpointUrl: input.targetEndpointUrl,
        targetCredentialFingerprint: input.targetCredentialFingerprint,
        proposalFingerprint: input.proposal.proposal_fingerprint,
        executionResultFingerprint: input.execution.result_fingerprint!,
        idempotencyKey: input.idempotencyKey,
      }),
      target_fingerprint: supervisedTargetFingerprint({
        projectId: input.targetProjectId,
        tenantKey: input.targetTenantKey,
        endpointUrl: input.targetEndpointUrl,
        credentialFingerprint: input.targetCredentialFingerprint,
      }),
      effect_fingerprint: actionFingerprint({ from: 'contacted', to: 'new' }),
      rollback_strategy_code: 'restore_previous_status',
      estimated_cost_minor: 0,
      currency: 'USD',
      external_mutation_count: 0 as const,
    };
  }

  async rollback(input: Parameters<SupervisedActionAdapter['rollback']>[0]) {
    this.rollbackCalls += 1;
    return {
      outcome: 'succeeded' as const,
      external_request_id: `rollback_request_${String(this.rollbackCalls).padStart(4, '0')}`,
      result_fingerprint: actionFingerprint({
        request: input.preview.request_fingerprint,
        result: 'restored',
      }),
      result_code: 'lead_status_restored',
      actual_cost_minor: 0,
      currency: 'USD',
      external_mutation_count: 1 as const,
    };
  }

  async previewRecovery(input: Parameters<NonNullable<SupervisedActionAdapter['previewRecovery']>>[0]) {
    this.recoveryPreviewCalls += 1;
    return {
      summary_code: 'lead_status_will_recover',
      request_fingerprint: autonomyRecoveryRequestFingerprint({
        commandKey: this.descriptor.command_key,
        commandVersion: this.descriptor.command_version,
        targetProjectId: input.targetProjectId,
        targetTenantKey: input.targetTenantKey,
        targetEndpointUrl: input.targetEndpointUrl,
        targetCredentialFingerprint: input.targetCredentialFingerprint,
        originalRequestFingerprint: input.subject.original_request_fingerprint,
        originalResultFingerprint: input.subject.original_result_fingerprint,
        originalExternalRequestId: input.subject.original_external_request_id,
        originalIdempotencyKey: input.subject.original_idempotency_key,
        recoveryIdempotencyKey: input.idempotencyKey,
      }),
      target_fingerprint: supervisedTargetFingerprint({
        projectId: input.targetProjectId,
        tenantKey: input.targetTenantKey,
        endpointUrl: input.targetEndpointUrl,
        credentialFingerprint: input.targetCredentialFingerprint,
      }),
      effect_fingerprint: actionFingerprint({ from: 'contacted', to: 'new', kind: 'human_recovery' }),
      rollback_strategy_code: 'restore_previous_status',
      estimated_cost_minor: 0,
      currency: 'USD',
      external_mutation_count: 0 as const,
    };
  }

  async recover(input: Parameters<NonNullable<SupervisedActionAdapter['recover']>>[0]) {
    this.recoveryCalls += 1;
    return {
      outcome: 'succeeded' as const,
      external_request_id: `recovery_request_${String(this.recoveryCalls).padStart(4, '0')}`,
      result_fingerprint: actionFingerprint({
        request: input.preview.request_fingerprint,
        result: 'recovered',
      }),
      result_code: 'lead_status_recovered',
      actual_cost_minor: 0,
      currency: 'USD',
      external_mutation_count: 1 as const,
    };
  }
}

export async function createSupervisedActionScenario(
  db: Knex,
  name: string,
  options: {
    now?: Date;
    maxPerHour?: number;
    maxPerDay?: number;
    maxCostMinor?: number;
  } = {},
) {
  const clock = { now: options.now ?? new Date('2026-08-17T14:00:00.000Z') };
  const seeded = await seedEgoricMemory(db, {
    tenantKey: `${name}-tenant`,
    sourceTenantKey: `${name}-source`,
    receivedAt: '2026-08-17T13:45:00.000Z',
    asOf: '2026-08-17T13:45:00.000Z',
  });
  const shadow = new ShadowTrustRepository(db);
  const releaseCore = {
    tenant_id: seeded.tenant.id,
    source_connection_id: seeded.connection.id,
    authorization_id: `P2-${name}`,
    decision: 'go' as const,
    decided_by: 'Leoz',
    decided_at: '2026-08-17T13:30:00.000Z',
    evaluation_fingerprint: actionFingerprint({ fixture: name, verdict: 'pass' }),
    reason_code: 'g5_fixture_passed',
    extend_until_business_date: null,
  };
  const g5 = await shadow.recordReleaseDecision({
    ...releaseCore,
    evidence_key: actionFingerprint(releaseCore),
  });
  const adapter = new DeterministicActionAdapter();
  const policy: G6ActionPolicyManifest = {
    schema_version: 'leozops_g6_action_policy_v1',
    policy_id: `G6-${name}`,
    status: 'accepted',
    environment: 'test',
    approved_by: 'Leoz',
    approved_at: '2026-08-17T13:35:00.000Z',
    valid_from: '2026-08-17T13:40:00.000Z',
    valid_until: '2026-08-18T13:40:00.000Z',
    tenant_id: seeded.tenant.id,
    source_connection_id: seeded.connection.id,
    g5_release: {
      decision_id: g5.id,
      evidence_key: g5.evidence_key,
      evaluation_fingerprint: g5.evaluation_fingerprint,
      decision: 'go',
    },
    target: {
      system: 'egoric',
      project_id: `project-${name}`,
      tenant_key: seeded.connection.source_tenant_key,
      command_endpoint_url: adapter.descriptor.target_endpoint_url,
      command_credential_sha256: credentialFingerprint(COMMAND_CREDENTIAL),
    },
    command: {
      key: adapter.descriptor.command_key,
      version: adapter.descriptor.command_version,
      adapter_id: adapter.descriptor.adapter_id,
      risk_tier: 'low',
      supports_dry_run: true,
      supports_idempotency: true,
      supports_rollback: true,
      mutation_count_max: 1,
    },
    identities: {
      approver: 'Leoz',
      approval_credential_sha256: credentialFingerprint(APPROVAL_CREDENTIAL),
      operator: 'Leoz',
      operator_credential_sha256: credentialFingerprint(OPERATOR_CREDENTIAL),
    },
    limits: {
      max_cost_minor: options.maxCostMinor ?? 100,
      currency: 'USD',
      max_executions_per_hour: options.maxPerHour ?? 10,
      max_executions_per_day: options.maxPerDay ?? 20,
      approval_ttl_minutes: 30,
      execution_lease_seconds: 60,
    },
    verdict: 'accepted',
  };
  const repository = new SupervisedActionRepository(db);
  const service = new SupervisedActionService(
    repository,
    new ActionAdapterRegistry([adapter]),
    () => new Date(clock.now),
  );
  const policyRecord = await service.acceptPolicy(policy);
  return { seeded, shadow, g5, adapter, policy, policyRecord, repository, service, clock };
}

export async function proposePreviewApprove(
  scenario: Awaited<ReturnType<typeof createSupervisedActionScenario>>,
  suffix = '0000000000000001',
) {
  const proposal = await scenario.service.propose({
    policyId: scenario.policy.policy_id,
    payload: { lead_id: `lead_${suffix}`, status_code: 'contacted' },
    reasonCode: 'follow_up_priority_lead',
    expectedImpactCode: 'advance_qualified_lead',
    evidenceRefs: ['brief.current', 'recommendation.follow_up'],
    estimatedCostMinor: 25,
    currency: 'USD',
    idempotencyKey: `action:${suffix}`,
    requestedBy: 'Leoz',
    expiresAt: new Date(scenario.clock.now.getTime() + 60 * 60 * 1_000).toISOString(),
  });
  const preview = await scenario.service.preview({
    proposalId: proposal.id,
    operator: 'Leoz',
    operatorCredential: OPERATOR_CREDENTIAL,
  });
  const approval = await scenario.service.decide({
    proposalId: proposal.id,
    kind: 'execute',
    decision: 'approved',
    approver: 'Leoz',
    approvalCredential: APPROVAL_CREDENTIAL,
    reasonCode: 'ceo_approved_execution',
    nonce: `approval:${suffix}`,
    maxCostMinor: 25,
  });
  return { proposal, preview, approval };
}
