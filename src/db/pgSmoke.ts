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
      decision: 'revoke' as const,
      decided_by: 'Leoz',
      decided_at: sourceNow.toISOString(),
      evaluation_fingerprint: evidenceFingerprint({ verdict: 'blocked' }),
      reason_code: 'pg_smoke_revoke',
      extend_until_business_date: null,
    };
    const release = await shadow.recordReleaseDecision({
      ...releaseCore,
      evidence_key: evidenceFingerprint(releaseCore),
    });
    for (const mutation of [
      db('source_snapshots').where({ id: accepted.snapshot.id }).update({ record_count: 1 }),
      db(SOURCE_RECONCILIATION_TABLE).where({ id: reconciliation.id }).update({ status: 'failed' }),
      db(PHASE2_TABLES.pollRuns).where({ id: pollRun.id }).update({ latency_ms: 1 }),
      db(PHASE2_TABLES.dailyEvidence).where({ id: daily.id }).update({ reviewer_score: 5 }),
      db(PHASE2_TABLES.releaseDecisions).where({ id: release.id }).delete(),
    ]) {
      let rejected = false;
      try {
        await mutation;
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error('expected immutable evidence mutation to be rejected');
    }
    console.log('  source, reconciliation, poll, daily, and release immutability verified.');

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
