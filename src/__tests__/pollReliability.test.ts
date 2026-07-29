import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import {
  EGORIC_ACTIVE_STAGES,
  EGORIC_FUNNEL_ID,
  EGORIC_SCHEMA_VERSION,
  EGORIC_TERMINAL_OUTCOMES,
  EgoricSalesV1Snapshot,
  computeEgoricSnapshotId,
} from '../domain/businessMemory';
import {
  PollPolicyError,
  SOURCE_POLL_CADENCE_MS,
  SOURCE_POLL_STATE_TABLE,
  SourcePollPolicy,
  validateSourcePollPolicy,
} from '../domain/pollReliability';
import { EgoricSalesV1Adapter } from '../integrations/sources/egoricSalesV1Adapter';
import { SourceAdapterError } from '../integrations/sources/sourceAdapter';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { PollStateError, SourcePollStateRepository } from '../repositories/sourcePollStateRepository';
import { SnapshotIngestionService } from '../services/snapshotIngestionService';
import { SourcePollCoordinator } from '../services/sourcePollCoordinator';

const db = knexFactory(config.test);
let nowMs = Date.parse('2026-07-28T23:50:00.000Z');
const clock = () => new Date(nowMs);
const businessMemory = new BusinessMemoryRepository(db, clock);
const states = new SourcePollStateRepository(db, clock);
let identity = 0;
let uuidSequence = 0;

before(async () => {
  await db.migrate.latest();
});

after(async () => {
  await db.destroy();
});

function uuid(): string {
  uuidSequence += 1;
  return `00000000-0000-4000-8000-${String(uuidSequence).padStart(12, '0')}`;
}

function policy(overrides: Partial<SourcePollPolicy> = {}): SourcePollPolicy {
  return {
    cadenceMs: SOURCE_POLL_CADENCE_MS,
    requestTimeoutMs: 50,
    maxRetries: 1,
    baseDelayMs: 100,
    maxDelayMs: 1_000,
    jitterRatio: 0,
    circuitFailureThreshold: 2,
    circuitOpenMs: 5_000,
    leaseMs: 10_000,
    ...overrides,
  };
}

async function setupConnection() {
  identity += 1;
  const tenant = await businessMemory.ensureTenant({
    tenantKey: `poll-tenant-${identity}`,
    displayName: `Poll tenant ${identity}`,
  });
  const connection = await businessMemory.ensureSourceConnection({
    tenantId: tenant.id,
    sourceSystem: 'egoric',
    sourceTenantKey: `poll-source-${identity}`,
    schemaVersion: EGORIC_SCHEMA_VERSION,
    endpointUrl: `https://poll-${identity}.example/api/integrations/leozops/v1/lead-snapshot`,
  });
  return { tenant, connection };
}

function snapshot(sourceTenantKey: string): EgoricSalesV1Snapshot {
  const facts = {
    schema_version: EGORIC_SCHEMA_VERSION,
    source: { system: 'egoric' as const, tenant_key: sourceTenantKey },
    funnel_definition: {
      id: EGORIC_FUNNEL_ID,
      active_stages: [...EGORIC_ACTIVE_STAGES] as [...typeof EGORIC_ACTIVE_STAGES],
      terminal_outcomes: [...EGORIC_TERMINAL_OUTCOMES] as [...typeof EGORIC_TERMINAL_OUTCOMES],
      historical_transitions_available: false as const,
    },
    leads: [{
      external_id: 'poll-lead-1',
      stage: 'proposal' as const,
      source: 'Referral',
      estimated_value: 100,
      created_at: '2026-07-28T20:00:00.000Z',
      expected_close_at: null,
      owner_assigned: true,
    }],
    quality: {
      records: 1,
      missing_source: 0,
      missing_created_at: 0,
      client_attribution: 'unavailable' as const,
    },
  };
  return {
    ...facts,
    snapshot_id: computeEgoricSnapshotId(facts),
    generated_at: new Date(nowMs).toISOString(),
  };
}

function snapshotResponse(value: EgoricSalesV1Snapshot): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      etag: `"${value.snapshot_id}"`,
    },
  });
}

function coordinator(
  ingestion: Pick<SnapshotIngestionService, 'pullOnce'>,
  overrides: Partial<SourcePollPolicy> = {},
  sleep: (milliseconds: number) => Promise<void> = async (milliseconds) => {
    nowMs += milliseconds;
  },
  random: () => number = () => 0.5,
): SourcePollCoordinator {
  return new SourcePollCoordinator(
    states,
    ingestion,
    businessMemory,
    policy(overrides),
    { clock, sleep, random, uuid },
  );
}

test('policy is explicit, bounded, and preserves the approved 15-minute cadence', () => {
  assert.equal(validateSourcePollPolicy(policy()).cadenceMs, SOURCE_POLL_CADENCE_MS);
  assert.throws(
    () => validateSourcePollPolicy({ ...policy(), cadenceMs: 1 } as SourcePollPolicy),
    (error: unknown) => error instanceof PollPolicyError,
  );
  assert.throws(
    () => validateSourcePollPolicy(policy({ leaseMs: 1_000, requestTimeoutMs: 1_000 })),
    (error: unknown) => error instanceof PollPolicyError,
  );
});

test('poll state is one-to-one, tenant-scoped, and contains no credential field', async () => {
  const { tenant, connection } = await setupConnection();
  const first = await states.ensureState(tenant.id, connection.id);
  const replay = await states.ensureState(tenant.id, connection.id);
  assert.equal(first.source_connection_id, connection.id);
  assert.equal(replay.revision, first.revision);
  assert.equal(first.circuit_state, 'closed');
  assert.equal(first.consecutive_failures, 0);
  assert.equal(await db(SOURCE_POLL_STATE_TABLE).where({ source_connection_id: connection.id }).count('* as count').then(
    (rows: any[]) => Number(rows[0].count),
  ), 1);
  assert.equal(JSON.stringify(first).includes('bearer'), false);
  await assert.rejects(
    states.ensureState('00000000-0000-4000-8000-999999999999', connection.id),
    (error: unknown) => error instanceof PollStateError && error.code === 'unknown_source_connection',
  );
});

test('atomic lease permits only one in-flight cycle and persists no bearer token', async () => {
  const { tenant, connection } = await setupConnection();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const ingestion = {
    pullOnce: async (input: any) => {
      entered();
      await blocked;
      return { kind: 'not_modified' as const, etag: null, correlation_id: input.correlationId };
    },
  };
  const firstCoordinator = coordinator(ingestion, { maxRetries: 0 });
  const secondCoordinator = coordinator(ingestion, { maxRetries: 0 });
  const firstCycle = firstCoordinator.runOnce({
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    bearerToken: 'ephemeral-source-key',
    engineVersion: 'poll_core_v1',
  });
  await started;
  const second = await secondCoordinator.runOnce({
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    bearerToken: 'ephemeral-source-key',
    engineVersion: 'poll_core_v1',
  });
  assert.deepEqual(second, { kind: 'skipped', reason: 'lease_held' });
  release();
  assert.equal((await firstCycle).kind, 'succeeded');
  const stored = JSON.stringify(await db(SOURCE_POLL_STATE_TABLE).where({ source_connection_id: connection.id }));
  assert.equal(stored.includes('ephemeral-source-key'), false);
});

test('bounded retry honors sanitized Retry-After and reuses one correlation id', async () => {
  const { tenant, connection } = await setupConnection();
  const calls: any[] = [];
  const sleeps: number[] = [];
  const ingestion = {
    pullOnce: async (input: any) => {
      calls.push(input);
      if (calls.length === 1) {
        throw new SourceAdapterError('source_http_error', 'safe', 429, false, 350);
      }
      return { kind: 'not_modified' as const, etag: null, correlation_id: input.correlationId };
    },
  };
  const result = await coordinator(ingestion, {}, async (milliseconds) => {
    sleeps.push(milliseconds);
    nowMs += milliseconds;
  }).runOnce({
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    bearerToken: 'runtime-only',
    engineVersion: 'poll_core_v1',
  });
  assert.equal(result.kind, 'succeeded');
  if (result.kind !== 'succeeded') return;
  assert.equal(result.attempts, 2);
  assert.deepEqual(sleeps, [350]);
  assert.equal(calls[0].correlationId, calls[1].correlationId);
  assert.equal(result.state.consecutive_failures, 0);
});

test('exponential jitter is deterministically capped and eligible 5xx retries', async () => {
  const { tenant, connection } = await setupConnection();
  let calls = 0;
  const sleeps: number[] = [];
  const ingestion = {
    pullOnce: async (input: any) => {
      calls += 1;
      if (calls <= 2) throw new SourceAdapterError('source_http_error', 'safe', 503);
      return { kind: 'not_modified' as const, etag: null, correlation_id: input.correlationId };
    },
  };
  const result = await coordinator(
    ingestion,
    { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 150, jitterRatio: 1 },
    async (milliseconds) => {
      sleeps.push(milliseconds);
      nowMs += milliseconds;
    },
    () => 1,
  ).runOnce({
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    bearerToken: 'runtime-only',
    engineVersion: 'poll_core_v1',
  });
  assert.equal(result.kind, 'succeeded');
  assert.deepEqual(sleeps, [150, 150]);
  assert.equal(calls, 3);
});

test('adapter retains only bounded numeric Retry-After metadata', async () => {
  const numeric = new EgoricSalesV1Adapter(
    async () => new Response(null, { status: 429, headers: { 'retry-after': '999999' } }),
    uuid,
    () => nowMs,
  );
  await assert.rejects(
    numeric.pull({
      endpointUrl: 'https://retry.example/api/integrations/leozops/v1/lead-snapshot',
      bearerToken: 'runtime-only',
      sourceTenantKey: 'retry',
    }),
    (error: unknown) => error instanceof SourceAdapterError
      && error.status === 429
      && error.retryAfterMs === 24 * 60 * 60 * 1_000
      && !error.message.includes('999999'),
  );

  const malformed = new EgoricSalesV1Adapter(
    async () => new Response(null, { status: 503, headers: { 'retry-after': 'private@example.com' } }),
    uuid,
    () => nowMs,
  );
  await assert.rejects(
    malformed.pull({
      endpointUrl: 'https://retry.example/api/integrations/leozops/v1/lead-snapshot',
      bearerToken: 'runtime-only',
      sourceTenantKey: 'retry',
    }),
    (error: unknown) => error instanceof SourceAdapterError
      && error.retryAfterMs === null
      && !error.message.includes('private@example.com'),
  );
});

test('401 and schema failures disable immediately without retry or persistence', async () => {
  for (const failure of ['auth', 'schema'] as const) {
    const { tenant, connection } = await setupConnection();
    const value = snapshot(connection.source_tenant_key);
    let calls = 0;
    const adapter = new EgoricSalesV1Adapter(async () => {
      calls += 1;
      if (failure === 'auth') return new Response(null, { status: 401 });
      return new Response(JSON.stringify({ ...value, schema_version: '9.9' }), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: `"${value.snapshot_id}"` },
      });
    });
    const result = await coordinator(new SnapshotIngestionService(businessMemory, adapter)).runOnce({
      tenantId: tenant.id,
      sourceConnectionId: connection.id,
      bearerToken: 'runtime-only',
      engineVersion: 'poll_core_v1',
    });
    assert.equal(result.kind, 'failed');
    if (result.kind !== 'failed') continue;
    assert.equal(result.attempts, 1);
    assert.equal(result.disabled, true);
    assert.equal(result.state.circuit_state, 'open');
    assert.equal(result.state.next_attempt_at, null);
    assert.equal(calls, 1);
    assert.equal((await businessMemory.findSourceConnectionForTenant(tenant.id, connection.id))?.status, 'disabled');
    assert.equal((await businessMemory.listSnapshotsForTenant(tenant.id)).length, 0);
    assert.equal((await businessMemory.listRunsForTenant(tenant.id)).length, 0);
  }
});

test('unexpected source 404 is permanent, disabled, and never retried', async () => {
  const { tenant, connection } = await setupConnection();
  let calls = 0;
  const adapter = new EgoricSalesV1Adapter(async () => {
    calls += 1;
    return new Response(null, { status: 404 });
  });
  const result = await coordinator(new SnapshotIngestionService(businessMemory, adapter)).runOnce({
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    bearerToken: 'runtime-only',
    engineVersion: 'poll_core_v1',
  });
  assert.equal(result.kind, 'failed');
  if (result.kind !== 'failed') return;
  assert.equal(result.error_code, 'source_http_error');
  assert.equal(result.http_status, 404);
  assert.equal(result.attempts, 1);
  assert.equal(result.disabled, true);
  assert.equal(calls, 1);
});

test('circuit opens across failed cycles, survives restart, and closes after one probe', async () => {
  const { tenant, connection } = await setupConnection();
  let fail = true;
  const ingestion = {
    pullOnce: async (input: any) => {
      if (fail) throw new SourceAdapterError('source_unavailable', 'safe');
      return { kind: 'not_modified' as const, etag: null, correlation_id: input.correlationId };
    },
  };
  const first = await coordinator(ingestion, { maxRetries: 0 }).runOnce({
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    bearerToken: 'runtime-only',
    engineVersion: 'poll_core_v1',
  });
  assert.equal(first.kind, 'failed');
  if (first.kind !== 'failed') return;
  assert.equal(first.state.circuit_state, 'closed');
  nowMs += SOURCE_POLL_CADENCE_MS;

  const second = await coordinator(ingestion, { maxRetries: 0 }).runOnce({
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    bearerToken: 'runtime-only',
    engineVersion: 'poll_core_v1',
  });
  assert.equal(second.kind, 'failed');
  if (second.kind !== 'failed') return;
  assert.equal(second.state.circuit_state, 'open');
  assert.equal(second.state.consecutive_failures, 2);

  const restarted = coordinator(ingestion, { maxRetries: 0 });
  assert.deepEqual(await restarted.runOnce({
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    bearerToken: 'runtime-only',
    engineVersion: 'poll_core_v1',
  }), { kind: 'skipped', reason: 'circuit_open' });

  nowMs += 5_000;
  fail = false;
  const recovered = await coordinator(ingestion, { maxRetries: 0 }).runOnce({
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    bearerToken: 'runtime-only',
    engineVersion: 'poll_core_v1',
  });
  assert.equal(recovered.kind, 'succeeded');
  if (recovered.kind !== 'succeeded') return;
  assert.equal(recovered.state.circuit_state, 'closed');
  assert.equal(recovered.state.consecutive_failures, 0);
});

test('an expired lease can be recovered after a crashed process', async () => {
  const { tenant, connection } = await setupConnection();
  const abandoned = await states.acquireLease({
    tenantId: tenant.id,
    connectionId: connection.id,
    leaseId: uuid(),
    leaseMs: 1_000,
  });
  assert.equal(abandoned.acquired, true);
  nowMs += 1_001;
  const ingestion = {
    pullOnce: async (input: any) => ({
      kind: 'not_modified' as const,
      etag: null,
      correlation_id: input.correlationId,
    }),
  };
  const result = await coordinator(ingestion, { maxRetries: 0 }).runOnce({
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    bearerToken: 'runtime-only',
    engineVersion: 'poll_core_v1',
  });
  assert.equal(result.kind, 'succeeded');
});

test('request timeout is bounded, retried, and recorded without leaking details', async () => {
  const { tenant, connection } = await setupConnection();
  const ingestion = {
    pullOnce: async (input: any) => new Promise<never>((_resolve, reject) => {
      input.signal.addEventListener('abort', () => {
        reject(new SourceAdapterError('source_unavailable', 'source request failed'));
      }, { once: true });
    }),
  };
  const result = await coordinator(ingestion, {
    requestTimeoutMs: 5,
    maxRetries: 1,
    baseDelayMs: 0,
    maxDelayMs: 0,
    leaseMs: 2_000,
  }).runOnce({
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    bearerToken: 'runtime-only',
    engineVersion: 'poll_core_v1',
  });
  assert.equal(result.kind, 'failed');
  if (result.kind !== 'failed') return;
  assert.equal(result.attempts, 2);
  assert.equal(result.error_code, 'source_unavailable');
  assert.equal(result.disabled, false);
  assert.equal(result.state.last_error_code, 'source_unavailable');
});

test('200 then due 304 remains GET-only and creates one snapshot/run', async () => {
  const { tenant, connection } = await setupConnection();
  const value = snapshot(connection.source_tenant_key);
  const requests: RequestInit[] = [];
  let calls = 0;
  const adapter = new EgoricSalesV1Adapter(async (_url, init) => {
    calls += 1;
    requests.push(init ?? {});
    if (calls === 1) return snapshotResponse(value);
    return new Response(null, { status: 304, headers: { etag: `"${value.snapshot_id}"` } });
  });
  const service = new SnapshotIngestionService(businessMemory, adapter);
  const runner = coordinator(service, { maxRetries: 0 });
  const input = {
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    bearerToken: 'runtime-only',
    engineVersion: 'poll_core_v1',
  };
  const accepted = await runner.runOnce(input);
  assert.equal(accepted.kind, 'succeeded');
  if (accepted.kind !== 'succeeded') return;
  assert.equal(accepted.outcome, 'accepted');
  assert.deepEqual(await runner.runOnce(input), { kind: 'skipped', reason: 'not_due' });
  nowMs += SOURCE_POLL_CADENCE_MS;
  const notModified = await coordinator(service, { maxRetries: 0 }).runOnce(input);
  assert.equal(notModified.kind, 'succeeded');
  if (notModified.kind !== 'succeeded') return;
  assert.equal(notModified.outcome, 'not_modified');
  assert.equal((await businessMemory.listSnapshotsForTenant(tenant.id)).length, 1);
  assert.equal((await businessMemory.listRunsForTenant(tenant.id)).length, 1);
  assert.ok(requests.every((request) => request.method === 'GET' && request.body === undefined));
  assert.equal(JSON.stringify(await db(SOURCE_POLL_STATE_TABLE)).includes('runtime-only'), false);
});

test('corrupt persistent state fails closed before a source request', async () => {
  const { tenant, connection } = await setupConnection();
  await states.ensureState(tenant.id, connection.id);
  await db(SOURCE_POLL_STATE_TABLE)
    .where({ source_connection_id: connection.id })
    .update({ circuit_state: 'nonsense' });
  await assert.rejects(
    states.acquireLease({
      tenantId: tenant.id,
      connectionId: connection.id,
      leaseId: uuid(),
      leaseMs: 2_000,
    }),
    (error: unknown) => error instanceof PollStateError && error.code === 'corrupt_poll_state',
  );
});
