/**
 * HTTP route-level contract tests for the advisory recommendation endpoint
 * (Milestone #4). Boots the real Express app via createApp({ knex }) over an
 * ephemeral port and asserts the HTTP contract: status codes, clientId/asOf
 * validation, the JSON shape, and advisory-only output — against the shared
 * brief seed (support/briefScenario).
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
import { seedBriefScenario } from './support/briefScenario';
import { TEST_AUTH, adminHeaders } from './support/authHarness';

const db = knexFactory(config.test);
let server: Server;
let baseUrl: string;
let clientId: string;
let asOf: string;

before(async () => {
  ({ clientId, asOf } = await seedBriefScenario(db));
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

async function get(path: string): Promise<{ status: number; contentType: string; text: string }> {
  const res = await fetch(`${baseUrl}${path}`, { headers: adminHeaders() });
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    text: await res.text(),
  };
}

test('GET /recommendations — 200 advisory JSON report matching the seeded state', async () => {
  const { status, contentType, text } = await get(`/recommendations?clientId=${clientId}&asOf=${asOf}`);
  assert.equal(status, 200);
  assert.match(contentType, /application\/json/);

  const body = JSON.parse(text);
  assert.equal(body.client_id, clientId);
  assert.equal(body.as_of, asOf);
  assert.equal(body.advisory_only, true);
  assert.deepEqual(
    body.recommendations.map((r: any) => r.code),
    ['unblock_funnel_stage', 'rebuild_top_of_funnel', 'review_campaign_spend'],
  );
  for (const r of body.recommendations) {
    assert.equal(r.advisory_only, true);
  }
});

test('GET /recommendations — defaults asOf to today when omitted', async () => {
  const { status, text } = await get(`/recommendations?clientId=${clientId}`);
  assert.equal(status, 200);
  const body = JSON.parse(text);
  assert.match(body.as_of, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(body.advisory_only, true);
});

test('GET /recommendations — 400 when clientId is missing', async () => {
  const { status, text } = await get('/recommendations');
  assert.equal(status, 400);
  assert.match(JSON.parse(text).error, /clientId/);
});

test('GET /recommendations — 400 for malformed or invalid asOf', async () => {
  for (const bad of ['06-2026', '2026-99-99']) {
    const { status, text } = await get(`/recommendations?clientId=${clientId}&asOf=${bad}`);
    assert.equal(status, 400, `expected 400 for asOf=${bad}`);
    assert.match(JSON.parse(text).error, /asOf/);
  }
});

test('GET /recommendations — 404 when the client does not exist', async () => {
  const { status, text } = await get('/recommendations?clientId=does-not-exist');
  assert.equal(status, 404);
  assert.match(JSON.parse(text).error, /client not found/);
});
