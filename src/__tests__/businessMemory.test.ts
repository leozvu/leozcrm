import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import {
  BUSINESS_MEMORY_TABLES,
  EGORIC_ACTIVE_STAGES,
  EGORIC_FUNNEL_ID,
  EGORIC_SCHEMA_VERSION,
  EGORIC_TERMINAL_OUTCOMES,
  EgoricSalesLead,
  EgoricSalesV1Snapshot,
  SnapshotContractError,
  computeEgoricSnapshotId,
  validateEgoricSalesV1Snapshot,
} from '../domain/businessMemory';
import { EgoricSalesV1Adapter } from '../integrations/sources/egoricSalesV1Adapter';
import { SourceAdapterError } from '../integrations/sources/sourceAdapter';
import {
  SOURCE_POLL_STATE_TABLE,
} from '../domain/pollReliability';
import {
  BusinessMemoryError,
  BusinessMemoryRepository,
} from '../repositories/businessMemoryRepository';
import { SnapshotIngestionService } from '../services/snapshotIngestionService';

const db = knexFactory(config.test);
const fixedNow = new Date('2026-07-28T23:00:00.000Z');
const repository = new BusinessMemoryRepository(db, () => fixedNow);
let sequence = 0;

before(async () => {
  await db.migrate.latest();
});

after(async () => {
  await db.destroy();
});

function snapshotFor(
  tenantKey = 'egoric',
  leads: EgoricSalesLead[] = [
    {
      external_id: 'lead-1',
      stage: 'proposal',
      source: 'Facebook',
      estimated_value: 2500,
      created_at: '2026-07-01T08:00:00Z',
      expected_close_at: null,
      owner_assigned: true,
    },
    {
      external_id: 'lead-2',
      stage: 'lost',
      source: null,
      estimated_value: null,
      created_at: null,
      expected_close_at: null,
      owner_assigned: false,
    },
  ],
): EgoricSalesV1Snapshot {
  const facts = {
    schema_version: EGORIC_SCHEMA_VERSION,
    source: { system: 'egoric' as const, tenant_key: tenantKey },
    funnel_definition: {
      id: EGORIC_FUNNEL_ID,
      active_stages: [...EGORIC_ACTIVE_STAGES] as [...typeof EGORIC_ACTIVE_STAGES],
      terminal_outcomes: [...EGORIC_TERMINAL_OUTCOMES] as [...typeof EGORIC_TERMINAL_OUTCOMES],
      historical_transitions_available: false as const,
    },
    leads,
    quality: {
      records: leads.length,
      missing_source: leads.filter((lead) => !lead.source).length,
      missing_created_at: leads.filter((lead) => !lead.created_at).length,
      client_attribution: 'unavailable' as const,
    },
  };
  return {
    ...facts,
    snapshot_id: computeEgoricSnapshotId(facts),
    generated_at: '2026-07-28T22:00:00.000Z',
  };
}

async function setupConnection(sourceTenantKey = `egoric-${++sequence}`) {
  const tenant = await repository.ensureTenant({
    tenantKey: `tenant-${sequence}`,
    displayName: `Tenant ${sequence}`,
  });
  const connection = await repository.ensureSourceConnection({
    tenantId: tenant.id,
    sourceSystem: 'egoric',
    sourceTenantKey,
    schemaVersion: EGORIC_SCHEMA_VERSION,
    endpointUrl: `https://egoric-${sequence}.example/api/integrations/leozops/v1/lead-snapshot`,
  });
  return { tenant, connection };
}

function jsonResponse(snapshot: EgoricSalesV1Snapshot): Response {
  return new Response(JSON.stringify(snapshot), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      etag: `"${snapshot.snapshot_id}"`,
      'x-correlation-id': '11111111-1111-4111-8111-111111111111',
    },
  });
}

test('egoric_sales_v1 validator accepts exact native-funnel facts and content hash', () => {
  const snapshot = snapshotFor('egoric');
  const validated = validateEgoricSalesV1Snapshot(snapshot, 'egoric');
  assert.equal(validated.snapshot_id, snapshot.snapshot_id);
  assert.deepEqual(validated.funnel_definition.active_stages, [
    'new',
    'contacted',
    'proposal',
    'negotiation',
  ]);
  assert.deepEqual(validated.funnel_definition.terminal_outcomes, ['won', 'lost']);
  assert.equal(validated.funnel_definition.historical_transitions_available, false);
});

test('validator fails closed on unknown version, extra PII, unknown stage, or tampered hash', () => {
  const snapshot = snapshotFor('egoric');
  const cases: unknown[] = [
    { ...snapshot, schema_version: '2.0' },
    { ...snapshot, leads: [{ ...snapshot.leads[0], email: 'pii@example.com' }, snapshot.leads[1]] },
    { ...snapshot, leads: [{ ...snapshot.leads[0], stage: 'qualification' }, snapshot.leads[1]] },
    { ...snapshot, snapshot_id: `sha256:${'0'.repeat(64)}` },
    { ...snapshot, quality: { ...snapshot.quality, records: 999 } },
  ];
  for (const candidate of cases) {
    assert.throws(
      () => validateEgoricSalesV1Snapshot(candidate, 'egoric'),
      (error: unknown) => error instanceof SnapshotContractError,
    );
  }
});

test('source adapter emits GET only, no body, scoped bearer auth, ETag, and correlation id', async () => {
  const snapshot = snapshotFor('egoric');
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return jsonResponse(snapshot);
  };
  const adapter = new EgoricSalesV1Adapter(
    fakeFetch,
    () => '11111111-1111-4111-8111-111111111111',
  );
  const result = await adapter.pull({
    endpointUrl: 'https://egoric.example/api/integrations/leozops/v1/lead-snapshot',
    bearerToken: 'local-test-key',
    sourceTenantKey: 'egoric',
    previousEtag: '"sha256:previous"',
  });

  assert.equal(result.kind, 'snapshot');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.method, 'GET');
  assert.equal(calls[0].init?.body, undefined);
  assert.equal(calls[0].init?.redirect, 'error');
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer local-test-key');
  assert.equal(headers['If-None-Match'], '"sha256:previous"');
  assert.equal(headers['X-Correlation-ID'], '11111111-1111-4111-8111-111111111111');
});

test('adapter rejects unsafe endpoint, auth failure, unsupported schema, and ETag mismatch', async () => {
  const snapshot = snapshotFor('egoric');
  const unsafe = new EgoricSalesV1Adapter(async () => jsonResponse(snapshot));
  await assert.rejects(
    unsafe.pull({
      endpointUrl: 'http://public.example/api/integrations/leozops/v1/lead-snapshot',
      bearerToken: 'key',
      sourceTenantKey: 'egoric',
    }),
    (error: unknown) => error instanceof SourceAdapterError && error.code === 'invalid_endpoint',
  );
  await assert.rejects(
    unsafe.pull({
      endpointUrl: 'https://egoric.example/api/v1/leads?token=secret',
      bearerToken: 'key',
      sourceTenantKey: 'egoric',
    }),
    (error: unknown) => error instanceof SourceAdapterError && error.code === 'invalid_endpoint',
  );

  const auth = new EgoricSalesV1Adapter(async () => new Response(null, { status: 401 }));
  await assert.rejects(
    auth.pull({ endpointUrl: 'https://egoric.example/api/integrations/leozops/v1/lead-snapshot', bearerToken: 'bad', sourceTenantKey: 'egoric' }),
    (error: unknown) => error instanceof SourceAdapterError
      && error.code === 'source_auth_failed'
      && error.disableConnection,
  );

  const badSchema = new EgoricSalesV1Adapter(async () => new Response(
    JSON.stringify({ ...snapshot, schema_version: '2.0' }),
    { status: 200, headers: { 'content-type': 'application/json', etag: `"${snapshot.snapshot_id}"` } },
  ));
  await assert.rejects(
    badSchema.pull({ endpointUrl: 'https://egoric.example/api/integrations/leozops/v1/lead-snapshot', bearerToken: 'key', sourceTenantKey: 'egoric' }),
    (error: unknown) => error instanceof SourceAdapterError
      && error.code === 'unsupported_schema_version'
      && error.disableConnection,
  );

  const badEtag = new EgoricSalesV1Adapter(async () => new Response(
    JSON.stringify(snapshot),
    { status: 200, headers: { 'content-type': 'application/json', etag: '"sha256:wrong"' } },
  ));
  await assert.rejects(
    badEtag.pull({ endpointUrl: 'https://egoric.example/api/integrations/leozops/v1/lead-snapshot', bearerToken: 'key', sourceTenantKey: 'egoric' }),
    (error: unknown) => error instanceof SourceAdapterError
      && error.code === 'etag_mismatch'
      && error.disableConnection,
  );

  const unexpected304 = new EgoricSalesV1Adapter(async () => new Response(null, { status: 304 }));
  await assert.rejects(
    unexpected304.pull({
      endpointUrl: 'https://egoric.example/api/integrations/leozops/v1/lead-snapshot',
      bearerToken: 'key',
      sourceTenantKey: 'egoric',
    }),
    (error: unknown) => error instanceof SourceAdapterError
      && error.code === 'unexpected_not_modified'
      && error.disableConnection,
  );

  const mismatched304 = new EgoricSalesV1Adapter(async () => new Response(null, {
    status: 304,
    headers: { etag: '"sha256:different"' },
  }));
  await assert.rejects(
    mismatched304.pull({
      endpointUrl: 'https://egoric.example/api/integrations/leozops/v1/lead-snapshot',
      bearerToken: 'key',
      sourceTenantKey: 'egoric',
      previousEtag: '"sha256:previous"',
    }),
    (error: unknown) => error instanceof SourceAdapterError
      && error.code === 'etag_mismatch'
      && error.disableConnection,
  );
});

test('adapter discards a malformed source correlation header', async () => {
  const snapshot = snapshotFor('egoric');
  const adapter = new EgoricSalesV1Adapter(
    async () => new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        etag: `"${snapshot.snapshot_id}"`,
        'x-correlation-id': 'pii@example.com',
      },
    }),
    () => '22222222-2222-4222-8222-222222222222',
  );
  const result = await adapter.pull({
    endpointUrl: 'https://egoric.example/api/integrations/leozops/v1/lead-snapshot',
    bearerToken: 'key',
    sourceTenantKey: 'egoric',
  });
  assert.equal(result.correlation_id, '22222222-2222-4222-8222-222222222222');
});

test('tenant and source connection identities are idempotent and separate from legacy Client', async () => {
  const { tenant, connection } = await setupConnection();
  const tenantAgain = await repository.ensureTenant({
    tenantKey: tenant.tenant_key,
    displayName: tenant.display_name,
  });
  const connectionAgain = await repository.ensureSourceConnection({
    tenantId: tenant.id,
    sourceSystem: connection.source_system,
    sourceTenantKey: connection.source_tenant_key,
    schemaVersion: connection.schema_version,
    endpointUrl: connection.endpoint_url,
  });
  assert.equal(tenantAgain.id, tenant.id);
  assert.equal(connectionAgain.id, connection.id);
  assert.equal(await db('clients').where({ id: tenant.id }).first(), undefined);
});

test('source connection rejects credential-bearing or generic URLs before persistence', async () => {
  const tenant = await repository.ensureTenant({
    tenantKey: `tenant-${++sequence}`,
    displayName: `Tenant ${sequence}`,
  });
  for (const endpointUrl of [
    'https://user:secret@egoric.example/api/integrations/leozops/v1/lead-snapshot',
    'https://egoric.example/api/integrations/leozops/v1/lead-snapshot?token=secret',
    'https://egoric.example/api/v1/leads',
  ]) {
    await assert.rejects(
      repository.ensureSourceConnection({
        tenantId: tenant.id,
        sourceSystem: 'egoric',
        sourceTenantKey: `unsafe-${sequence}`,
        schemaVersion: EGORIC_SCHEMA_VERSION,
        endpointUrl,
      }),
      (error: unknown) => error instanceof BusinessMemoryError && error.code === 'invalid_endpoint',
    );
  }
  const persistedConnections = await db(BUSINESS_MEMORY_TABLES.sourceConnections)
    .where({ tenant_id: tenant.id })
    .count<{ count: number | string }>({ count: '*' })
    .first();
  assert.equal(Number(persistedConnections?.count ?? 0), 0);
});

test('replaying the same 200 snapshot stores exactly one immutable snapshot and one run', async () => {
  const { tenant, connection } = await setupConnection();
  const snapshot = snapshotFor(connection.source_tenant_key);
  const calls: RequestInit[] = [];
  const adapter = new EgoricSalesV1Adapter(async (_input, init) => {
    calls.push(init ?? {});
    return jsonResponse(snapshot);
  });
  const service = new SnapshotIngestionService(repository, adapter);
  const request = {
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    bearerToken: 'raw-local-only',
    engineVersion: 'egoric_ingestion_v1',
    asOf: '2026-07-28T00:00:00.000Z',
  };

  const first = await service.pullOnce(request);
  const replay = await service.pullOnce(request);
  assert.equal(first.kind, 'accepted');
  assert.equal(replay.kind, 'accepted');
  if (first.kind !== 'accepted' || replay.kind !== 'accepted') return;
  assert.equal(first.snapshot_created, true);
  assert.equal(first.run_created, true);
  assert.equal(replay.snapshot_created, false);
  assert.equal(replay.run_created, false);
  assert.equal((await repository.listSnapshotsForTenant(tenant.id)).length, 1);
  assert.equal((await repository.listRunsForTenant(tenant.id)).length, 1);
  assert.ok(calls.every((call) => call.method === 'GET' && call.body === undefined));

  const storedConnections = await db(BUSINESS_MEMORY_TABLES.sourceConnections).where({ id: connection.id });
  assert.ok(!JSON.stringify(storedConnections).includes('raw-local-only'), 'raw key must never be persisted');
});

test('304 performs no snapshot or intelligence-run work', async () => {
  const { tenant, connection } = await setupConnection();
  const snapshot = snapshotFor(connection.source_tenant_key);
  let count = 0;
  const adapter = new EgoricSalesV1Adapter(async () => {
    count += 1;
    if (count === 1) return jsonResponse(snapshot);
    return new Response(null, {
      status: 304,
      headers: { etag: `"${snapshot.snapshot_id}"` },
    });
  });
  const service = new SnapshotIngestionService(repository, adapter);
  const base = {
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    bearerToken: 'key',
    engineVersion: 'egoric_ingestion_v1',
  };
  assert.equal((await service.pullOnce({ ...base, asOf: '2026-07-28T00:00:00Z' })).kind, 'accepted');
  assert.equal((await service.pullOnce({ ...base, asOf: '2026-07-29T00:00:00Z' })).kind, 'not_modified');
  assert.equal((await repository.listSnapshotsForTenant(tenant.id)).length, 1);
  assert.equal((await repository.listRunsForTenant(tenant.id)).length, 1);
});

test('schema failure persists nothing and disables the affected connection', async () => {
  const { tenant, connection } = await setupConnection();
  const snapshot = snapshotFor(connection.source_tenant_key);
  const adapter = new EgoricSalesV1Adapter(async () => new Response(
    JSON.stringify({ ...snapshot, schema_version: '9.9' }),
    { status: 200, headers: { 'content-type': 'application/json', etag: `"${snapshot.snapshot_id}"` } },
  ));
  const service = new SnapshotIngestionService(repository, adapter);
  await assert.rejects(
    service.pullOnce({
      tenantId: tenant.id,
      sourceConnectionId: connection.id,
      bearerToken: 'key',
      engineVersion: 'egoric_ingestion_v1',
      asOf: '2026-07-28T00:00:00Z',
    }),
    (error: unknown) => error instanceof SourceAdapterError
      && error.code === 'unsupported_schema_version',
  );
  assert.equal((await repository.listSnapshotsForTenant(tenant.id)).length, 0);
  assert.equal((await repository.listRunsForTenant(tenant.id)).length, 0);
  const disabled = await repository.findSourceConnectionForTenant(tenant.id, connection.id);
  assert.equal(disabled?.status, 'disabled');
});

test('tenant scoping is enforced in repository lookups and by composite foreign keys', async () => {
  const a = await setupConnection();
  const b = await setupConnection();
  const payload = snapshotFor(a.connection.source_tenant_key);

  await assert.rejects(
    repository.acceptSnapshot({
      tenantId: b.tenant.id,
      sourceConnectionId: a.connection.id,
      payload,
      engineVersion: 'egoric_ingestion_v1',
      asOf: '2026-07-28T00:00:00Z',
    }),
    (error: unknown) => error instanceof BusinessMemoryError
      && error.code === 'unknown_source_connection',
  );

  await assert.rejects(
    db(BUSINESS_MEMORY_TABLES.sourceSnapshots).insert({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenant_id: b.tenant.id,
      source_connection_id: a.connection.id,
      source_system: 'egoric',
      source_tenant_key: 'cross-tenant',
      schema_version: EGORIC_SCHEMA_VERSION,
      snapshot_id: `sha256:${'a'.repeat(64)}`,
      generated_at: fixedNow.toISOString(),
      received_at: fixedNow.toISOString(),
      payload_json: '{}',
      record_count: 0,
      created_at: fixedNow.toISOString(),
    }),
    (error: any) => /foreign key/i.test(String(error?.message ?? '')),
  );
});

test('database rejects direct snapshot UPDATE and DELETE mutations', async () => {
  const { tenant, connection } = await setupConnection();
  const accepted = await repository.acceptSnapshot({
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    payload: snapshotFor(connection.source_tenant_key),
    engineVersion: 'egoric_ingestion_v1',
    asOf: '2026-07-28T00:00:00Z',
  });

  await assert.rejects(
    db(BUSINESS_MEMORY_TABLES.sourceSnapshots)
      .where({ id: accepted.snapshot.id })
      .update({ record_count: 999 }),
    (error: any) => /immutable/i.test(String(error?.message ?? '')),
  );
  await assert.rejects(
    db(BUSINESS_MEMORY_TABLES.sourceSnapshots)
      .where({ id: accepted.snapshot.id })
      .del(),
    (error: any) => /immutable/i.test(String(error?.message ?? '')),
  );
});

test('Business Memory migration rolls back tables and immutability triggers cleanly', async () => {
  await db.migrate.rollback();
  const objects = await db('sqlite_master')
    .whereIn('type', ['table', 'trigger'])
    .select('type', 'name');
  const names = new Set(objects.map((object: { name: string }) => object.name));
  for (const name of [
    BUSINESS_MEMORY_TABLES.tenants,
    BUSINESS_MEMORY_TABLES.sourceConnections,
    BUSINESS_MEMORY_TABLES.sourceSnapshots,
    BUSINESS_MEMORY_TABLES.intelligenceRuns,
    SOURCE_POLL_STATE_TABLE,
    'source_snapshots_no_update',
    'source_snapshots_no_delete',
  ]) {
    assert.ok(!names.has(name), `expected ${name} to be removed by rollback`);
  }
});
