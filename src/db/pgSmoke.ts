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
import { generateKeyPairSync, sign } from 'node:crypto';
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
  canonicalStringify,
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
import { PHASE5_TABLES } from '../domain/operationalAssurance';
import { OperationalAssurancePolicyManifest } from '../domain/operationalAssurancePolicy';
import { OperationalAssuranceRepository } from '../repositories/operationalAssuranceRepository';
import { OperationalAssuranceService } from '../services/operationalAssuranceService';
import {
  ExternalEvidenceAttestation,
  ExternalEvidenceEnvelope,
  PHASE6_TABLES,
  externalEvidenceFingerprint,
} from '../domain/externalEvidence';
import {
  ExternalEvidenceIssuerRole,
  ExternalEvidencePolicyManifest,
  PHASE6_EVIDENCE_MATRIX,
  PHASE6_ISSUER_ROLES,
  externalPublicKeyFingerprint,
} from '../domain/externalEvidencePolicy';
import { ExternalEvidenceRepository } from '../repositories/externalEvidenceRepository';
import { ExternalEvidenceService } from '../services/externalEvidenceService';
import { PHASE7_TABLES, activationCeremonyFingerprint } from '../domain/activationCeremony';
import { ActivationCeremonyPolicyManifest } from '../domain/activationCeremonyPolicy';
import { ActivationCeremonyRepository } from '../repositories/activationCeremonyRepository';
import { ActivationCeremonyService } from '../services/activationCeremonyService';
import {
  PHASE8_OBSERVATION_SCHEMA,
  PHASE8_PREVIEW_SCHEMA,
  PHASE8_RESULT_SCHEMA,
  PHASE8_ROLLBACK_SCHEMA,
  PHASE8_TABLES,
  ActivationExecutionAdapter,
  activationExecutionFingerprint,
} from '../domain/activationExecution';
import { ActivationExecutionPolicyManifest } from '../domain/activationExecutionPolicy';
import { ActivationExecutionAdapterRegistry } from '../integrations/actions/activationExecutionAdapterRegistry';
import { ActivationExecutionRepository } from '../repositories/activationExecutionRepository';
import { ActivationExecutionService } from '../services/activationExecutionService';

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
      PHASE5_TABLES.policies,
      PHASE5_TABLES.assessments,
      PHASE5_TABLES.releasePackages,
      PHASE5_TABLES.events,
      PHASE6_TABLES.policies,
      PHASE6_TABLES.attestations,
      PHASE6_TABLES.assessments,
      PHASE6_TABLES.events,
      PHASE7_TABLES.policies,
      PHASE7_TABLES.dossiers,
      PHASE7_TABLES.verifications,
      PHASE7_TABLES.handoffs,
      PHASE7_TABLES.recalls,
      PHASE7_TABLES.events,
      ...Object.values(PHASE8_TABLES),
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
    await autonomyService.resolveIncident({
      policyId: autonomyPolicy.policy_id,
      incidentId: incident.incident.incident_id,
      actor: 'Leoz',
      releaseCredential: g7ReleaseCredential,
      killSwitchCredential: g7KillCredential,
      reasonCode: 'pg_smoke_incident_drill_resolved',
      evidenceRefs: ['drill.pg_smoke.incident'],
    });

    const assuranceAuthorityCredential = 'pg-smoke-phase5-authority-credential';
    const assuranceAssessorCredential = 'pg-smoke-phase5-assessor-credential';
    const assuranceReviewerCredential = 'pg-smoke-phase5-reviewer-credential';
    const assurancePolicy: OperationalAssurancePolicyManifest = {
      schema_version: 'leozops_phase5_operational_assurance_policy_v1',
      policy_id: 'P5-PG-SMOKE',
      status: 'accepted',
      assurance_mode: 'local_rehearsal',
      environment: 'test',
      approved_by: 'Leoz',
      approved_at: '2026-07-29T00:58:00.000Z',
      valid_from: '2026-07-29T00:59:00.000Z',
      valid_until: '2026-07-30T00:40:00.000Z',
      tenant_id: tenant.id,
      source_connection_id: connection.id,
      g7_policy: {
        policy_id: autonomyPolicy.policy_id,
        policy_fingerprint: autonomyPolicyRecord.policy_fingerprint,
      },
      identities: {
        assurance_authority: 'Leoz',
        authority_credential_sha256: credentialFingerprint(assuranceAuthorityCredential),
        assessor: 'Leoz',
        assessor_credential_sha256: credentialFingerprint(assuranceAssessorCredential),
        release_reviewer: 'Leoz',
        reviewer_credential_sha256: credentialFingerprint(assuranceReviewerCredential),
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
    const assuranceRepository = new OperationalAssuranceRepository(db);
    const assuranceService = new OperationalAssuranceService(
      assuranceRepository,
      new ActionAdapterRegistry(),
      () => sourceNow,
    );
    const assurancePolicyRecord = await assuranceService.acceptPolicy(
      assurancePolicy,
      assuranceAuthorityCredential,
    );
    const assuranceAssessment = await assuranceService.assess({
      policyId: assurancePolicy.policy_id,
      assessmentKey: 'pg-smoke-phase5-assessment-0001',
      actor: 'Leoz',
      assessorCredential: assuranceAssessorCredential,
    });
    if (assuranceAssessment.local_status !== 'pass' || assuranceAssessment.external_status !== 'blocked_external') {
      throw new Error('expected passing local Phase 5 assessment with external block');
    }
    const assurancePackage = await assuranceService.createReleasePackage({
      policyId: assurancePolicy.policy_id,
      assessmentKey: assuranceAssessment.assessment_key,
      packageKey: 'pg-smoke-phase5-package-000001',
      actor: 'Leoz',
      reviewerCredential: assuranceReviewerCredential,
    });
    if (assurancePackage.release_status !== 'blocked_external') {
      throw new Error('expected Phase 5 release package to remain blocked external');
    }
    const assuranceEvent = (await assuranceRepository.listEvents(assurancePolicyRecord.id))[0];

    const externalAuthorityCredential = 'pg-smoke-phase6-authority-credential';
    const externalAssessorCredential = 'pg-smoke-phase6-assessor-credential';
    const externalKeys = Object.fromEntries(PHASE6_ISSUER_ROLES.map((role) => [
      role,
      generateKeyPairSync('ed25519'),
    ])) as Record<ExternalEvidenceIssuerRole, ReturnType<typeof generateKeyPairSync>>;
    const externalPolicy: ExternalEvidencePolicyManifest = {
      schema_version: 'leozops_phase6_external_evidence_policy_v1',
      policy_id: 'P6-PG-SMOKE',
      status: 'accepted',
      admission_mode: 'local_trust_bridge',
      environment: 'test',
      approved_by: 'Leoz',
      approved_at: '2026-07-29T00:59:00.000Z',
      valid_from: '2026-07-29T00:59:00.000Z',
      valid_until: '2026-07-30T00:30:00.000Z',
      tenant_id: tenant.id,
      source_connection_id: connection.id,
      phase5: {
        policy_id: assurancePolicy.policy_id,
        policy_fingerprint: assurancePolicyRecord.policy_fingerprint,
        assessment_fingerprint: assuranceAssessment.assessment_fingerprint,
        release_package_fingerprint: assurancePackage.package_fingerprint,
      },
      identities: {
        trust_authority: 'Leoz',
        authority_credential_sha256: credentialFingerprint(externalAuthorityCredential),
        assessor: 'Leoz',
        assessor_credential_sha256: credentialFingerprint(externalAssessorCredential),
      },
      issuers: Object.fromEntries(PHASE6_ISSUER_ROLES.map((role) => {
        const pem = externalKeys[role].publicKey.export({ type: 'spki', format: 'pem' }).toString();
        return [role, {
          issuer_id: `pg-smoke-${role}-issuer`,
          key_id: `pg-smoke-${role}-key-2026-01`,
          algorithm: 'ed25519',
          public_key_pem: pem,
          public_key_sha256: externalPublicKeyFingerprint(pem),
        }];
      })) as ExternalEvidencePolicyManifest['issuers'],
      limits: {
        max_clock_skew_seconds: 300,
        max_attestation_age_hours: 168,
        max_attestation_validity_hours: 168,
      },
      safety: {
        evidence_matrix_version: 'phase6-eight-blockers-v1',
        require_all_eight: true,
        reject_unknown_issuer: true,
        reject_replay_and_non_monotonic_statements: true,
        release_authority_not_granted: true,
        production_adapter_registry_must_remain_empty: true,
        waivers_allowed: false,
      },
      verdict: 'accepted',
    };
    const externalRepository = new ExternalEvidenceRepository(db);
    const externalService = new ExternalEvidenceService(
      externalRepository,
      new ActionAdapterRegistry(),
      () => sourceNow,
    );
    const externalPolicyRecord = await externalService.acceptPolicy(externalPolicy, externalAuthorityCredential);
    const attestationIds = [
      '41000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000002',
      '41000000-0000-4000-8000-000000000003',
      '41000000-0000-4000-8000-000000000004',
      '41000000-0000-4000-8000-000000000005',
      '41000000-0000-4000-8000-000000000006',
      '41000000-0000-4000-8000-000000000007',
      '41000000-0000-4000-8000-000000000008',
    ];
    let firstExternalAttestation;
    for (const [index, item] of PHASE6_EVIDENCE_MATRIX.entries()) {
      const issuer = externalPolicy.issuers[item.issuer_role];
      const attestation: ExternalEvidenceAttestation = {
        schema_version: 'leozops_phase6_external_attestation_v1',
        attestation_id: attestationIds[index],
        policy_id: externalPolicy.policy_id,
        environment: 'test',
        tenant_id: tenant.id,
        source_connection_id: connection.id,
        phase5_release_package_fingerprint: assurancePackage.package_fingerprint,
        evidence_type: item.evidence_type,
        statement: 'pass',
        supersedes_attestation_id: null,
        issuer: {
          role: item.issuer_role,
          issuer_id: issuer.issuer_id,
          key_id: issuer.key_id,
          algorithm: 'ed25519',
        },
        subject: {
          system: 'leozops',
          deployment_id: 'pg-smoke-test-deployment',
          target_fingerprint: externalEvidenceFingerprint({ target: 'pg-smoke' }),
        },
        evidence_digest: externalEvidenceFingerprint({ evidence: item.evidence_type }),
        observed_from: '2026-07-29T00:40:00.000Z',
        observed_until: '2026-07-29T00:59:00.000Z',
        issued_at: sourceNow.toISOString(),
        expires_at: '2026-07-29T20:00:00.000Z',
        nonce: `nonce:pg-smoke:${item.evidence_type}:0001`,
      };
      const envelope: ExternalEvidenceEnvelope = {
        attestation,
        signature: {
          algorithm: 'ed25519',
          value_base64: sign(
            null,
            Buffer.from(canonicalStringify(attestation)),
            externalKeys[item.issuer_role].privateKey,
          ).toString('base64'),
        },
      };
      const admitted = await externalService.admit({
        policyId: externalPolicy.policy_id,
        envelope,
        actor: 'Leoz',
        assessorCredential: externalAssessorCredential,
      });
      firstExternalAttestation ??= admitted;
    }
    const externalAssessment = await externalService.assess({
      policyId: externalPolicy.policy_id,
      assessmentKey: 'pg-smoke-phase6-assessment-0001',
      actor: 'Leoz',
      assessorCredential: externalAssessorCredential,
    });
    if (externalAssessment.status !== 'complete_unreleased' || externalAssessment.release_status !== 'blocked_external_activation') {
      throw new Error('expected complete but unreleased Phase 6 assessment');
    }
    const externalEvent = (await externalRepository.listEvents(externalPolicyRecord.id))[0];

    const ceremonyAuthorityCredential = 'pg-smoke-phase7-authority-credential';
    const ceremonyVerifierCredential = 'pg-smoke-phase7-verifier-credential';
    const ceremonyOperatorCredential = 'pg-smoke-phase7-operator-credential';
    const ceremonyPolicy: ActivationCeremonyPolicyManifest = {
      schema_version: 'leozops_phase7_activation_ceremony_policy_v1',
      policy_id: 'P7-PG-SMOKE',
      status: 'accepted',
      ceremony_mode: 'sealed_external_handoff',
      environment: 'test',
      approved_by: 'Leoz',
      approved_at: sourceNow.toISOString(),
      valid_from: sourceNow.toISOString(),
      valid_until: '2026-07-30T00:20:00.000Z',
      tenant_id: tenant.id,
      source_connection_id: connection.id,
      phase6: {
        policy_id: externalPolicy.policy_id,
        policy_fingerprint: externalPolicyRecord.policy_fingerprint,
        assessment_fingerprint: externalAssessment.assessment_fingerprint,
      },
      identities: {
        ceremony_authority: 'Leoz',
        authority_credential_sha256: credentialFingerprint(ceremonyAuthorityCredential),
        independent_verifier: 'Leoz',
        verifier_credential_sha256: credentialFingerprint(ceremonyVerifierCredential),
        activation_operator: 'Leoz',
        operator_credential_sha256: credentialFingerprint(ceremonyOperatorCredential),
      },
      target: {
        deployment_id: 'pg-smoke-test-deployment',
        target_fingerprint: externalEvidenceFingerprint({ target: 'pg-smoke' }),
        provider: 'pg-smoke-provider',
        region: 'pg-smoke-region',
        project_id: 'pg-smoke-project',
        service_id: 'leozops-control-plane',
        adapter_id: actionPolicy.command.adapter_id,
        adapter_version: actionAdapter.descriptor.adapter_version,
        command_key: actionPolicy.command.key,
        adapter_artifact_digest: externalEvidenceFingerprint({ artifact: 'pg-smoke-adapter' }),
        configuration_digest: externalEvidenceFingerprint({ configuration: 'pg-smoke' }),
        credential_reference_sha256: externalEvidenceFingerprint({ credentialReference: 'pg-smoke' }),
      },
      canary: {
        cohort_size: 1,
        max_mutations: 1,
        observation_minutes: 30,
        success_metric_fingerprint: externalEvidenceFingerprint({ metric: 'pg-smoke-success' }),
        abort_metric_fingerprint: externalEvidenceFingerprint({ metric: 'pg-smoke-abort' }),
        manual_start_required: true,
        manual_continue_required: true,
      },
      rollback: {
        rollback_artifact_digest: externalEvidenceFingerprint({ rollback: 'pg-smoke-artifact' }),
        procedure_digest: externalEvidenceFingerprint({ rollback: 'pg-smoke-procedure' }),
        max_recovery_minutes: 15,
        kill_switch_must_start_engaged: true,
        manual_recovery_only: true,
      },
      limits: {
        max_phase6_assessment_age_minutes: 30,
        max_verification_age_minutes: 15,
      },
      safety: {
        handoff_only: true,
        activation_executor_not_implemented: true,
        external_execution_requires_new_authority: true,
        production_adapter_registry_must_remain_empty: true,
        waivers_allowed: false,
      },
      verdict: 'accepted',
    };
    const ceremonyRepository = new ActivationCeremonyRepository(db);
    const ceremonyService = new ActivationCeremonyService(
      ceremonyRepository,
      externalService,
      new ActionAdapterRegistry(),
      () => sourceNow,
    );
    const ceremonyPolicyRecord = await ceremonyService.acceptPolicy(ceremonyPolicy, ceremonyAuthorityCredential);
    const ceremonyDossier = await ceremonyService.createDossier({
      policyId: ceremonyPolicy.policy_id,
      dossierKey: 'pg-smoke-phase7-dossier-0001',
      actor: 'Leoz',
      authorityCredential: ceremonyAuthorityCredential,
    });
    const ceremonyVerification = await ceremonyService.verifyDossier({
      policyId: ceremonyPolicy.policy_id,
      dossierKey: ceremonyDossier.dossier_key,
      verificationKey: 'pg-smoke-phase7-verification-0001',
      decision: 'approved',
      reasonCode: 'pg_smoke_independent_verification',
      actor: 'Leoz',
      verifierCredential: ceremonyVerifierCredential,
    });
    const ceremonyHandoff = await ceremonyService.sealHandoff({
      policyId: ceremonyPolicy.policy_id,
      dossierKey: ceremonyDossier.dossier_key,
      handoffKey: 'pg-smoke-phase7-handoff-0001',
      actor: 'Leoz',
      operatorCredential: ceremonyOperatorCredential,
    });
    if (ceremonyHandoff.activation_status !== 'not_executed' || !ceremonyHandoff.external_execution_required) {
      throw new Error('expected Phase 7 handoff to remain unexecuted and external-only');
    }

    const executionReleaseCredential = 'pg-smoke-phase8-release-credential';
    const executionExecutorCredential = 'pg-smoke-phase8-executor-credential';
    const executionObserverCredential = 'pg-smoke-phase8-observer-credential';
    const executionRollbackCredential = 'pg-smoke-phase8-rollback-credential';
    const executionPolicy: ActivationExecutionPolicyManifest = {
      schema_version: 'leozops_phase8_activation_execution_policy_v1',
      policy_id: 'P8-PG-SMOKE',
      status: 'accepted',
      execution_mode: 'controlled_single_activation',
      environment: 'test',
      approved_by: 'Leoz',
      approved_at: sourceNow.toISOString(),
      valid_from: sourceNow.toISOString(),
      valid_until: '2026-07-29T23:00:00.000Z',
      tenant_id: tenant.id,
      source_connection_id: connection.id,
      phase7: {
        policy_id: ceremonyPolicy.policy_id,
        policy_fingerprint: activationCeremonyFingerprint(ceremonyPolicy),
        handoff_fingerprint: ceremonyHandoff.handoff_fingerprint,
        dossier_fingerprint: ceremonyDossier.dossier_fingerprint,
        verification_fingerprint: ceremonyVerification.verification_fingerprint,
        phase6_evidence_set_fingerprint: ceremonyHandoff.phase6_evidence_set_fingerprint,
      },
      identities: {
        release_authority: 'Leoz',
        release_credential_sha256: credentialFingerprint(executionReleaseCredential),
        executor: 'Leoz',
        executor_credential_sha256: credentialFingerprint(executionExecutorCredential),
        safety_observer: 'Leoz',
        observer_credential_sha256: credentialFingerprint(executionObserverCredential),
        rollback_operator: 'Leoz',
        rollback_credential_sha256: credentialFingerprint(executionRollbackCredential),
      },
      target: {
        deployment_id: ceremonyPolicy.target.deployment_id,
        target_fingerprint: ceremonyPolicy.target.target_fingerprint,
        target_contract_fingerprint: activationCeremonyFingerprint(ceremonyPolicy.target),
        adapter_id: ceremonyPolicy.target.adapter_id,
        adapter_version: ceremonyPolicy.target.adapter_version,
        adapter_artifact_digest: ceremonyPolicy.target.adapter_artifact_digest,
        configuration_digest: ceremonyPolicy.target.configuration_digest,
        credential_reference_sha256: ceremonyPolicy.target.credential_reference_sha256,
      },
      canary: {
        contract_fingerprint: activationCeremonyFingerprint(ceremonyPolicy.canary),
        cohort_size: 1,
        max_activation_mutations: 1,
        observation_minutes: ceremonyPolicy.canary.observation_minutes,
        success_metric_fingerprint: ceremonyPolicy.canary.success_metric_fingerprint,
        abort_metric_fingerprint: ceremonyPolicy.canary.abort_metric_fingerprint,
      },
      rollback: {
        contract_fingerprint: activationCeremonyFingerprint(ceremonyPolicy.rollback),
        rollback_artifact_digest: ceremonyPolicy.rollback.rollback_artifact_digest,
        procedure_digest: ceremonyPolicy.rollback.procedure_digest,
        max_recovery_minutes: ceremonyPolicy.rollback.max_recovery_minutes,
        max_rollback_mutations: 1,
      },
      limits: {
        release_validity_minutes: 5,
        claim_lease_seconds: 60,
        observation_deadline_minutes: 60,
        rollback_window_minutes: 120,
      },
      safety: {
        kill_switch_starts_engaged: true,
        dual_credential_release_required: true,
        source_idempotency_required: true,
        automatic_retry_forbidden: true,
        automatic_rollback_forbidden: true,
        production_adapter_registry_empty_by_default: true,
        waivers_allowed: false,
      },
      verdict: 'accepted',
    };
    const executionAdapter: ActivationExecutionAdapter = {
      descriptor: {
        environment: executionPolicy.environment,
        adapter_id: executionPolicy.target.adapter_id,
        adapter_version: executionPolicy.target.adapter_version,
        target_fingerprint: executionPolicy.target.target_fingerprint,
        adapter_artifact_digest: executionPolicy.target.adapter_artifact_digest,
        configuration_digest: executionPolicy.target.configuration_digest,
        credential_reference_sha256: executionPolicy.target.credential_reference_sha256,
        supports_idempotency: true,
        supports_observation: true,
        supports_rollback: true,
      },
      async preview(input) {
        return {
          schema_version: PHASE8_PREVIEW_SCHEMA,
          policy_id: executionPolicy.policy_id,
          handoff_fingerprint: executionPolicy.phase7.handoff_fingerprint,
          target_fingerprint: executionPolicy.target.target_fingerprint,
          mutation_count: 0,
          readiness_fingerprint: activationExecutionFingerprint({ preview: input.previewKey }),
          summary_code: 'pg_smoke_target_ready',
          generated_at: input.requestedAt,
          expires_at: new Date(Date.parse(input.requestedAt) + 10 * 60_000).toISOString(),
        };
      },
      async activate(input) {
        return {
          schema_version: PHASE8_RESULT_SCHEMA,
          policy_id: executionPolicy.policy_id,
          handoff_fingerprint: executionPolicy.phase7.handoff_fingerprint,
          target_fingerprint: executionPolicy.target.target_fingerprint,
          activation_idempotency_key: input.activationIdempotencyKey,
          outcome: 'succeeded',
          mutation_count: 1,
          provider_receipt_fingerprint: activationExecutionFingerprint({ receipt: input.activationIdempotencyKey }),
          external_state_fingerprint: activationExecutionFingerprint({ state: 'pg-smoke-activated' }),
          result_code: 'pg_smoke_activation_confirmed',
          completed_at: input.requestedAt,
        };
      },
      async observe(input) {
        return {
          schema_version: PHASE8_OBSERVATION_SCHEMA,
          policy_id: executionPolicy.policy_id,
          target_fingerprint: executionPolicy.target.target_fingerprint,
          provider_receipt_fingerprint: input.activation.provider_receipt_fingerprint!,
          verdict: 'unhealthy',
          metric_fingerprint: executionPolicy.canary.abort_metric_fingerprint,
          external_state_fingerprint: activationExecutionFingerprint({ state: 'pg-smoke-unhealthy' }),
          result_code: 'pg_smoke_abort_threshold_reached',
          observed_at: input.requestedAt,
        };
      },
      async rollback(input) {
        return {
          schema_version: PHASE8_ROLLBACK_SCHEMA,
          policy_id: executionPolicy.policy_id,
          target_fingerprint: executionPolicy.target.target_fingerprint,
          activation_receipt_fingerprint: input.activation.provider_receipt_fingerprint!,
          rollback_idempotency_key: input.rollbackKey,
          outcome: 'succeeded',
          mutation_count: 1,
          rollback_receipt_fingerprint: activationExecutionFingerprint({ rollback: input.rollbackKey }),
          restored_state_fingerprint: activationExecutionFingerprint({ state: 'pg-smoke-restored' }),
          result_code: 'pg_smoke_rollback_confirmed',
          completed_at: input.requestedAt,
        };
      },
    };
    let executionNow = new Date(sourceNow);
    const executionRepository = new ActivationExecutionRepository(db);
    const executionService = new ActivationExecutionService(
      executionRepository,
      ceremonyService,
      new ActivationExecutionAdapterRegistry([executionAdapter]),
      () => new Date(executionNow),
    );
    const executionPolicyRecord = await executionService.acceptPolicy(executionPolicy, executionReleaseCredential);
    const executionPreview = await executionService.preview({
      policyId: executionPolicy.policy_id,
      previewKey: 'pg-smoke-phase8-preview-0001',
      actor: 'Leoz',
      executorCredential: executionExecutorCredential,
    });
    const executionRelease = await executionService.release({
      policyId: executionPolicy.policy_id,
      releaseKey: 'pg-smoke-phase8-release-0001',
      reasonCode: 'pg_smoke_controlled_activation_approved',
      releaseActor: 'Leoz',
      releaseCredential: executionReleaseCredential,
      observerActor: 'Leoz',
      observerCredential: executionObserverCredential,
    });
    const execution = await executionService.activate({
      policyId: executionPolicy.policy_id,
      activationKey: 'pg-smoke-phase8-activation-0001',
      actor: 'Leoz',
      executorCredential: executionExecutorCredential,
    });
    if (!execution.outcome || execution.outcome.outcome !== 'succeeded') {
      throw new Error('expected Phase 8 controlled activation to succeed');
    }
    executionNow = new Date(sourceNow.getTime() + 30 * 60_000);
    const executionObservation = await executionService.observe({
      policyId: executionPolicy.policy_id,
      observationKey: 'pg-smoke-phase8-observation-0001',
      actor: 'Leoz',
      observerCredential: executionObserverCredential,
    });
    const executionRollback = await executionService.rollback({
      policyId: executionPolicy.policy_id,
      rollbackKey: 'pg-smoke-phase8-rollback-0001',
      reasonCode: 'pg_smoke_manual_safety_recovery',
      authorityActor: 'Leoz',
      authorityCredential: executionReleaseCredential,
      rollbackActor: 'Leoz',
      rollbackCredential: executionRollbackCredential,
    });
    const executionStatus = await executionService.status(executionPolicy.policy_id);
    if (
      executionObservation.verdict !== 'unhealthy'
      || executionRollback.outcome !== 'succeeded'
      || executionStatus.activation_status !== 'rolled_back'
      || executionStatus.incidents.length !== 1
    ) throw new Error('expected Phase 8 observation, incident, and rollback evidence');

    const ceremonyRecall = await ceremonyService.recallHandoff({
      policyId: ceremonyPolicy.policy_id,
      recallKey: 'pg-smoke-phase7-recall-0001',
      reasonCode: 'pg_smoke_recall_drill',
      evidenceFingerprint: ceremonyHandoff.handoff_fingerprint,
      authorityActor: 'Leoz',
      authorityCredential: ceremonyAuthorityCredential,
      verifierActor: 'Leoz',
      verifierCredential: ceremonyVerifierCredential,
    });
    const ceremonyEvent = (await ceremonyRepository.listEvents(ceremonyPolicyRecord.id))[0];
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
      db(PHASE5_TABLES.policies).where({ id: assurancePolicyRecord.id }).delete(),
      db(PHASE5_TABLES.assessments).where({ id: assuranceAssessment.id }).update({ local_status: 'fail' }),
      db(PHASE5_TABLES.releasePackages).where({ id: assurancePackage.id }).delete(),
      db(PHASE5_TABLES.events).where({ id: assuranceEvent.id }).update({ reason_code: 'rewritten' }),
      db(PHASE6_TABLES.policies).where({ id: externalPolicyRecord.id }).delete(),
      db(PHASE6_TABLES.attestations).where({ id: firstExternalAttestation!.id }).update({ statement: 'revoke' }),
      db(PHASE6_TABLES.assessments).where({ id: externalAssessment.id }).delete(),
      db(PHASE6_TABLES.events).where({ id: externalEvent.id }).update({ reason_code: 'rewritten' }),
      db(PHASE7_TABLES.policies).where({ id: ceremonyPolicyRecord.id }).delete(),
      db(PHASE7_TABLES.dossiers).where({ id: ceremonyDossier.id }).update({ status: 'approved' }),
      db(PHASE7_TABLES.verifications).where({ id: ceremonyVerification.id }).delete(),
      db(PHASE7_TABLES.handoffs).where({ id: ceremonyHandoff.id }).update({ activation_status: 'executed' }),
      db(PHASE7_TABLES.recalls).where({ id: ceremonyRecall.id }).delete(),
      db(PHASE7_TABLES.events).where({ id: ceremonyEvent.id }).update({ reason_code: 'rewritten' }),
      db(PHASE8_TABLES.policies).where({ id: executionPolicyRecord.id }).delete(),
      db(PHASE8_TABLES.killSwitchEvents).where({ id: executionStatus.kill_switch!.id }).update({ state: 'released' }),
      db(PHASE8_TABLES.previews).where({ id: executionPreview.id }).update({ requested_by: 'rewritten' }),
      db(PHASE8_TABLES.releases).where({ id: executionRelease.id }).delete(),
      db(PHASE8_TABLES.claims).where({ id: execution.claim.id }).update({ claimed_by: 'rewritten' }),
      db(PHASE8_TABLES.outcomes).where({ id: execution.outcome.id }).delete(),
      db(PHASE8_TABLES.observations).where({ id: executionObservation.id }).update({ verdict: 'healthy' }),
      db(PHASE8_TABLES.rollbacks).where({ id: executionRollback.id }).delete(),
      db(PHASE8_TABLES.incidents).where({ id: executionStatus.incidents[0].id }).update({ reason_code: 'rewritten' }),
      db(PHASE8_TABLES.events).where({ id: executionStatus.events[0].id }).delete(),
    ]) {
      let rejected = false;
      try {
        await mutation;
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error('expected immutable evidence mutation to be rejected');
    }
    console.log('  source, shadow, supervised-action, bounded-autonomy, assurance, external-evidence, activation-ceremony, and controlled-activation immutability verified.');

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
