import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import { v4 as uuidv4 } from 'uuid';
import config from '../../knexfile';
import { BUSINESS_MEMORY_TABLES } from '../domain/businessMemory';
import { EGORIC_BRIEF_FORMULA_VERSION } from '../domain/egoricBrief';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { EgoricBriefError, EgoricBriefService } from '../services/egoricBriefService';
import {
  DEFAULT_EGORIC_LEADS,
  buildEgoricSnapshot,
  seedEgoricMemory,
} from './support/egoricMemoryScenario';

const db = knexFactory(config.test);

before(async () => {
  await db.migrate.latest();
});

after(async () => {
  await db.destroy();
});

test('brief is exact, deterministic, Egoric-native, and fully provenance-labelled', async () => {
  const seeded = await seedEgoricMemory(db, { tenantKey: 'native-brief' });
  const service = new EgoricBriefService(seeded.repository);
  const first = await service.generate('native-brief');
  const second = await service.generate('native-brief');

  assert.deepEqual(second, first);
  assert.equal(first.formula_version, EGORIC_BRIEF_FORMULA_VERSION);
  assert.equal(first.source_snapshot_id, seeded.snapshot.snapshot_id);
  assert.equal(first.intelligence_run_id, seeded.accepted.run.id);
  assert.equal(first.source_engine_version, 'egoric_ingestion_v1');
  assert.equal(first.generated_at, '2026-07-28T23:00:00.000Z');
  assert.equal(first.as_of, '2026-07-28T23:00:00.000Z');
  assert.deepEqual(first.funnel_definition.active_stages, [
    'new', 'contacted', 'proposal', 'negotiation',
  ]);
  assert.deepEqual(first.funnel_definition.terminal_outcomes, ['won', 'lost']);
  assert.equal(first.funnel_definition.historical_transitions_available, false);
  assert.deepEqual(first.stages.map((stage) => stage.stage), [
    'new', 'contacted', 'proposal', 'negotiation', 'won', 'lost',
  ]);
  assert.deepEqual(first.stages.map((stage) => stage.count), [1, 1, 1, 0, 1, 1]);
  assert.deepEqual(first.headline, {
    total_leads: 5,
    active_pipeline: 3,
    won: 1,
    lost: 1,
    closed: 2,
    win_rate: 0.5,
    active_estimated_value: 600,
    estimated_value_currency: null,
    active_owner_coverage: 0.3333,
    overdue_expected_close: 1,
  });
  assert.equal(first.data_freshness.status, 'fresh');
  assert.equal(first.data_freshness.age_seconds, 900);
  assert.equal(first.advisory_only, true);
  assert.ok(first.known_limitations.some((row) => row.code === 'current_state_only'));
  assert.ok(first.known_limitations.some((row) => row.code === 'client_attribution_unavailable'));

  const output = first as unknown as Record<string, unknown>;
  const serialized = JSON.stringify(output);
  for (const prohibitedKey of ['external_id', 'email', 'phone', 'owner_id', 'conversion_from_previous', 'reached']) {
    assert.equal(serialized.includes(`"${prohibitedKey}"`), false);
  }
});

test('brief exposes deterministic current-state attention facts without claiming history', async () => {
  const seeded = await seedEgoricMemory(db, { tenantKey: 'attention-brief' });
  const brief = await new EgoricBriefService(seeded.repository).generate(
    'attention-brief',
    '2026-07-28',
  );

  assert.equal(brief.as_of, '2026-07-28T23:59:59.999Z');
  assert.deepEqual(brief.observations.map((row) => row.code), [
    'current_pipeline_state',
    'overdue_expected_close',
    'unassigned_active_leads',
    'missing_lead_source',
    'stale',
  ]);
  assert.ok(brief.known_limitations.some((row) => row.code === 'stale'));
  assert.deepEqual(brief.sources, [
    { source: 'Ads', count: 2 },
    { source: null, count: 1 },
    { source: 'Organic', count: 1 },
    { source: 'Referral', count: 1 },
  ]);
  assert.deepEqual(brief.quality, {
    records: 5,
    missing_source: 1,
    missing_created_at: 1,
    client_attribution: 'unavailable',
  });
});

test('asOf selects the latest accepted run at or before the requested cutoff', async () => {
  const seeded = await seedEgoricMemory(db, {
    tenantKey: 'cutoff-brief',
    asOf: '2026-07-28T12:00:00.000Z',
    generatedAt: '2026-07-28T11:55:00.000Z',
    receivedAt: '2026-07-28T12:00:00.000Z',
  });
  const laterSnapshot = buildEgoricSnapshot({
    sourceTenantKey: seeded.connection.source_tenant_key,
    leads: DEFAULT_EGORIC_LEADS.slice(0, 2),
    generatedAt: '2026-07-29T11:55:00.000Z',
  });
  const laterRepository = new BusinessMemoryRepository(db, () => new Date('2026-07-29T12:00:00.000Z'));
  await laterRepository.acceptSnapshot({
    tenantId: seeded.tenant.id,
    sourceConnectionId: seeded.connection.id,
    payload: laterSnapshot,
    engineVersion: 'egoric_ingestion_v1',
    asOf: '2026-07-29T12:00:00.000Z',
  });
  const service = new EgoricBriefService(laterRepository);

  assert.equal((await service.generate('cutoff-brief', '2026-07-28')).headline.total_leads, 5);
  assert.equal((await service.generate('cutoff-brief')).headline.total_leads, 2);
});

test('unsafe source labels are withheld from the CEO Brief', async () => {
  const unsafeValue = 'ceo-private@example.com';
  const leads = DEFAULT_EGORIC_LEADS.map((lead, index) =>
    index === 0 ? { ...lead, source: unsafeValue } : lead);
  const seeded = await seedEgoricMemory(db, { tenantKey: 'safe-source-brief', leads });
  const brief = await new EgoricBriefService(seeded.repository).generate('safe-source-brief');
  const serialized = JSON.stringify(brief);

  assert.equal(serialized.includes(unsafeValue), false);
  assert.ok(brief.sources.some((row) => row.source === 'unclassified' && row.count === 1));
  assert.ok(brief.observations.some((row) => row.code === 'unclassified_lead_source'));
  assert.ok(brief.known_limitations.some((row) => row.code === 'unclassified_source'));
});

test('non-finite aggregate values fail closed instead of serializing misleading nulls', async () => {
  const leads = DEFAULT_EGORIC_LEADS.slice(0, 2).map((lead) => ({
    ...lead,
    estimated_value: 1e308,
  }));
  const seeded = await seedEgoricMemory(db, { tenantKey: 'overflow-brief', leads });
  await assert.rejects(
    new EgoricBriefService(seeded.repository).generate('overflow-brief'),
    (error: unknown) => error instanceof EgoricBriefError && error.code === 'numeric_overflow',
  );
});

test('unknown tenant, invalid asOf, missing snapshot, and corrupt stored payload fail closed', async () => {
  const repository = new BusinessMemoryRepository(db, () => new Date('2026-07-30T00:00:00.000Z'));
  const service = new EgoricBriefService(repository);
  await assert.rejects(
    service.generate('missing-tenant'),
    (error: unknown) => error instanceof EgoricBriefError && error.code === 'tenant_not_found',
  );
  await assert.rejects(
    service.generate('bad key'),
    (error: unknown) => error instanceof EgoricBriefError && error.code === 'invalid_tenant_key',
  );
  const empty = await repository.ensureTenant({ tenantKey: 'empty-brief', displayName: 'Empty' });
  await assert.rejects(
    service.generate(empty.tenant_key),
    (error: unknown) => error instanceof EgoricBriefError && error.code === 'brief_not_available',
  );
  await assert.rejects(
    service.generate(empty.tenant_key, '2026-99-99'),
    (error: unknown) => error instanceof EgoricBriefError && error.code === 'invalid_as_of',
  );

  const seeded = await seedEgoricMemory(db, { tenantKey: 'corrupt-brief' });
  const badSnapshotId = `sha256:${'f'.repeat(64)}`;
  const badSnapshotRowId = uuidv4();
  await db(BUSINESS_MEMORY_TABLES.sourceSnapshots).insert({
    id: badSnapshotRowId,
    tenant_id: seeded.tenant.id,
    source_connection_id: seeded.connection.id,
    source_system: 'egoric',
    source_tenant_key: seeded.connection.source_tenant_key,
    schema_version: '1.0',
    snapshot_id: badSnapshotId,
    generated_at: '2026-07-30T00:00:00.000Z',
    received_at: '2026-07-30T00:00:00.000Z',
    payload_json: '{not-json',
    record_count: 0,
    created_at: '2026-07-30T00:00:00.000Z',
  });
  await db(BUSINESS_MEMORY_TABLES.intelligenceRuns).insert({
    id: uuidv4(),
    tenant_id: seeded.tenant.id,
    source_snapshot_id: badSnapshotRowId,
    snapshot_id: badSnapshotId,
    engine_version: 'egoric_ingestion_v1',
    as_of: '2026-07-30T00:00:00.000Z',
    status: 'accepted',
    created_at: '2026-07-30T00:00:00.000Z',
  });
  await assert.rejects(
    new EgoricBriefService(seeded.repository).generate('corrupt-brief'),
    (error: unknown) => error instanceof EgoricBriefError && error.code === 'invalid_stored_snapshot',
  );
});
