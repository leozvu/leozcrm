/**
 * HTTP route-level contract tests for the Daily CEO Brief endpoint (Milestone
 * #3). Boots the real Express app via createApp({ knex }) over an ephemeral port
 * and asserts the HTTP contract: status codes, clientId/asOf validation, the
 * JSON shape, and the plain-text rendering — against the shared deterministic
 * seed (support/briefScenario).
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

const db = knexFactory(config.test);
let server: Server;
let baseUrl: string;
let clientId: string;
let asOf: string;

before(async () => {
  ({ clientId, asOf } = await seedBriefScenario(db));
  const app = createApp({ knex: db });
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
  const res = await fetch(`${baseUrl}${path}`);
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    text: await res.text(),
  };
}

test('GET /brief — 200 JSON brief matching the seeded CRM state', async () => {
  const { status, contentType, text } = await get(`/brief?clientId=${clientId}&asOf=${asOf}`);
  assert.equal(status, 200);
  assert.match(contentType, /application\/json/);

  const body = JSON.parse(text);
  assert.equal(body.client_id, clientId);
  assert.equal(body.as_of, asOf);
  assert.equal(body.headline.total_leads, 7);
  assert.equal(body.headline.won, 2);
  assert.equal(body.headline.win_rate, 0.6667);
  assert.equal(body.funnel.length, 9);
  assert.deepEqual(body.delta, {
    window_days: 7,
    recent_leads: 3,
    previous_leads: 4,
    change: -1,
    direction: 'down',
  });
  assert.deepEqual(
    body.anomalies.map((a: any) => a.code),
    ['acquisition_down', 'funnel_bottleneck', 'spend_no_conversion'],
  );
  assert.deepEqual(
    body.recommended_actions.map((a: any) => a.code),
    ['rebuild_top_of_funnel', 'unblock_funnel_stage', 'review_campaign_spend'],
  );
});

test('GET /brief?format=text — 200 plain-text rendering', async () => {
  const { status, contentType, text } = await get(`/brief?clientId=${clientId}&asOf=${asOf}&format=text`);
  assert.equal(status, 200);
  assert.match(contentType, /text\/plain/);
  assert.match(text, /DAILY CEO BRIEF — 2026-06-10/);
  assert.match(text, /Leads: 7 total/);
  assert.match(text, /Unblock the Activation stage/);
});

test('GET /brief — defaults asOf to today when omitted', async () => {
  const { status, text } = await get(`/brief?clientId=${clientId}`);
  assert.equal(status, 200);
  const body = JSON.parse(text);
  assert.match(body.as_of, /^\d{4}-\d{2}-\d{2}$/);
});

test('GET /brief — 400 when clientId is missing', async () => {
  const { status, text } = await get('/brief');
  assert.equal(status, 400);
  assert.match(JSON.parse(text).error, /clientId/);
});

test('GET /brief — 400 when asOf is malformed', async () => {
  const { status, text } = await get(`/brief?clientId=${clientId}&asOf=06-2026`);
  assert.equal(status, 400);
  assert.match(JSON.parse(text).error, /asOf/);
});

test('GET /brief — 404 when the client does not exist', async () => {
  const { status, text } = await get('/brief?clientId=does-not-exist');
  assert.equal(status, 404);
  assert.match(JSON.parse(text).error, /client not found/);
});
