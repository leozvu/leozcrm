import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import knexFactory from 'knex';
import config from '../../knexfile';
import { PHASE2_TABLES, ShadowTrustError, nextBusinessDate } from '../domain/shadowTrust';
import { SourceOperationsRepository } from '../repositories/sourceOperationsRepository';
import { ShadowTrustRepository } from '../repositories/shadowTrustRepository';
import { EgoricBriefService } from '../services/egoricBriefService';
import { ShadowTrustService } from '../services/shadowTrustService';
import { SourceReconciliationService } from '../services/sourceReconciliationService';
import { SourceShadowWorker } from '../services/sourceShadowWorker';
import { seedEgoricMemory } from './support/egoricMemoryScenario';

const db = knexFactory(config.test);
const businessDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
let now = new Date('2026-08-03T22:00:00.000Z');

before(async () => {
  await db.migrate.latest();
});

after(async () => {
  await db.destroy();
});

async function harness(name: string) {
  const seeded = await seedEgoricMemory(db, {
    tenantKey: `${name}-tenant`,
    sourceTenantKey: `${name}-source`,
    receivedAt: '2026-08-03T12:00:00.000Z',
    asOf: '2026-08-03T12:00:00.000Z',
  });
  const operations = new SourceOperationsRepository(db);
  const evidence = new ShadowTrustRepository(db);
  const reconciliation = new SourceReconciliationService(
    operations,
    new EgoricBriefService(seeded.repository),
    { emit: async () => undefined },
    () => now,
  );
  const service = new ShadowTrustService(evidence, operations, reconciliation, () => now);
  return { seeded, evidence, service };
}

async function recordPassingPolls(
  evidence: ShadowTrustRepository,
  tenantId: string,
  sourceConnectionId: string,
  businessDate: string,
  snapshotId: string,
  runId: string,
  authorizationId = 'P2-SHADOW-001',
  firstUtcHour = 13,
): Promise<void> {
  const first = Date.parse(`${businessDate}T${String(firstUtcHour).padStart(2, '0')}:00:00.000Z`);
  for (let index = 0; index < 36; index += 1) {
    const started = new Date(first + index * 15 * 60 * 1_000).toISOString();
    await evidence.recordPollRun({
      tenant_id: tenantId,
      source_connection_id: sourceConnectionId,
      environment: 'production',
      authorization_id: authorizationId,
      correlation_id: randomUUID(),
      started_at: started,
      finished_at: new Date(Date.parse(started) + 100).toISOString(),
      latency_ms: 100,
      outcome: index === 0 ? 'accepted' : 'not_modified',
      attempt_count: 1,
      http_status: index === 0 ? 200 : 304,
      error_code: null,
      request_method: 'GET',
      request_body_present: false,
      snapshot_id: snapshotId,
      intelligence_run_id: runId,
      record_count: 5,
      source_generated_at: '2026-08-03T12:00:00.000Z',
      confirmed_fresh_at: started,
      source_mutation_count: 0,
    });
  }
}

async function closePassingDay(
  service: ShadowTrustService,
  tenantId: string,
  sourceConnectionId: string,
  businessDate: string,
) {
  now = new Date(`${businessDate}T22:00:00.000Z`);
  return service.closeBusinessDay({
    tenantId,
    sourceConnectionId,
    authorizationId: 'P2-SHADOW-001',
    businessDate,
    businessTimezone: 'America/New_York',
    businessDays,
    businessStartLocal: '09:00',
    businessEndLocal: '18:00',
    staleAfterMs: 1_800_000,
    expectedReviewer: 'Leoz',
    reviewer: 'Leoz',
    reviewerScore: 4,
    materialFalseClaim: false,
    observedSourceMutationCount: 0,
    employeeWorkflowRegression: false,
    sourceLatencyRegression: false,
    sourceErrorRegression: false,
    incidentCount: 0,
    rollbackEventCount: 0,
  });
}

test('daily evidence aggregates exact read-only poll proof and is database-immutable', async () => {
  const { seeded, evidence, service } = await harness('daily-pass');
  await recordPassingPolls(
    evidence,
    seeded.tenant.id,
    seeded.connection.id,
    '2026-08-03',
    seeded.snapshot.snapshot_id,
    seeded.accepted.run.id,
  );
  const day = await closePassingDay(service, seeded.tenant.id, seeded.connection.id, '2026-08-03');
  assert.equal(day.status, 'passed');
  assert.equal(day.expected_syncs, 36);
  assert.equal(day.scheduled_syncs, 36);
  assert.equal(day.successful_syncs, 36);
  assert.equal(day.not_modified_syncs, 35);
  assert.equal(day.source_mutation_count, 0);
  assert.deepEqual(JSON.parse(day.failure_codes_json), []);

  await assert.rejects(
    db(PHASE2_TABLES.dailyEvidence).where({ id: day.id }).update({ reviewer_score: 5 }),
    /immutable/,
  );
  await assert.rejects(
    db(PHASE2_TABLES.pollRuns).where({ tenant_id: seeded.tenant.id }).delete(),
    /immutable/,
  );
});

test('one-shot worker records safe accepted evidence and rejects correlation conflicts', async () => {
  const { seeded, evidence } = await harness('worker-evidence');
  await seeded.repository.recordPullSuccess(
    seeded.tenant.id,
    seeded.connection.id,
    `"${seeded.snapshot.snapshot_id}"`,
  );
  const correlationId = randomUUID();
  const times = [
    new Date('2026-08-03T13:00:00.000Z'),
    new Date('2026-08-03T13:00:00.100Z'),
  ];
  const worker = new SourceShadowWorker(
    () => ({
      runOnce: async () => ({
        kind: 'succeeded' as const,
        outcome: 'accepted' as const,
        attempts: 1,
        correlation_id: correlationId,
        state: {} as any,
      }),
    }),
    new SourceOperationsRepository(db),
    evidence,
    () => times.shift() ?? new Date('2026-08-03T13:00:00.100Z'),
  );
  const result = await worker.runOnce({
    tenantId: seeded.tenant.id,
    sourceConnectionId: seeded.connection.id,
    bearerToken: 'not-persisted-source-token',
    engineVersion: 'shadow_test_v1',
    environment: 'production',
    authorizationId: 'P2-SHADOW-001',
  });
  assert.equal(result.evidence.outcome, 'accepted');
  assert.equal(result.evidence.http_status, 200);
  assert.equal(result.evidence.request_method, 'GET');
  assert.equal(result.evidence.request_body_present, false);
  assert.equal(result.evidence.source_mutation_count, 0);
  assert.equal(result.evidence.snapshot_id, seeded.snapshot.snapshot_id);
  assert.doesNotMatch(JSON.stringify(result.evidence), /not-persisted-source-token/);

  const { id: _id, created_at: _createdAt, ...replay } = result.evidence;
  await assert.rejects(
    evidence.recordPollRun({ ...replay, latency_ms: replay.latency_ms + 1 }),
    (error: unknown) => error instanceof ShadowTrustError && error.code === 'poll_evidence_conflict',
  );
});

test('ten consecutive business days unlock go and bind the immutable decision to evaluation', async () => {
  const { seeded, evidence, service } = await harness('window-pass');
  let businessDate = '2026-08-03';
  for (let index = 0; index < 10; index += 1) {
    await recordPassingPolls(
      evidence,
      seeded.tenant.id,
      seeded.connection.id,
      businessDate,
      seeded.snapshot.snapshot_id,
      seeded.accepted.run.id,
    );
    await closePassingDay(service, seeded.tenant.id, seeded.connection.id, businessDate);
    if (index < 9) businessDate = nextBusinessDate(businessDate, businessDays);
  }
  const evaluation = await service.evaluate({
    tenantId: seeded.tenant.id,
    sourceConnectionId: seeded.connection.id,
    businessDays,
  });
  assert.equal(evaluation.verdict, 'pass');
  assert.equal(evaluation.consecutive_business_days, 10);
  assert.equal(evaluation.success_rate, 1);
  assert.equal(evaluation.average_reviewer_score, 4);

  const release = await service.decide({
    tenantId: seeded.tenant.id,
    sourceConnectionId: seeded.connection.id,
    authorizationId: 'P2-SHADOW-001',
    businessDays,
    decision: 'go',
    decidedBy: 'Leoz',
    reasonCode: 'g5_shadow_passed',
  });
  assert.equal(release.decision.decision, 'go');
  assert.equal(release.decision.evaluation_fingerprint, evaluation.evidence_fingerprint);
});

test('failed or incomplete evidence blocks go but still permits an honest revoke', async () => {
  const { seeded, evidence, service } = await harness('window-blocked');
  await recordPassingPolls(
    evidence,
    seeded.tenant.id,
    seeded.connection.id,
    '2026-08-03',
    seeded.snapshot.snapshot_id,
    seeded.accepted.run.id,
  );
  await closePassingDay(service, seeded.tenant.id, seeded.connection.id, '2026-08-03');
  await assert.rejects(
    service.decide({
      tenantId: seeded.tenant.id,
      sourceConnectionId: seeded.connection.id,
      authorizationId: 'P2-SHADOW-001',
      businessDays,
      decision: 'go',
      decidedBy: 'Leoz',
      reasonCode: 'premature_go',
    }),
    (error: unknown) => error instanceof ShadowTrustError && error.code === 'shadow_gate_blocked',
  );
  const revoked = await service.decide({
    tenantId: seeded.tenant.id,
    sourceConnectionId: seeded.connection.id,
    authorizationId: 'P2-SHADOW-001',
    businessDays,
    decision: 'revoke',
    decidedBy: 'Leoz',
    reasonCode: 'operator_revoked',
  });
  assert.equal(revoked.decision.decision, 'revoke');
  assert.equal(revoked.evaluation.verdict, 'blocked');
});

test('authorization mixing and material false claims fail a shadow day', async () => {
  const { seeded, evidence, service } = await harness('daily-fail');
  await recordPassingPolls(
    evidence,
    seeded.tenant.id,
    seeded.connection.id,
    '2026-08-03',
    seeded.snapshot.snapshot_id,
    seeded.accepted.run.id,
    'P2-WRONG-AUTH',
  );
  now = new Date('2026-08-03T22:00:00.000Z');
  const day = await service.closeBusinessDay({
    tenantId: seeded.tenant.id,
    sourceConnectionId: seeded.connection.id,
    authorizationId: 'P2-SHADOW-001',
    businessDate: '2026-08-03',
    businessTimezone: 'America/New_York',
    businessDays,
    businessStartLocal: '09:00',
    businessEndLocal: '18:00',
    staleAfterMs: 1_800_000,
    expectedReviewer: 'Leoz',
    reviewer: 'Leoz',
    reviewerScore: 5,
    materialFalseClaim: true,
    observedSourceMutationCount: 0,
    employeeWorkflowRegression: false,
    sourceLatencyRegression: false,
    sourceErrorRegression: false,
    incidentCount: 1,
    rollbackEventCount: 0,
  });
  assert.equal(day.status, 'failed');
  assert.deepEqual(JSON.parse(day.failure_codes_json), [
    'authorization_mismatch',
    'daily_poll_failure',
    'material_false_claim',
    'scheduled_sync_coverage_failed',
    'source_stale',
  ]);
});

test('polls outside the approved business window cannot satisfy daily schedule coverage', async () => {
  const { seeded, evidence, service } = await harness('outside-window');
  await recordPassingPolls(
    evidence,
    seeded.tenant.id,
    seeded.connection.id,
    '2026-08-03',
    seeded.snapshot.snapshot_id,
    seeded.accepted.run.id,
    'P2-SHADOW-001',
    4,
  );
  const day = await closePassingDay(service, seeded.tenant.id, seeded.connection.id, '2026-08-03');
  assert.equal(day.status, 'failed');
  assert.equal(day.scheduled_syncs, 0);
  assert.match(day.failure_codes_json, /scheduled_sync_coverage_failed/);
});
