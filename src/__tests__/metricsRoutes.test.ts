/**
 * HTTP route-level contract tests for the KPI endpoints (Milestone #2).
 *
 * Unlike metrics.test.ts (which calls MetricsRepository directly), this suite
 * exercises the real Express app via createApp({ knex }) over an ephemeral port
 * and asserts the full HTTP contract: route mounting, required-`clientId`
 * validation, status codes, and the serialized JSON shape of every /metrics/*
 * response — all against the shared deterministic seed (support/metricsScenario).
 *
 * Run: npm test
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import config from '../../knexfile';
import { createApp } from '../http/app';
import { seedMetricsScenario } from './support/metricsScenario';
import { TEST_AUTH, adminHeaders } from './support/authHarness';

const db = knexFactory(config.test);
let server: Server;
let baseUrl: string;
let clientAId: string;
let campaignFbId: string;
let campaignEmailId: string;

before(async () => {
  ({ clientAId, campaignFbId, campaignEmailId } = await seedMetricsScenario(db));
  // Bind the /metrics routes to the same seeded in-memory connection.
  const app = createApp({ knex: db, auth: TEST_AUTH });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.destroy();
});

/** GET helper returning the HTTP status and parsed JSON body. */
async function getJson(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, { headers: adminHeaders() });
  const text = await res.text();
  return { status: res.status, body: text.length ? JSON.parse(text) : undefined };
}

test('GET /metrics/funnel — 200 with stage counts, reach, and conversion rates', async () => {
  const { status, body } = await getJson(`/metrics/funnel?clientId=${clientAId}`);

  assert.equal(status, 200);
  assert.equal(body.client_id, clientAId);
  assert.equal(body.total_leads, 7);
  assert.equal(body.stages.length, 9);

  const byKey = Object.fromEntries(body.stages.map((s: any) => [s.key, s]));
  assert.equal(byKey.traffic.count, 2);
  assert.equal(byKey.traffic.reached, 7);
  assert.equal(byKey.traffic.conversion_from_previous, null);
  assert.equal(byKey.qualification.reached, 3);
  assert.equal(byKey.qualification.conversion_from_previous, 0.6);

  assert.deepEqual(body.conversion, {
    total_leads: 7,
    open: 4,
    won: 2,
    lost: 1,
    win_rate: 0.6667,
    overall_conversion_rate: 0.2857,
  });
});

test('GET /metrics/sources — 200 with lead volume grouped by source', async () => {
  const { status, body } = await getJson(`/metrics/sources?clientId=${clientAId}`);

  assert.equal(status, 200);
  assert.equal(body.client_id, clientAId);
  assert.equal(body.total_leads, 7);
  const counts = Object.fromEntries(body.by_source.map((b: any) => [b.source, b.count]));
  assert.deepEqual(counts, { 'fb-ad': 3, newsletter: 2, referral: 2 });
});

test('GET /metrics/channels — 200 with lead volume grouped by channel', async () => {
  const { status, body } = await getJson(`/metrics/channels?clientId=${clientAId}`);

  assert.equal(status, 200);
  assert.equal(body.client_id, clientAId);
  assert.equal(body.total_leads, 7);
  const counts = Object.fromEntries(body.by_channel.map((b: any) => [b.channel, b.count]));
  assert.deepEqual(counts, { facebook: 3, email: 2, unattributed: 2 });
});

test('GET /metrics/campaigns — 200 with per-campaign attribution + unattributed count', async () => {
  const { status, body } = await getJson(`/metrics/campaigns?clientId=${clientAId}`);

  assert.equal(status, 200);
  assert.equal(body.client_id, clientAId);
  assert.equal(body.campaigns.length, 2);
  const byId = Object.fromEntries(body.campaigns.map((c: any) => [c.campaign_id, c]));
  assert.equal(byId[campaignFbId].lead_count, 3);
  assert.equal(byId[campaignFbId].won_count, 0);
  assert.equal(byId[campaignFbId].budget_cents, 100_000);
  assert.equal(byId[campaignEmailId].lead_count, 2);
  assert.equal(byId[campaignEmailId].won_count, 1);
  assert.equal(body.unattributed_leads, 2);
});

test('GET /metrics/trends — 200 with lead-creation volume bucketed by day', async () => {
  const { status, body } = await getJson(`/metrics/trends?clientId=${clientAId}`);

  assert.equal(status, 200);
  assert.equal(body.client_id, clientAId);
  assert.equal(body.total_leads, 7);
  assert.equal(body.by_day.reduce((sum: number, p: any) => sum + p.count, 0), 7);
  for (const p of body.by_day) {
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(p.count > 0);
  }
});

test('GET /metrics/funnel — 400 when clientId is missing', async () => {
  const { status, body } = await getJson('/metrics/funnel');
  assert.equal(status, 400);
  assert.match(body.error, /clientId/);
});

test('GET /metrics/funnel — 400 when clientId is blank', async () => {
  const { status } = await getJson('/metrics/funnel?clientId=%20%20');
  assert.equal(status, 400);
});

test('GET /metrics/sources — 404 when the client does not exist', async () => {
  const { status, body } = await getJson('/metrics/sources?clientId=does-not-exist');
  assert.equal(status, 404);
  assert.match(body.error, /client not found/);
});

test('GET /metrics/funnel — a whitespace-padded valid clientId resolves (trimmed)', async () => {
  const { status, body } = await getJson(`/metrics/funnel?clientId=%20${clientAId}%20`);
  assert.equal(status, 200);
  assert.equal(body.client_id, clientAId);
  assert.equal(body.total_leads, 7);
});
