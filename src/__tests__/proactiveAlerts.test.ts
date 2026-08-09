import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import knexFactory from 'knex';
import config from '../../knexfile';
import {
  EGORIC_ACTIVE_STAGES,
  EGORIC_SCHEMA_VERSION,
  EgoricSalesLead,
} from '../domain/businessMemory';
import { PROACTIVE_TABLES, ProactiveAlertError } from '../domain/proactiveAlerts';
import {
  NotificationDeliveryAdapter,
  NotificationDeliveryRegistry,
  buildNotificationDeliveryRegistry,
} from '../integrations/notifications/notificationDeliveryRegistry';
import { createApp } from '../http/app';
import { signTenantReadToken } from '../http/integrationReadAuth';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { ProactiveAlertRepository } from '../repositories/proactiveAlertRepository';
import { EgoricBriefService } from '../services/egoricBriefService';
import { ProactiveAlertService } from '../services/proactiveAlertService';
import { buildEgoricSnapshot, DEFAULT_EGORIC_LEADS } from './support/egoricMemoryScenario';
import { DeterministicAdvisorProvider } from '../integrations/advisor/deterministicAdvisorProvider';

const db = knexFactory(config.test);
const AUTH = { secret: 'phase11-read-secret', adminKey: 'phase11-read-admin' };
let tenantSequence = 0;

before(async () => {
  await db.migrate.latest();
});

after(async () => {
  await db.destroy();
});

function urgentLeads(extra = 0): EgoricSalesLead[] {
  const base = DEFAULT_EGORIC_LEADS.map((lead, index) => ({
    ...lead,
    source: lead.source ?? 'Direct',
    created_at: lead.created_at ?? '2026-07-29T08:00:00.000Z',
    expected_close_at: EGORIC_ACTIVE_STAGES.includes(lead.stage as never)
      ? '2026-07-29T09:00:00.000Z'
      : null,
    owner_assigned: EGORIC_ACTIVE_STAGES.includes(lead.stage as never) ? false : lead.owner_assigned,
    external_id: `urgent-${index}`,
  }));
  for (let index = 0; index < extra; index += 1) {
    base.push({
      external_id: `urgent-extra-${index}`,
      stage: 'negotiation',
      source: 'Direct',
      estimated_value: 50,
      created_at: '2026-07-29T08:00:00.000Z',
      expected_close_at: '2026-07-29T09:00:00.000Z',
      owner_assigned: false,
    });
  }
  return base;
}

function cleanLeads(): EgoricSalesLead[] {
  return urgentLeads().map((lead) => EGORIC_ACTIVE_STAGES.includes(lead.stage as never)
    ? { ...lead, expected_close_at: '2026-08-10T12:00:00.000Z', owner_assigned: true }
    : lead);
}

async function harness(input: {
  leads?: EgoricSalesLead[];
  now?: string;
  generatedAt?: string;
  registry?: NotificationDeliveryRegistry;
  uuid?: () => string;
} = {}) {
  tenantSequence += 1;
  const tenantKey = `phase11-${tenantSequence}`;
  const sourceTenantKey = `phase11-source-${tenantSequence}`;
  let now = input.now ?? '2026-07-29T12:00:00.000Z';
  const clock = () => new Date(now);
  const memory = new BusinessMemoryRepository(db, clock);
  const tenant = await memory.ensureTenant({ tenantKey, displayName: `Phase 11 ${tenantSequence}` });
  const connection = await memory.ensureSourceConnection({
    tenantId: tenant.id,
    sourceSystem: 'egoric',
    sourceTenantKey,
    schemaVersion: EGORIC_SCHEMA_VERSION,
    endpointUrl: `https://phase11-${tenantSequence}.example/api/integrations/leozops/v1/lead-snapshot`,
  });
  const accept = async (leads: EgoricSalesLead[], at: string, generatedAt?: string) => {
    now = at;
    return memory.acceptSnapshot({
      tenantId: tenant.id,
      sourceConnectionId: connection.id,
      payload: buildEgoricSnapshot({
        sourceTenantKey,
        leads,
        generatedAt: generatedAt ?? new Date(Date.parse(at) - 10 * 60_000).toISOString(),
      }),
      engineVersion: 'egoric_ingestion_v1',
      asOf: at,
    });
  };
  await accept(input.leads ?? urgentLeads(), now, input.generatedAt);
  const repository = new ProactiveAlertRepository(db, clock, input.uuid);
  const service = new ProactiveAlertService(
    repository,
    memory,
    new EgoricBriefService(memory),
    input.registry ?? new NotificationDeliveryRegistry(),
    clock,
  );
  return { tenantKey, tenant, connection, memory, repository, service, accept, clock, setNow: (value: string) => { now = value; } };
}

test('duplicate cycles and duplicate source snapshots cannot duplicate logical alerts', async () => {
  const run = await harness();
  const first = await run.service.runCycle(run.tenantKey, { mode: 'evaluate', idempotencyKey: 'cycle-1' });
  assert.equal(first.replayed, false);
  assert.equal(first.alerts.length, 2);
  assert.deepEqual(first.alerts.map((alert) => alert.severity), ['urgent', 'urgent']);
  assert.equal(first.outbox.length, 2);

  const replay = await run.service.runCycle(run.tenantKey, { mode: 'evaluate', idempotencyKey: 'cycle-1' });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.alerts.map((alert) => alert.id), first.alerts.map((alert) => alert.id));

  run.setNow('2026-07-29T12:15:00.000Z');
  const duplicateSnapshot = await run.service.runCycle(run.tenantKey, { mode: 'evaluate', idempotencyKey: 'cycle-2' });
  assert.equal(duplicateSnapshot.alerts.length, 0);
  assert.deepEqual(duplicateSnapshot.evaluations.map((row) => row.status), ['no_change', 'no_change']);
  assert.equal((await run.service.listAlerts(run.tenantKey)).length, 2);
});

test('a failed cycle rolls back alerts and outbox atomically, then safely retries', async () => {
  let uuidCalls = 0;
  let failOnce = true;
  const run = await harness({
    uuid: () => {
      uuidCalls += 1;
      if (failOnce && uuidCalls === 4) {
        failOnce = false;
        throw new Error('injected cycle persistence failure');
      }
      return randomUUID();
    },
  });
  await assert.rejects(() => run.service.runCycle(run.tenantKey, {
    mode: 'evaluate', idempotencyKey: 'atomic-cycle-1',
  }), /injected cycle persistence failure/);
  for (const table of [PROACTIVE_TABLES.cycles, PROACTIVE_TABLES.evaluations, PROACTIVE_TABLES.alerts, PROACTIVE_TABLES.outbox]) {
    assert.equal(Number((await db(table).where({ tenant_id: run.tenant.id }).count<{ count: number }[]>({ count: '*' }))[0].count), 0);
  }
  const retry = await run.service.runCycle(run.tenantKey, {
    mode: 'evaluate', idempotencyKey: 'atomic-cycle-1',
  });
  assert.equal(retry.replayed, false);
  assert.equal(retry.evaluations.length, 2);
  assert.equal(retry.alerts.length, 2);
  assert.equal(retry.outbox.length, 2);
});

test('stale, future, and partial evidence suppress every confident alert', async () => {
  const partial = await harness({ leads: DEFAULT_EGORIC_LEADS });
  const partialCycle = await partial.service.runCycle(partial.tenantKey, {
    mode: 'evaluate', idempotencyKey: 'partial-cycle',
  });
  assert.equal(partialCycle.alerts.length, 0);
  assert.deepEqual(partialCycle.evaluations.map((row) => row.status), ['suppressed_partial', 'suppressed_partial']);

  const stale = await harness({ generatedAt: '2026-07-29T08:00:00.000Z' });
  const staleCycle = await stale.service.runCycle(stale.tenantKey, {
    mode: 'evaluate', idempotencyKey: 'stale-cycle',
  });
  assert.equal(staleCycle.alerts.length, 0);
  assert.deepEqual(staleCycle.evaluations.map((row) => row.status), ['suppressed_stale', 'suppressed_stale']);

  const future = await harness({ generatedAt: '2026-07-29T13:00:00.000Z' });
  const futureCycle = await future.service.runCycle(future.tenantKey, {
    mode: 'evaluate', idempotencyKey: 'future-cycle',
  });
  assert.equal(futureCycle.alerts.length, 0);
  assert.deepEqual(futureCycle.evaluations.map((row) => row.status), ['suppressed_stale', 'suppressed_stale']);

  const refreshedFacts = urgentLeads().map((lead, index) => index === 0
    ? { ...lead, estimated_value: (lead.estimated_value ?? 0) + 1 }
    : lead);
  await stale.accept(refreshedFacts, '2026-07-29T12:10:00.000Z');
  const freshAfterStale = await stale.service.runCycle(stale.tenantKey, {
    mode: 'evaluate', idempotencyKey: 'fresh-after-stale-cycle',
  });
  assert.equal(freshAfterStale.alerts.length, 2);
  assert.deepEqual(freshAfterStale.evaluations.map((row) => row.status), ['triggered', 'triggered']);
});

test('worsening signals obey cooldown and snooze while a cleared condition resolves append-only', async () => {
  const run = await harness();
  const first = await run.service.runCycle(run.tenantKey, { mode: 'evaluate', idempotencyKey: 'state-1' });
  const overdue = first.alerts.find((alert) => alert.rule_id === 'overdue_expected_close');
  assert.ok(overdue);
  await run.service.snooze(run.tenantKey, {
    alertId: overdue.id,
    idempotencyKey: 'snooze-once',
    actor: 'founder',
    until: '2026-07-30T12:00:00.000Z',
  });

  await run.accept(urgentLeads(1), '2026-07-29T12:30:00.000Z');
  const cooldown = await run.service.runCycle(run.tenantKey, { mode: 'evaluate', idempotencyKey: 'state-2' });
  assert.equal(cooldown.evaluations.find((row) => row.rule_id === 'overdue_expected_close')?.status, 'suppressed_snooze');
  assert.equal(cooldown.evaluations.find((row) => row.rule_id === 'active_owner_gap')?.status, 'suppressed_cooldown');

  const refreshedWorseningFacts = urgentLeads(1).map((lead, index) => index === 0
    ? { ...lead, estimated_value: (lead.estimated_value ?? 0) + 1 }
    : lead);
  await run.accept(refreshedWorseningFacts, '2026-07-29T16:31:00.000Z');
  const afterCooldown = await run.service.runCycle(run.tenantKey, { mode: 'evaluate', idempotencyKey: 'state-3' });
  assert.equal(afterCooldown.evaluations.find((row) => row.rule_id === 'overdue_expected_close')?.status, 'suppressed_snooze');
  assert.equal(afterCooldown.evaluations.find((row) => row.rule_id === 'active_owner_gap')?.status, 'triggered');
  assert.equal(afterCooldown.alerts.filter((alert) => alert.rule_id === 'active_owner_gap').length, 1);

  await run.accept(cleanLeads(), '2026-07-29T17:00:00.000Z');
  const resolved = await run.service.runCycle(run.tenantKey, { mode: 'evaluate', idempotencyKey: 'state-4' });
  assert.deepEqual(resolved.evaluations.map((row) => row.status), ['resolved', 'resolved']);
  assert.equal((await run.service.listAlerts(run.tenantKey, 'resolved')).length, 3);
});

test('acknowledgement and snooze are idempotent, tenant-scoped state evidence', async () => {
  const run = await harness();
  const cycle = await run.service.runCycle(run.tenantKey, { mode: 'evaluate', idempotencyKey: 'state-api-1' });
  const [first, second] = cycle.alerts;
  const acknowledged = await run.service.acknowledge(run.tenantKey, {
    alertId: first.id, idempotencyKey: 'ack-1', actor: 'founder',
  });
  const replay = await run.service.acknowledge(run.tenantKey, {
    alertId: first.id, idempotencyKey: 'ack-1', actor: 'founder',
  });
  assert.equal(acknowledged.replayed, false);
  assert.equal(replay.replayed, true);
  await run.service.snooze(run.tenantKey, {
    alertId: second.id,
    idempotencyKey: 'snooze-1',
    actor: 'founder',
    until: '2026-07-30T12:00:00.000Z',
  });
  assert.equal((await run.service.listAlerts(run.tenantKey, 'acknowledged')).length, 1);
  assert.equal((await run.service.listAlerts(run.tenantKey, 'snoozed')).length, 1);
  await assert.rejects(() => run.service.snooze(run.tenantKey, {
    alertId: second.id,
    idempotencyKey: 'snooze-too-long',
    actor: 'founder',
    until: '2026-08-10T12:00:00.000Z',
  }), (error: unknown) => error instanceof ProactiveAlertError && error.code === 'invalid_snooze_window');
});

test('quiet hours defer urgent delivery and one daily brief is staged per UTC day', async () => {
  const delivered: string[] = [];
  const dailyAdapter: NotificationDeliveryAdapter = {
    kind: 'daily_brief',
    key: 'test-daily',
    version: '1.0.0',
    deliver: async (request) => {
      delivered.push(request.logicalNotificationKey);
      return { status: 'delivered', receiptId: 'daily-receipt-1' };
    },
  };
  const run = await harness({
    now: '2026-07-29T23:00:00.000Z',
    registry: new NotificationDeliveryRegistry([dailyAdapter]),
  });
  const urgent = await run.service.runCycle(run.tenantKey, { mode: 'evaluate', idempotencyKey: 'quiet-urgent' });
  assert.equal(urgent.outbox.length, 2);
  assert.ok(urgent.outbox.every((row) => row.available_at === '2026-07-30T07:00:00.000Z'));

  const daily = await run.service.runCycle(run.tenantKey, { mode: 'daily_brief', idempotencyKey: 'daily-1' });
  assert.equal(daily.outbox.filter((row) => row.delivery_kind === 'daily_brief').length, 1);
  const dailyReplay = await run.service.runCycle(run.tenantKey, { mode: 'daily_brief', idempotencyKey: 'daily-2' });
  assert.equal(dailyReplay.outbox.length, 0);
  const dailyDelivery = (await run.service.listDeliveries(run.tenantKey))
    .find((row) => row.outbox.delivery_kind === 'daily_brief');
  assert.ok(dailyDelivery);
  run.setNow('2026-07-30T07:00:00.000Z');
  const result = await run.service.deliver(run.tenantKey, {
    outboxId: dailyDelivery.outbox.id,
    attemptKey: 'daily-attempt-1',
  });
  assert.equal(result.result.status, 'delivered');
  assert.deepEqual(delivered, [dailyDelivery.outbox.logical_key]);
});

test('immutable outcomes produce a deterministic shadow false-positive baseline', async () => {
  const run = await harness();
  const cycle = await run.service.runCycle(run.tenantKey, { mode: 'evaluate', idempotencyKey: 'outcomes-1' });
  const falsePositive = await run.service.recordOutcome(run.tenantKey, {
    alertId: cycle.alerts[0].id,
    idempotencyKey: 'outcome-false-positive',
    actor: 'founder',
    outcome: 'false_positive',
  });
  assert.equal(falsePositive.replayed, false);
  const sameOutcome = await run.service.recordOutcome(run.tenantKey, {
    alertId: cycle.alerts[0].id,
    idempotencyKey: 'outcome-false-positive-again',
    actor: 'founder',
    outcome: 'false_positive',
  });
  assert.equal(sameOutcome.replayed, true);
  assert.equal(sameOutcome.event.id, falsePositive.event.id);
  await assert.rejects(() => run.service.recordOutcome(run.tenantKey, {
    alertId: cycle.alerts[0].id,
    idempotencyKey: 'outcome-conflict',
    actor: 'founder',
    outcome: 'useful',
  }), (error: unknown) => error instanceof ProactiveAlertError && error.code === 'alert_outcome_conflict');
  await run.service.recordOutcome(run.tenantKey, {
    alertId: cycle.alerts[1].id,
    idempotencyKey: 'outcome-useful',
    actor: 'founder',
    outcome: 'useful',
  });

  const baseline = await run.service.shadowBaseline(run.tenantKey, {
    from: '2026-07-29T11:00:00.000Z',
    to: '2026-07-30T11:00:00.000Z',
  });
  assert.equal(baseline.reviewed_alert_count, 2);
  assert.equal(baseline.false_positive_count, 1);
  assert.equal(baseline.false_positive_rate, 0.5);
  assert.equal(baseline.status, 'insufficient_sample');
  assert.ok(baseline.reasons.includes('minimum_reviewed_sample_not_met'));
  assert.ok(baseline.reasons.includes('false_positive_rate_above_limit'));
});

test('delivery replay uses one logical key; definitive failure may retry and unknown blocks retry', async () => {
  const calls: string[] = [];
  let response: 'failed' | 'delivered' | 'throw' = 'failed';
  const adapter: NotificationDeliveryAdapter = {
    kind: 'urgent_alert',
    key: 'test-urgent',
    version: '1.0.0',
    deliver: async (request) => {
      calls.push(request.logicalNotificationKey);
      if (response === 'throw') throw new Error('lost response');
      return response === 'failed'
        ? { status: 'failed', failureCode: 'provider_rejected' }
        : { status: 'delivered', receiptId: 'receipt-1' };
    },
  };
  const run = await harness({ registry: new NotificationDeliveryRegistry([adapter]) });
  const cycle = await run.service.runCycle(run.tenantKey, { mode: 'evaluate', idempotencyKey: 'delivery-1' });
  const outbox = cycle.outbox[0];
  const failed = await run.service.deliver(run.tenantKey, { outboxId: outbox.id, attemptKey: 'attempt-1' });
  assert.equal(failed.result.status, 'failed');
  const failedReplay = await run.service.deliver(run.tenantKey, { outboxId: outbox.id, attemptKey: 'attempt-1' });
  assert.equal(failedReplay.replayed, true);
  assert.equal(calls.length, 1);

  response = 'delivered';
  const delivered = await run.service.deliver(run.tenantKey, { outboxId: outbox.id, attemptKey: 'attempt-2' });
  assert.equal(delivered.result.status, 'delivered');
  assert.deepEqual(calls, [calls[0], calls[0]]);
  const logicalReplay = await run.service.deliver(run.tenantKey, { outboxId: outbox.id, attemptKey: 'attempt-3' });
  assert.equal(logicalReplay.replayed, true);
  assert.equal(calls.length, 2);

  const unknownRun = await harness({ registry: new NotificationDeliveryRegistry([{ ...adapter, deliver: async () => { throw new Error('unknown'); } }]) });
  const unknownCycle = await unknownRun.service.runCycle(unknownRun.tenantKey, { mode: 'evaluate', idempotencyKey: 'unknown-1' });
  const unknown = await unknownRun.service.deliver(unknownRun.tenantKey, {
    outboxId: unknownCycle.outbox[0].id, attemptKey: 'unknown-attempt-1',
  });
  assert.equal(unknown.result.status, 'unknown');
  await assert.rejects(() => unknownRun.service.deliver(unknownRun.tenantKey, {
    outboxId: unknownCycle.outbox[0].id, attemptKey: 'unknown-attempt-2',
  }), (error: unknown) => error instanceof ProactiveAlertError && error.code === 'delivery_outcome_unknown');
});

test('an in-flight delivery attempt blocks a second provider call for the same logical notification', async () => {
  let release!: () => void;
  let entered!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const adapterEntered = new Promise<void>((resolve) => { entered = resolve; });
  let calls = 0;
  const adapter: NotificationDeliveryAdapter = {
    kind: 'urgent_alert',
    key: 'test-concurrent-urgent',
    version: '1.0.0',
    deliver: async () => {
      calls += 1;
      entered();
      await released;
      return { status: 'delivered', receiptId: 'concurrent-receipt-1' };
    },
  };
  const run = await harness({ registry: new NotificationDeliveryRegistry([adapter]) });
  const cycle = await run.service.runCycle(run.tenantKey, { mode: 'evaluate', idempotencyKey: 'concurrent-delivery-1' });
  const first = run.service.deliver(run.tenantKey, {
    outboxId: cycle.outbox[0].id,
    attemptKey: 'concurrent-attempt-1',
  });
  await adapterEntered;
  try {
    await assert.rejects(() => run.service.deliver(run.tenantKey, {
      outboxId: cycle.outbox[0].id,
      attemptKey: 'concurrent-attempt-2',
    }), (error: unknown) => error instanceof ProactiveAlertError && error.code === 'delivery_outcome_unknown');
  } finally {
    release();
  }
  assert.equal((await first).result.status, 'delivered');
  assert.equal(calls, 1);
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

test('authenticated alert APIs enforce tenant scope and expose no cycle or delivery mutation route', async () => {
  const run = await harness();
  const cycle = await run.service.runCycle(run.tenantKey, { mode: 'evaluate', idempotencyKey: 'http-1' });
  const alert = cycle.alerts[0];
  const app = createApp({
    profile: 'egoric-readonly',
    knex: db,
    integrationReadAuth: AUTH,
    advisorProvider: new DeterministicAdvisorProvider(),
    advisorClock: run.clock,
    proactiveClock: run.clock,
  });
  const server = app.listen(0);
  const base = await listen(server);
  try {
    const path = `/v1/tenants/${run.tenantKey}/alerts`;
    assert.equal((await fetch(base + path)).status, 401);
    assert.equal((await fetch(base + path, {
      headers: { Authorization: `Bearer ${signTenantReadToken('another-tenant', AUTH.secret)}` },
    })).status, 403);
    const auth = { Authorization: `Bearer ${signTenantReadToken(run.tenantKey, AUTH.secret)}` };
    const list = await fetch(base + path, { headers: auth });
    assert.equal(list.status, 200);
    const alerts = await list.json() as any;
    assert.equal(alerts.alerts.length, 2);
    assert.equal(JSON.stringify(alerts).includes('tenant_id'), false);

    const ackPath = `${path}/${alert.id}/acknowledgements`;
    const ack = await fetch(base + ackPath, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': 'http-ack-1' },
      body: '{}',
    });
    assert.equal(ack.status, 201);
    const ackReplay = await fetch(base + ackPath, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': 'http-ack-1' },
      body: '{}',
    });
    assert.equal(ackReplay.status, 200);
    const outcome = await fetch(`${base}${path}/${alert.id}/outcomes`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': 'http-outcome-1' },
      body: JSON.stringify({ outcome: 'useful' }),
    });
    assert.equal(outcome.status, 201);
    const baseline = await fetch(`${base}/v1/tenants/${run.tenantKey}/alert-shadow-baseline?from=2026-07-29T11%3A00%3A00.000Z&to=2026-07-30T11%3A00%3A00.000Z`, { headers: auth });
    assert.equal(baseline.status, 200);
    assert.equal(((await baseline.json()) as any).reviewed_alert_count, 1);
    assert.equal((await fetch(`${base}/v1/tenants/${run.tenantKey}/notification-deliveries`, { headers: auth })).status, 200);
    assert.equal((await fetch(`${base}/v1/tenants/${run.tenantKey}/alerts/run`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}',
    })).status, 404);
  } finally {
    await closeServer(server);
  }
});

test('all Phase 11 records are immutable and the migration rolls back and reapplies', async () => {
  const run = await harness();
  const cycle = await run.service.runCycle(run.tenantKey, { mode: 'evaluate', idempotencyKey: 'immutable-1' });
  await run.service.acknowledge(run.tenantKey, {
    alertId: cycle.alerts[0].id, idempotencyKey: 'immutable-ack', actor: 'founder',
  });
  for (const table of Object.values(PROACTIVE_TABLES)) {
    const row = await db(table).first();
    if (!row) continue;
    await assert.rejects(() => db(table).where({ id: row.id }).update({ created_at: '2030-01-01T00:00:00.000Z' }));
    await assert.rejects(() => db(table).where({ id: row.id }).delete());
  }

  await db.migrate.rollback();
  assert.equal(await db.schema.hasTable(PROACTIVE_TABLES.alerts), false);
  await db.migrate.latest();
  assert.equal(await db.schema.hasTable(PROACTIVE_TABLES.alerts), true);
});

test('checked-in composition and operator contain no channel adapter, daemon, or automatic loop', () => {
  assert.deepEqual(buildNotificationDeliveryRegistry().list(), []);
  const operator = fs.readFileSync(path.resolve(__dirname, '../proactiveOperator.ts'), 'utf8');
  const registry = fs.readFileSync(path.resolve(__dirname, '../integrations/notifications/notificationDeliveryRegistry.ts'), 'utf8');
  assert.equal(/setInterval|setTimeout|while\s*\(|for\s*\(;;\)|fetch\s*\(|https?\.request|axios|nodemailer|resend/i.test(operator + registry), false);
});
