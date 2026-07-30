/**
 * PostgreSQL lifecycle smoke (Milestone #7, Phase C).
 *
 * Proves the dialect-portable migrations/queries run cleanly on PostgreSQL:
 *   migrate latest  ->  seed reference data + verify  ->  rollback + verify drop
 *
 * It is **env-gated**: it only runs when a PostgreSQL target is configured
 * (`DATABASE_URL` or `PGHOST`), and otherwise skips with a clear message and a
 * zero exit so it is safe to call in any environment. When it does run, any
 * failure (a SQLite-only assumption, a non-reversible migration) is loud and
 * non-zero.
 *
 * Run: npm run db:smoke:pg     (with DATABASE_URL or PG* env set)
 * See: docs/POSTGRES_SMOKE.md
 */
import knexFactory from 'knex';
import config from '../../knexfile';
import { seedFunnelStages } from './fixtures';
import { ClientRepository } from '../repositories/clientRepository';
import { TaskRepository } from '../repositories/taskRepository';
import { TaskService } from '../services/taskService';
import {
  EGORIC_ACTIVE_STAGES,
  EGORIC_FUNNEL_ID,
  EGORIC_SCHEMA_VERSION,
  EGORIC_TERMINAL_OUTCOMES,
  computeEgoricSnapshotId,
} from '../domain/businessMemory';
import { SOURCE_RECONCILIATION_TABLE } from '../domain/sourceOperations';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { SourceOperationsRepository } from '../repositories/sourceOperationsRepository';
import { EgoricBriefService } from '../services/egoricBriefService';
import { SourceReconciliationService } from '../services/sourceReconciliationService';
import { PHASE2_TABLES } from '../domain/shadowTrust';
import { evidenceFingerprint } from '../domain/phase2Proof';
import { ShadowTrustRepository } from '../repositories/shadowTrustRepository';
import { credentialFingerprint, G6ActionPolicyManifest } from '../domain/g6Policy';
import {
  G6_TABLES,
  SupervisedActionAdapter,
  actionFingerprint,
} from '../domain/supervisedAction';
import { ActionAdapterRegistry } from '../integrations/actions/actionAdapterRegistry';
import { SupervisedActionRepository } from '../repositories/supervisedActionRepository';
import {
  SupervisedActionService,
  supervisedRequestFingerprint,
  supervisedRollbackRequestFingerprint,
  supervisedTargetFingerprint,
} from '../services/supervisedActionService';
import { G7_TABLES } from '../domain/boundedAutonomy';
import { G7BoundedAutonomyPolicyManifest, g7TargetFingerprint } from '../domain/g7Policy';
import { BoundedAutonomyRepository } from '../repositories/boundedAutonomyRepository';
import {
  BoundedAutonomyService,
  autonomyRecoveryRequestFingerprint,
} from '../services/boundedAutonomyService';

function postgresConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.PGHOST);
}

async function tableExists(db: ReturnType<typeof knexFactory>, name: string): Promise<boolean> {
  const row = await db('information_schema.tables')
    .where({ table_schema: 'public', table_name: name })
    .first();
  return Boolean(row);
}

async function main(): Promise<void> {
  if (!postgresConfigured()) {
    console.log(
      'Postgres smoke skipped: set DATABASE_URL (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE) to run it.',
    );
    return;
  }

  const db = knexFactory(config.production);
  try {
    console.log('Postgres smoke: applying migrations…');
    await db.migrate.latest();
    const expectedTables = [
      'funnel_stages',
      'clients',
      'campaigns',
      'leads',
      'tasks',
      'task_status_events',
      'tenants',
      'source_connections',
      'source_snapshots',
      'intelligence_runs',
      'source_poll_states',
      SOURCE_RECONCILIATION_TABLE,
      PHASE2_TABLES.pollRuns,
      PHASE2_TABLES.dailyEvidence,
      PHASE2_TABLES.releaseDecisions,
      G6_TABLES.policies,
      G6_TABLES.proposals,
      G6_TABLES.previews,
      G6_TABLES.approvals,
      G6_TABLES.attempts,
      G6_TABLES.events,
      G7_TABLES.simulations,
      G7_TABLES.policies,
      G7_TABLES.killSwitchEvents,
      G7_TABLES.evaluations,
      G7_TABLES.attempts,
      G7_TABLES.recoveryPreviews,
      G7_TABLES.recoveryApprovals,
      G7_TABLES.incidentEvents,
      G7_TABLES.events,
    ];
    for (const t of expectedTables) {
      if (!(await tableExists(db, t))) {
        throw new Error(`expected table "${t}" to exist after migrate:latest`);
      }
    }

    console.log('Postgres smoke: seeding reference data…');
    const seeded = await seedFunnelStages(db);
    const stageCount = Number((await db('funnel_stages').count<{ c: string }[]>({ c: '*' }))[0].c);
    if (stageCount !== 9) {
      throw new Error(`expected 9 funnel stages after seed, got ${stageCount}`);
    }
    console.log(`  seeded ${seeded} funnel stages, ${stageCount} present.`);

    console.log('Postgres smoke: exercising the task lifecycle…');
    const client = await new ClientRepository(db).create({ name: 'PG Smoke', email: 'pg-smoke@example.com' });
    const taskService = new TaskService(new TaskRepository(db));
    const task = await taskService.create(client.id, { title: 'PG smoke task' }, 'admin');
    const moved = await taskService.transition(task, 'in_progress', { actor: 'admin', note: 'go' });
    if (!moved || moved.status !== 'in_progress') {
      throw new Error('expected task to transition open → in_progress');
    }
    const events = await taskService.statusEvents(task.id);
    const order = events.map((e) => e.to_status).join(',');
    const seqs = events.map((e) => e.seq).join(',');
    if (order !== 'open,in_progress') {
      throw new Error(`unexpected audit order: ${order}`);
    }
    if (seqs !== '1,2') {
      throw new Error(`expected monotonic audit seq "1,2", got "${seqs}"`);
    }
    console.log('  task lifecycle + monotonic audit seq verified.');

    console.log('Postgres smoke: exercising immutable source evidence…');
    const sourceNow = new Date('2026-07-29T01:00:00.000Z');
    const memory = new BusinessMemoryRepository(db, () => sourceNow);
    const tenant = await memory.ensureTenant({
      tenantKey: 'pg-smoke-egoric',
      displayName: 'PG Smoke Egoric',
    });
    const connection = await memory.ensureSourceConnection({
      tenantId: tenant.id,
      sourceSystem: 'egoric',
      sourceTenantKey: 'pg-smoke-egoric-source',
      schemaVersion: EGORIC_SCHEMA_VERSION,
      endpointUrl: 'https://pg-smoke.example/api/integrations/leozops/v1/lead-snapshot',
    });
    const facts = {
      schema_version: EGORIC_SCHEMA_VERSION,
      source: { system: 'egoric' as const, tenant_key: connection.source_tenant_key },
      funnel_definition: {
        id: EGORIC_FUNNEL_ID,
        active_stages: [...EGORIC_ACTIVE_STAGES] as [...typeof EGORIC_ACTIVE_STAGES],
        terminal_outcomes: [...EGORIC_TERMINAL_OUTCOMES] as [...typeof EGORIC_TERMINAL_OUTCOMES],
        historical_transitions_available: false as const,
      },
      leads: [],
      quality: {
        records: 0,
        missing_source: 0,
        missing_created_at: 0,
        client_attribution: 'unavailable' as const,
      },
    };
    const accepted = await memory.acceptSnapshot({
      tenantId: tenant.id,
      sourceConnectionId: connection.id,
      payload: {
        ...facts,
        snapshot_id: computeEgoricSnapshotId(facts),
        generated_at: sourceNow.toISOString(),
      },
      engineVersion: 'pg_smoke_v1',
      asOf: sourceNow.toISOString(),
    });
    const reconciliation = await new SourceReconciliationService(
      new SourceOperationsRepository(db),
      new EgoricBriefService(memory),
      { emit: async () => { throw new Error('passing reconciliation must not alert'); } },
      () => sourceNow,
    ).run({
      tenantId: tenant.id,
      sourceConnectionId: connection.id,
      businessDate: '2026-07-29',
      businessTimezone: 'UTC',
    });
    if (reconciliation.status !== 'passed') {
      throw new Error('expected source reconciliation to pass');
    }
    const shadow = new ShadowTrustRepository(db);
    const pollRun = await shadow.recordPollRun({
      tenant_id: tenant.id,
      source_connection_id: connection.id,
      environment: 'production',
      authorization_id: 'P2-PG-SMOKE',
      correlation_id: '11111111-1111-4111-8111-111111111111',
      started_at: sourceNow.toISOString(),
      finished_at: sourceNow.toISOString(),
      latency_ms: 0,
      outcome: 'accepted',
      attempt_count: 1,
      http_status: 200,
      error_code: null,
      request_method: 'GET',
      request_body_present: false,
      snapshot_id: accepted.snapshot.snapshot_id,
      intelligence_run_id: accepted.run.id,
      record_count: accepted.snapshot.record_count,
      source_generated_at: accepted.snapshot.generated_at,
      confirmed_fresh_at: sourceNow.toISOString(),
      source_mutation_count: 0,
    });
    const dailyCore = {
      tenant_id: tenant.id,
      source_connection_id: connection.id,
      environment: 'production' as const,
      authorization_id: 'P2-PG-SMOKE',
      business_date: '2026-07-29',
      business_timezone: 'UTC',
      expected_syncs: 1,
      scheduled_syncs: 1,
      successful_syncs: 1,
      not_modified_syncs: 0,
      failed_syncs: 0,
      skipped_invocations: 0,
      latest_confirmation_age_seconds: 0,
      stale_after_seconds: 1_800,
      reconciliation_id: reconciliation.id,
      reconciliation_status: 'passed' as const,
      source_total: 0,
      snapshot_total: 0,
      brief_total: 0,
      native_stage_delta_count: 0,
      safe_source_delta_count: 0,
      source_mutation_count: 0,
      employee_workflow_regression: false,
      source_latency_regression: false,
      source_error_regression: false,
      formula_version: reconciliation.formula_version,
      snapshot_id: accepted.snapshot.snapshot_id,
      intelligence_run_id: accepted.run.id,
      reviewer: 'Leoz',
      reviewer_score: 4,
      material_false_claim: false,
      incident_count: 0,
      rollback_event_count: 0,
      status: 'passed' as const,
      failure_codes_json: '[]',
      reviewed_at: sourceNow.toISOString(),
    };
    const daily = await shadow.recordDailyEvidence({
      ...dailyCore,
      evidence_key: evidenceFingerprint(dailyCore),
    });
    const releaseCore = {
      tenant_id: tenant.id,
      source_connection_id: connection.id,
      authorization_id: 'P2-PG-SMOKE',
      decision: 'go' as const,
      decided_by: 'Leoz',
      decided_at: sourceNow.toISOString(),
      evaluation_fingerprint: evidenceFingerprint({ verdict: 'blocked' }),
      reason_code: 'pg_smoke_g5_go',
      extend_until_business_date: null,
    };
    const release = await shadow.recordReleaseDecision({
      ...releaseCore,
      evidence_key: evidenceFingerprint(releaseCore),
    });

    const actionAdapter: SupervisedActionAdapter = {
      descriptor: {
        adapter_id: 'pg-smoke-action-adapter',
        adapter_version: 'pg_smoke_adapter_v1',
        command_key: 'egoric.lead.set_status.v1',
        command_version: 'v1',
        environment: 'test',
        target_endpoint_url: 'https://pg-smoke.example/api/integrations/leozops/v1/commands/set-lead-status',
        supports_dry_run: true,
        supports_idempotency: true,
        supports_rollback: true,
      },
      validatePayload(payload: unknown) {
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
          throw new Error('invalid PG smoke action payload');
        }
      },
      async preview(input) {
        return {
          summary_code: 'pg_smoke_action_preview',
          request_fingerprint: supervisedRequestFingerprint({
            commandKey: this.descriptor.command_key,
            commandVersion: this.descriptor.command_version,
            targetProjectId: input.targetProjectId,
            targetTenantKey: input.targetTenantKey,
            targetEndpointUrl: input.targetEndpointUrl,
            targetCredentialFingerprint: input.targetCredentialFingerprint,
            payload: input.payload,
            idempotencyKey: input.idempotencyKey,
          }),
          target_fingerprint: supervisedTargetFingerprint({
            projectId: input.targetProjectId,
            tenantKey: input.targetTenantKey,
            endpointUrl: input.targetEndpointUrl,
            credentialFingerprint: input.targetCredentialFingerprint,
          }),
          effect_fingerprint: actionFingerprint({ pg_smoke: 'change' }),
          rollback_strategy_code: 'pg_smoke_restore',
          estimated_cost_minor: 0,
          currency: 'USD',
          external_mutation_count: 0,
        };
      },
      async execute(input) {
        return {
          outcome: 'succeeded',
          external_request_id: 'pg_smoke_request_0001',
          result_fingerprint: actionFingerprint({ request: input.preview.request_fingerprint }),
          result_code: 'pg_smoke_action_succeeded',
          actual_cost_minor: 0,
          currency: 'USD',
          external_mutation_count: 1,
        };
      },
      async previewRollback(input) {
        return {
          summary_code: 'pg_smoke_rollback_preview',
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
          effect_fingerprint: actionFingerprint({ pg_smoke: 'restore' }),
          rollback_strategy_code: 'pg_smoke_restore',
          estimated_cost_minor: 0,
          currency: 'USD',
          external_mutation_count: 0,
        };
      },
      async rollback(input) {
        return {
          outcome: 'succeeded',
          external_request_id: 'pg_smoke_rollback_0001',
          result_fingerprint: actionFingerprint({ request: input.preview.request_fingerprint }),
          result_code: 'pg_smoke_rollback_succeeded',
          actual_cost_minor: 0,
          currency: 'USD',
          external_mutation_count: 1,
        };
      },
      async previewRecovery(input) {
        return {
          summary_code: 'pg_smoke_recovery_preview',
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
          effect_fingerprint: actionFingerprint({ pg_smoke: 'human_recovery' }),
          rollback_strategy_code: 'pg_smoke_restore',
          estimated_cost_minor: 0,
          currency: 'USD',
          external_mutation_count: 0,
        };
      },
      async recover(input) {
        return {
          outcome: 'succeeded',
          external_request_id: 'pg_smoke_recovery_0001',
          result_fingerprint: actionFingerprint({ request: input.preview.request_fingerprint }),
          result_code: 'pg_smoke_recovery_succeeded',
          actual_cost_minor: 0,
          currency: 'USD',
          external_mutation_count: 1,
        };
      },
    };
    const approvalCredential = 'pg-smoke-approval-credential';
    const operatorCredential = 'pg-smoke-operator-credential';
    const actionPolicy: G6ActionPolicyManifest = {
      schema_version: 'leozops_g6_action_policy_v1',
      policy_id: 'G6-PG-SMOKE',
      status: 'accepted',
      environment: 'test',
      approved_by: 'Leoz',
      approved_at: '2026-07-29T00:50:00.000Z',
      valid_from: '2026-07-29T00:55:00.000Z',
      valid_until: '2026-07-30T00:55:00.000Z',
      tenant_id: tenant.id,
      source_connection_id: connection.id,
      g5_release: {
        decision_id: release.id,
        evidence_key: release.evidence_key,
        evaluation_fingerprint: release.evaluation_fingerprint,
        decision: 'go',
      },
      target: {
        system: 'egoric',
        project_id: 'pg-smoke-egoric-project',
        tenant_key: connection.source_tenant_key,
        command_endpoint_url: actionAdapter.descriptor.target_endpoint_url,
        command_credential_sha256: credentialFingerprint('pg-smoke-command-credential'),
      },
      command: {
        key: actionAdapter.descriptor.command_key,
        version: actionAdapter.descriptor.command_version,
        adapter_id: actionAdapter.descriptor.adapter_id,
        risk_tier: 'low',
        supports_dry_run: true,
        supports_idempotency: true,
        supports_rollback: true,
        mutation_count_max: 1,
      },
      identities: {
        approver: 'Leoz',
        approval_credential_sha256: credentialFingerprint(approvalCredential),
        operator: 'Leoz',
        operator_credential_sha256: credentialFingerprint(operatorCredential),
      },
      limits: {
        max_cost_minor: 100,
        currency: 'USD',
        max_executions_per_hour: 10,
        max_executions_per_day: 20,
        approval_ttl_minutes: 30,
        execution_lease_seconds: 60,
      },
      verdict: 'accepted',
    };
    const actionRepository = new SupervisedActionRepository(db);
    const actionService = new SupervisedActionService(
      actionRepository,
      new ActionAdapterRegistry([actionAdapter]),
      () => sourceNow,
    );
    const actionPolicyRecord = await actionService.acceptPolicy(actionPolicy);
    const actionProposal = await actionService.propose({
      policyId: actionPolicy.policy_id,
      payload: { lead_id: 'pg_smoke_lead', status_code: 'contacted' },
      reasonCode: 'pg_smoke_action_reason',
      expectedImpactCode: 'pg_smoke_action_impact',
      evidenceRefs: ['brief.pg_smoke'],
      estimatedCostMinor: 0,
      currency: 'USD',
      idempotencyKey: 'pg-smoke-action-00000001',
      requestedBy: 'Leoz',
      expiresAt: '2026-07-29T02:00:00.000Z',
    });
    const actionPreview = await actionService.preview({
      proposalId: actionProposal.id,
      operator: 'Leoz',
      operatorCredential,
    });
    const actionApproval = await actionService.decide({
      proposalId: actionProposal.id,
      kind: 'execute',
      decision: 'approved',
      approver: 'Leoz',
      approvalCredential,
      reasonCode: 'pg_smoke_action_approved',
      nonce: 'pg-smoke-approval-0000001',
      maxCostMinor: 0,
    });
    const actionExecution = await actionService.execute({
      proposalId: actionProposal.id,
      operator: 'Leoz',
      operatorCredential,
    });
    if (actionExecution.attempt.status !== 'succeeded') {
      throw new Error('expected supervised PG smoke action to succeed');
    }
    for (let index = 2; index <= 5; index += 1) {
      const suffix = String(index).padStart(2, '0');
      const proposal = await actionService.propose({
        policyId: actionPolicy.policy_id,
        payload: { lead_id: `pg_smoke_lead_${suffix}`, status_code: 'contacted' },
        reasonCode: 'pg_smoke_action_reason',
        expectedImpactCode: 'pg_smoke_action_impact',
        evidenceRefs: ['brief.pg_smoke'],
        estimatedCostMinor: 0,
        currency: 'USD',
        idempotencyKey: `pg-smoke-action-${suffix}-000001`,
        requestedBy: 'Leoz',
        expiresAt: '2026-07-29T02:00:00.000Z',
      });
      await actionService.preview({ proposalId: proposal.id, operator: 'Leoz', operatorCredential });
      await actionService.decide({
        proposalId: proposal.id,
        kind: 'execute',
        decision: 'approved',
        approver: 'Leoz',
        approvalCredential,
        reasonCode: 'pg_smoke_action_approved',
        nonce: `pg-smoke-approval-${suffix}-00001`,
        maxCostMinor: 0,
      });
      const execution = await actionService.execute({
        proposalId: proposal.id,
        operator: 'Leoz',
        operatorCredential,
      });
      if (execution.attempt.status !== 'succeeded') throw new Error('expected qualifying supervised history');
    }
    const rollbackPreview = await actionService.previewRollback({
      proposalId: actionProposal.id,
      operator: 'Leoz',
      operatorCredential,
    });
    await actionService.decide({
      proposalId: actionProposal.id,
      kind: 'rollback',
      decision: 'approved',
      approver: 'Leoz',
      approvalCredential,
      reasonCode: 'pg_smoke_rollback_approved',
      nonce: 'pg-smoke-rollback-approval-01',
      maxCostMinor: rollbackPreview.estimated_cost_minor,
    });
    const rollback = await actionService.rollback({
      proposalId: actionProposal.id,
      operator: 'Leoz',
      operatorCredential,
    });
    if (rollback.attempt.status !== 'succeeded') throw new Error('expected supervised rollback drill to succeed');

    const g7ReleaseCredential = 'pg-smoke-g7-release-credential';
    const g7ExecutorCredential = 'pg-smoke-g7-executor-credential';
    const g7KillCredential = 'pg-smoke-g7-kill-credential';
    const autonomyPolicy: G7BoundedAutonomyPolicyManifest = {
      schema_version: 'leozops_g7_bounded_autonomy_policy_v1',
      policy_id: 'G7-PG-SMOKE',
      status: 'accepted',
      environment: 'test',
      approved_by: 'Leoz',
      approved_at: '2026-07-29T00:56:00.000Z',
      valid_from: '2026-07-29T00:57:00.000Z',
      valid_until: '2026-07-30T00:50:00.000Z',
      tenant_id: tenant.id,
      source_connection_id: connection.id,
      g6_policy: {
        policy_id: actionPolicy.policy_id,
        policy_fingerprint: actionPolicyRecord.policy_fingerprint,
        command_key: actionPolicy.command.key,
        command_version: actionPolicy.command.version,
        adapter_id: actionPolicy.command.adapter_id,
        target_fingerprint: g7TargetFingerprint(actionPolicy),
      },
      identities: {
        release_authority: 'Leoz',
        release_credential_sha256: credentialFingerprint(g7ReleaseCredential),
        executor: 'Leoz',
        executor_credential_sha256: credentialFingerprint(g7ExecutorCredential),
        kill_switch_operator: 'Leoz',
        kill_switch_credential_sha256: credentialFingerprint(g7KillCredential),
      },
      history: {
        window_days: 30,
        min_successful_executions: 5,
        require_successful_rollback_drill: true,
        max_non_successful_executions: 0,
      },
      limits: {
        max_cost_minor_per_action: 0,
        max_cost_minor_per_day: 0,
        currency: 'USD',
        max_executions_per_hour: 2,
        max_executions_per_day: 4,
        cooldown_seconds: 60,
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
    const autonomyRepository = new BoundedAutonomyRepository(db);
    const autonomyService = new BoundedAutonomyService(
      autonomyRepository,
      new ActionAdapterRegistry([actionAdapter]),
      () => sourceNow,
    );
    const autonomySimulation = await autonomyService.simulatePolicy(autonomyPolicy, 'Leoz');
    const autonomyPolicyRecord = await autonomyService.acceptPolicy(autonomyPolicy, g7ReleaseCredential);
    const autonomyKill = await autonomyService.releaseKillSwitch({
      policyId: autonomyPolicy.policy_id,
      actor: 'Leoz',
      releaseCredential: g7ReleaseCredential,
      killSwitchCredential: g7KillCredential,
      reasonCode: 'pg_smoke_g7_released',
    });
    const autonomyRun = await autonomyService.runCandidate({
      policyId: autonomyPolicy.policy_id,
      payload: { lead_id: 'pg_smoke_autonomy_lead', status_code: 'contacted' },
      reasonCode: 'pg_smoke_bounded_candidate',
      evidenceRefs: ['brief.pg_smoke'],
      idempotencyKey: 'pg-smoke-autonomy-0000001',
      executor: 'Leoz',
      executorCredential: g7ExecutorCredential,
    });
    if (autonomyRun.attempt?.status !== 'succeeded') throw new Error('expected bounded-autonomy PG smoke action to succeed');
    await autonomyService.engageKillSwitch({
      policyId: autonomyPolicy.policy_id,
      actor: 'Leoz',
      killSwitchCredential: g7KillCredential,
      reasonCode: 'pg_smoke_prepare_recovery',
    });
    const recoveryPreview = await autonomyService.previewRecovery({
      policyId: autonomyPolicy.policy_id,
      subjectAttemptId: autonomyRun.attempt.id,
      actor: 'Leoz',
      executorCredential: g7ExecutorCredential,
    });
    const recoveryApproval = await autonomyService.decideRecovery({
      policyId: autonomyPolicy.policy_id,
      subjectAttemptId: autonomyRun.attempt.id,
      decision: 'approved',
      actor: 'Leoz',
      releaseCredential: g7ReleaseCredential,
      killSwitchCredential: g7KillCredential,
      reasonCode: 'pg_smoke_recovery_approved',
      nonce: 'pg-smoke-g7-recovery-approval-01',
      maxCostMinor: recoveryPreview.estimated_cost_minor,
    });
    const recovery = await autonomyService.recover({
      policyId: autonomyPolicy.policy_id,
      subjectAttemptId: autonomyRun.attempt.id,
      actor: 'Leoz',
      executorCredential: g7ExecutorCredential,
    });
    if (recovery.attempt.status !== 'succeeded') throw new Error('expected human G7 recovery to succeed');
    const autonomyEvent = (await autonomyRepository.listEvents(autonomyPolicyRecord.id))[0];
    const incidentEvidence = actionFingerprint({ drill: 'pg_smoke_control_incident' });
    const incident = await autonomyRepository.openControlIncident({
      policy: autonomyPolicyRecord,
      actor: 'leozops_control_plane',
      reasonCode: 'pg_smoke_incident_drill',
      evidenceFingerprint: incidentEvidence,
      occurredAt: sourceNow.toISOString(),
    });
    const actionEvent = (await actionRepository.listEvents(actionProposal.id))[0];
    for (const mutation of [
      db('source_snapshots').where({ id: accepted.snapshot.id }).update({ record_count: 1 }),
      db(SOURCE_RECONCILIATION_TABLE).where({ id: reconciliation.id }).update({ status: 'failed' }),
      db(PHASE2_TABLES.pollRuns).where({ id: pollRun.id }).update({ latency_ms: 1 }),
      db(PHASE2_TABLES.dailyEvidence).where({ id: daily.id }).update({ reviewer_score: 5 }),
      db(PHASE2_TABLES.releaseDecisions).where({ id: release.id }).delete(),
      db(G6_TABLES.policies).where({ id: actionPolicyRecord.id }).update({ risk_tier: 'medium' }),
      db(G6_TABLES.proposals).where({ id: actionProposal.id }).delete(),
      db(G6_TABLES.previews).where({ id: actionPreview.id }).update({ summary_code: 'rewritten' }),
      db(G6_TABLES.approvals).where({ id: actionApproval.id }).delete(),
      db(G6_TABLES.events).where({ id: actionEvent.id }).update({ reason_code: 'rewritten' }),
      db(G6_TABLES.attempts).where({ id: actionExecution.attempt.id }).update({ result_code: 'rewritten' }),
      db(G7_TABLES.simulations).where({ id: autonomySimulation.record.id }).update({ passed: false }),
      db(G7_TABLES.policies).where({ id: autonomyPolicyRecord.id }).delete(),
      db(G7_TABLES.killSwitchEvents).where({ id: autonomyKill.id }).update({ reason_code: 'rewritten' }),
      db(G7_TABLES.evaluations).where({ id: autonomyRun.evaluation.id }).delete(),
      db(G7_TABLES.recoveryPreviews).where({ id: recoveryPreview.id }).update({ summary_code: 'rewritten' }),
      db(G7_TABLES.recoveryApprovals).where({ id: recoveryApproval.id }).delete(),
      db(G7_TABLES.events).where({ id: autonomyEvent.id }).update({ reason_code: 'rewritten' }),
      db(G7_TABLES.incidentEvents).where({ id: incident.incident.id }).delete(),
      db(G7_TABLES.attempts).where({ id: autonomyRun.attempt!.id }).update({ result_code: 'rewritten' }),
      db(G7_TABLES.attempts).where({ id: recovery.attempt.id }).delete(),
    ]) {
      let rejected = false;
      try {
        await mutation;
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error('expected immutable evidence mutation to be rejected');
    }
    console.log('  source, shadow, supervised-action, and bounded-autonomy immutability verified.');

    console.log('Postgres smoke: rolling back…');
    await db.migrate.rollback();
    for (const t of [...expectedTables].reverse()) {
      if (await tableExists(db, t)) {
        throw new Error(`expected table "${t}" to be dropped after migrate:rollback`);
      }
    }

    console.log('Postgres migrate/seed/rollback smoke PASSED.');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error('Postgres smoke FAILED:', err);
  process.exitCode = 1;
});
