import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import {
  BUSINESS_MEMORY_TABLES,
  EGORIC_SCHEMA_VERSION,
} from '../domain/businessMemory';
import { SOURCE_POLL_CADENCE_MS, SOURCE_POLL_STATE_TABLE } from '../domain/pollReliability';
import {
  OperatorAccessGuard,
  SOURCE_RECONCILIATION_TABLE,
  SourceOperationsAlert,
  SourceOperationsError,
  sha256Fingerprint,
} from '../domain/sourceOperations';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { SourceOperationsRepository } from '../repositories/sourceOperationsRepository';
import {
  PollStateError,
  SourcePollStateRepository,
} from '../repositories/sourcePollStateRepository';
import { EgoricBriefService } from '../services/egoricBriefService';
import { SourceHealthService } from '../services/sourceHealthService';
import { SourceOperatorService } from '../services/sourceOperatorService';
import { SourcePollCoordinator } from '../services/sourcePollCoordinator';
import { SourceReconciliationService } from '../services/sourceReconciliationService';
import { seedEgoricMemory } from './support/egoricMemoryScenario';

const db = knexFactory(config.test);
const operatorToken = 'local-test-operator-token';
const operatorFingerprint = sha256Fingerprint(operatorToken);
const checkedAt = new Date('2026-07-29T01:00:00.000Z');

before(async () => {
  await db.migrate.latest();
});

after(async () => {
  await db.destroy();
});

function harness() {
  const alerts: SourceOperationsAlert[] = [];
  const memory = new BusinessMemoryRepository(db, () => checkedAt);
  const operations = new SourceOperationsRepository(db);
  const service = new SourceReconciliationService(
    operations,
    new EgoricBriefService(memory),
    { emit: async (alert) => { alerts.push(alert); } },
    () => checkedAt,
  );
  return { alerts, memory, operations, service };
}

test('operator credential rotation rejects the previous token without retaining either token', () => {
  const first = new OperatorAccessGuard(sha256Fingerprint('first-token'));
  first.assertAuthorized('first-token');
  assert.throws(
    () => first.assertAuthorized('second-token'),
    (error: unknown) => error instanceof SourceOperationsError
      && error.code === 'operator_unauthorized',
  );
  const rotated = new OperatorAccessGuard(sha256Fingerprint('second-token'));
  rotated.assertAuthorized('second-token');
  assert.throws(
    () => rotated.assertAuthorized('first-token'),
    (error: unknown) => error instanceof SourceOperationsError
      && error.code === 'operator_unauthorized',
  );
  assert.doesNotMatch(JSON.stringify(first), /first-token|second-token/);
});

test('exact reconciliation is immutable, idempotent, and stores counts/hashes without payload or PII', async () => {
  const seeded = await seedEgoricMemory(db, {
    tenantKey: 'reconcile-pass',
    sourceTenantKey: 'reconcile-pass-source',
  });
  const { alerts, service } = harness();
  const input = {
    tenantId: seeded.tenant.id,
    sourceConnectionId: seeded.connection.id,
    businessDate: '2026-07-28',
    businessTimezone: 'America/New_York',
  };
  const first = await service.run(input);
  const replay = await service.run(input);

  assert.equal(first.status, 'passed');
  assert.equal(first.source_total, 5);
  assert.equal(first.snapshot_total, 5);
  assert.equal(first.brief_total, 5);
  assert.equal(first.snapshot_facts_hash, first.brief_facts_hash);
  assert.equal(replay.id, first.id);
  assert.equal(await db(SOURCE_RECONCILIATION_TABLE).where({ id: first.id }).count({ count: '*' }).then(
    (rows) => Number(rows[0].count),
  ), 1);
  assert.deepEqual(alerts, []);

  const columns = await db(SOURCE_RECONCILIATION_TABLE).columnInfo();
  assert.ok(!('payload' in columns));
  assert.ok(!('payload_json' in columns));
  assert.ok(!('credential' in columns));
  assert.ok(!('bearer_token' in columns));
  const serialized = JSON.stringify(await db(SOURCE_RECONCILIATION_TABLE).where({ id: first.id }).first());
  for (const forbidden of ['brief-lead-new', 'Brief Tenant', 'reconcile-pass-source']) {
    assert.ok(!serialized.includes(forbidden));
  }
  await assert.rejects(
    db(SOURCE_RECONCILIATION_TABLE).where({ id: first.id }).update({ status: 'failed' }),
    (error: any) => /immutable/i.test(String(error?.message ?? '')),
  );
  await assert.rejects(
    db(SOURCE_RECONCILIATION_TABLE).where({ id: first.id }).del(),
    (error: any) => /immutable/i.test(String(error?.message ?? '')),
  );
});

test('brief mismatch fails the day, emits one safe alert, and replay does not duplicate it', async () => {
  const seeded = await seedEgoricMemory(db, {
    tenantKey: 'reconcile-mismatch',
    sourceTenantKey: 'reconcile-mismatch-source',
  });
  const operations = new SourceOperationsRepository(db);
  const actualBriefs = new EgoricBriefService(seeded.repository);
  const alerts: SourceOperationsAlert[] = [];
  const service = new SourceReconciliationService(
    operations,
    {
      generate: async (tenantKey, asOf) => {
        const brief = await actualBriefs.generate(tenantKey, asOf);
        return {
          ...brief,
          headline: { ...brief.headline, total_leads: brief.headline.total_leads + 1 },
        };
      },
    },
    { emit: async (alert) => { alerts.push(alert); } },
    () => checkedAt,
  );
  const input = {
    tenantId: seeded.tenant.id,
    sourceConnectionId: seeded.connection.id,
    businessDate: '2026-07-28',
    businessTimezone: 'UTC',
  };
  const failed = await service.run(input);
  const replay = await service.run(input);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure_code, 'reconciliation_mismatch');
  assert.equal(failed.brief_total, 6);
  assert.equal(replay.id, failed.id);
  assert.equal(alerts.length, 1);
  assert.deepEqual(alerts[0], {
    code: 'reconciliation_mismatch',
    tenant_id: seeded.tenant.id,
    source_connection_id: seeded.connection.id,
    business_date: '2026-07-28',
    reconciliation_id: failed.id,
  });
});

test('missing or corrupt source evidence records a safe failure instead of a false pass', async () => {
  const { memory, service } = harness();
  const tenant = await memory.ensureTenant({ tenantKey: 'reconcile-empty', displayName: 'Empty' });
  const emptyConnection = await memory.ensureSourceConnection({
    tenantId: tenant.id,
    sourceSystem: 'egoric',
    sourceTenantKey: 'reconcile-empty-source',
    schemaVersion: EGORIC_SCHEMA_VERSION,
    endpointUrl: 'https://empty.example/api/integrations/leozops/v1/lead-snapshot',
  });
  const missing = await service.run({
    tenantId: tenant.id,
    sourceConnectionId: emptyConnection.id,
    businessDate: '2026-07-28',
    businessTimezone: 'UTC',
  });
  assert.equal(missing.status, 'failed');
  assert.equal(missing.failure_code, 'no_accepted_snapshot');

  const corruptTenant = await memory.ensureTenant({ tenantKey: 'reconcile-corrupt', displayName: 'Corrupt' });
  const corruptConnection = await memory.ensureSourceConnection({
    tenantId: corruptTenant.id,
    sourceSystem: 'egoric',
    sourceTenantKey: 'reconcile-corrupt-source',
    schemaVersion: EGORIC_SCHEMA_VERSION,
    endpointUrl: 'https://corrupt.example/api/integrations/leozops/v1/lead-snapshot',
  });
  const snapshotRowId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const runId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const snapshotId = `sha256:${'f'.repeat(64)}`;
  const rawPii = 'private.person@example.com';
  await db(BUSINESS_MEMORY_TABLES.sourceSnapshots).insert({
    id: snapshotRowId,
    tenant_id: corruptTenant.id,
    source_connection_id: corruptConnection.id,
    source_system: 'egoric',
    source_tenant_key: corruptConnection.source_tenant_key,
    schema_version: EGORIC_SCHEMA_VERSION,
    snapshot_id: snapshotId,
    generated_at: checkedAt.toISOString(),
    received_at: checkedAt.toISOString(),
    payload_json: JSON.stringify({ rawPii }),
    record_count: 1,
    created_at: checkedAt.toISOString(),
  });
  await db(BUSINESS_MEMORY_TABLES.intelligenceRuns).insert({
    id: runId,
    tenant_id: corruptTenant.id,
    source_snapshot_id: snapshotRowId,
    snapshot_id: snapshotId,
    engine_version: 'corrupt_test_v1',
    as_of: checkedAt.toISOString(),
    status: 'accepted',
    created_at: checkedAt.toISOString(),
  });
  const corrupt = await service.run({
    tenantId: corruptTenant.id,
    sourceConnectionId: corruptConnection.id,
    businessDate: '2026-07-28',
    businessTimezone: 'UTC',
  });
  assert.equal(corrupt.status, 'failed');
  assert.equal(corrupt.failure_code, 'invalid_schema');
  assert.ok(!JSON.stringify(corrupt).includes(rawPii));
});

test('operator health requires authentication and returns stale sanitized state only', async () => {
  const seeded = await seedEgoricMemory(db, {
    tenantKey: 'health-stale',
    sourceTenantKey: 'health-stale-source',
    generatedAt: '2026-07-28T22:45:00.000Z',
  });
  const rawEtag = '"caller-controlled-private-etag"';
  await seeded.repository.recordPullSuccess(seeded.tenant.id, seeded.connection.id, rawEtag);
  const states = new SourcePollStateRepository(db, () => checkedAt);
  await states.ensureState(seeded.tenant.id, seeded.connection.id);
  const health = new SourceHealthService(
    new OperatorAccessGuard(operatorFingerprint),
    new SourceOperationsRepository(db),
    states,
    30 * 60 * 1_000,
    () => checkedAt,
  );
  await assert.rejects(
    health.get({
      operatorToken: 'wrong-token',
      tenantId: seeded.tenant.id,
      sourceConnectionId: seeded.connection.id,
    }),
    (error: unknown) => error instanceof SourceOperationsError
      && error.code === 'operator_unauthorized',
  );
  const result = await health.get({
    operatorToken,
    tenantId: seeded.tenant.id,
    sourceConnectionId: seeded.connection.id,
  });
  assert.equal(result.freshness_status, 'stale');
  assert.equal(result.source_age_seconds, 8_100);
  assert.equal(result.etag_fingerprint, sha256Fingerprint(rawEtag));
  assert.equal(result.circuit_state, 'closed');
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(rawEtag));
  assert.ok(!serialized.includes(seeded.connection.endpoint_url));
  assert.ok(!serialized.includes(seeded.connection.source_tenant_key));
  assert.ok(!serialized.includes(operatorToken));
});

test('authenticated disable and recovery are tenant-scoped and reset persistent circuit state', async () => {
  const seeded = await seedEgoricMemory(db, {
    tenantKey: 'operator-recovery',
    sourceTenantKey: 'operator-recovery-source',
  });
  const states = new SourcePollStateRepository(db, () => checkedAt);
  await states.ensureState(seeded.tenant.id, seeded.connection.id);
  const access = new OperatorAccessGuard(operatorFingerprint);
  const { operations, service: reconciliation } = harness();
  const health = new SourceHealthService(access, operations, states, 30 * 60 * 1_000, () => checkedAt);
  const operator = new SourceOperatorService(
    access,
    states,
    health,
    reconciliation,
    () => ({ runOnce: async () => ({ kind: 'skipped', reason: 'not_due' }) }),
  );
  const common = {
    tenantId: seeded.tenant.id,
    sourceConnectionId: seeded.connection.id,
  };
  await assert.rejects(
    operator.disable({ ...common, operatorToken: 'wrong-token' }),
    (error: unknown) => error instanceof SourceOperationsError
      && error.code === 'operator_unauthorized',
  );
  const disabled = await operator.disable({ ...common, operatorToken });
  assert.equal(disabled.circuit_state, 'open');
  assert.equal(disabled.last_error_code, 'operator_disabled');
  assert.equal((await seeded.repository.findSourceConnectionForTenant(
    seeded.tenant.id,
    seeded.connection.id,
  ))?.status, 'disabled');
  const recovered = await operator.recover({ ...common, operatorToken });
  assert.equal(recovered.circuit_state, 'closed');
  assert.equal(recovered.consecutive_failures, 0);
  assert.equal(recovered.next_attempt_at, null);
  assert.equal((await seeded.repository.findSourceConnectionForTenant(
    seeded.tenant.id,
    seeded.connection.id,
  ))?.status, 'active');
  await assert.rejects(
    operator.disable({
      operatorToken,
      tenantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      sourceConnectionId: seeded.connection.id,
    }),
    (error: unknown) => error instanceof PollStateError
      && error.code === 'unknown_source_connection',
  );
});

test('recovery refuses an active lease and succeeds after explicit lease expiry', async () => {
  const seeded = await seedEgoricMemory(db, {
    tenantKey: 'operator-lease',
    sourceTenantKey: 'operator-lease-source',
  });
  let now = new Date('2026-07-29T01:00:00.000Z');
  const states = new SourcePollStateRepository(db, () => now);
  await states.acquireLease({
    tenantId: seeded.tenant.id,
    connectionId: seeded.connection.id,
    leaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    leaseMs: 5_000,
  });
  await assert.rejects(
    states.recoverForOperator(seeded.tenant.id, seeded.connection.id),
    (error: unknown) => error instanceof PollStateError && error.code === 'lease_held',
  );
  now = new Date('2026-07-29T01:00:06.000Z');
  const state = await states.recoverForOperator(seeded.tenant.id, seeded.connection.id);
  assert.equal(state.circuit_state, 'closed');
  assert.equal(state.lease_id, null);
});

test('one-shot poll clears due state, runs exactly once, and persists no operator/source token', async () => {
  const seeded = await seedEgoricMemory(db, {
    tenantKey: 'operator-poll',
    sourceTenantKey: 'operator-poll-source',
  });
  const states = new SourcePollStateRepository(db, () => checkedAt);
  await states.ensureState(seeded.tenant.id, seeded.connection.id);
  await db(SOURCE_POLL_STATE_TABLE)
    .where({ source_connection_id: seeded.connection.id })
    .update({ next_attempt_at: '2026-07-30T01:00:00.000Z' });
  let pulls = 0;
  let uuidIndex = 0;
  const coordinator = new SourcePollCoordinator(
    states,
    {
      pullOnce: async (input) => {
        pulls += 1;
        return {
          kind: 'not_modified',
          etag: null,
          correlation_id: input.correlationId ?? 'missing',
        };
      },
    },
    { disableSourceConnection: async () => undefined },
    {
      cadenceMs: SOURCE_POLL_CADENCE_MS,
      requestTimeoutMs: 1_000,
      maxRetries: 0,
      baseDelayMs: 0,
      maxDelayMs: 0,
      jitterRatio: 0,
      circuitFailureThreshold: 2,
      circuitOpenMs: 60_000,
      leaseMs: 3_000,
    },
    {
      clock: () => checkedAt,
      uuid: () => {
        uuidIndex += 1;
        return uuidIndex === 1
          ? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
          : 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
      },
    },
  );
  const access = new OperatorAccessGuard(operatorFingerprint);
  const { operations, service: reconciliation } = harness();
  const health = new SourceHealthService(access, operations, states, 30 * 60 * 1_000, () => checkedAt);
  const operator = new SourceOperatorService(access, states, health, reconciliation, () => coordinator);
  const sourceToken = 'local-source-bearer-secret';
  const result = await operator.poll({
    operatorToken,
    tenantId: seeded.tenant.id,
    sourceConnectionId: seeded.connection.id,
    bearerToken: sourceToken,
    engineVersion: 'operator_poll_test_v1',
  });
  assert.equal(result.kind, 'succeeded');
  assert.equal(pulls, 1);
  const databaseDump = JSON.stringify({
    connection: await db(BUSINESS_MEMORY_TABLES.sourceConnections)
      .where({ id: seeded.connection.id }).first(),
    state: await db(SOURCE_POLL_STATE_TABLE)
      .where({ source_connection_id: seeded.connection.id }).first(),
  });
  assert.ok(!databaseDump.includes(operatorToken));
  assert.ok(!databaseDump.includes(sourceToken));
});

test('corrupt persisted reconciliation state fails closed in repository and health reads', async () => {
  const seeded = await seedEgoricMemory(db, {
    tenantKey: 'reconcile-corrupt-state',
    sourceTenantKey: 'reconcile-corrupt-state-source',
  });
  await db(SOURCE_RECONCILIATION_TABLE).insert({
    id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
    tenant_id: seeded.tenant.id,
    source_connection_id: seeded.connection.id,
    business_date: '2026-07-28',
    business_timezone: 'UTC',
    checked_at: checkedAt.toISOString(),
    status: 'passed',
    evidence_key: `sha256:${'1'.repeat(64)}`,
    source_snapshot_row_id: seeded.accepted.snapshot.id,
    snapshot_id: seeded.accepted.snapshot.snapshot_id,
    intelligence_run_id: seeded.accepted.run.id,
    formula_version: 'egoric_ceo_brief_v1',
    source_total: 5,
    snapshot_total: 5,
    brief_total: 6,
    snapshot_facts_hash: `sha256:${'2'.repeat(64)}`,
    brief_facts_hash: `sha256:${'3'.repeat(64)}`,
    failure_code: null,
    created_at: checkedAt.toISOString(),
  });
  await assert.rejects(
    new SourceOperationsRepository(db).latestReconciliation(
      seeded.tenant.id,
      seeded.connection.id,
    ),
    (error: unknown) => error instanceof SourceOperationsError
      && error.code === 'corrupt_reconciliation',
  );
});

test('database evidence failure propagates and cannot be reported as reconciliation success', async () => {
  const seeded = await seedEgoricMemory(db, {
    tenantKey: 'reconcile-db-outage',
    sourceTenantKey: 'reconcile-db-outage-source',
  });
  const operations = new SourceOperationsRepository(db);
  let alerted = false;
  const service = new SourceReconciliationService(
    {
      findContext: operations.findContext.bind(operations),
      recordReconciliation: async () => {
        throw new Error('database unavailable');
      },
    },
    new EgoricBriefService(seeded.repository),
    { emit: async () => { alerted = true; } },
    () => checkedAt,
  );
  await assert.rejects(service.run({
    tenantId: seeded.tenant.id,
    sourceConnectionId: seeded.connection.id,
    businessDate: '2026-07-28',
    businessTimezone: 'UTC',
  }), /database unavailable/);
  assert.equal(alerted, false);
});

test('operations migration rolls back table and immutability triggers cleanly', async () => {
  await db.migrate.rollback();
  const objects = await db('sqlite_master')
    .whereIn('type', ['table', 'trigger'])
    .select('type', 'name');
  const names = new Set(objects.map((object: { name: string }) => object.name));
  for (const name of [
    SOURCE_RECONCILIATION_TABLE,
    'source_reconciliations_no_update',
    'source_reconciliations_no_delete',
  ]) {
    assert.ok(!names.has(name), `expected ${name} to be removed by rollback`);
  }
});
