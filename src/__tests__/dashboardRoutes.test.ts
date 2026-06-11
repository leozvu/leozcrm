/**
 * HTTP route-level contract tests for the Executive Dashboard v0 (Milestone #5).
 * Boots the real Express app via createApp({ knex }) over an ephemeral port and
 * asserts the read-only HTML surface: the client picker, a rendered dashboard
 * for the seeded client, the explicit no-data state for an empty client, and
 * the 404/400 paths — all against the shared brief seed (support/briefScenario).
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
import { ClientRepository } from '../repositories/clientRepository';
import { seedBriefScenario } from './support/briefScenario';

const db = knexFactory(config.test);
let server: Server;
let baseUrl: string;
let clientId: string;
let asOf: string;
let emptyClientId: string;

before(async () => {
  ({ clientId, asOf } = await seedBriefScenario(db));
  const empty = await new ClientRepository(db).create({
    name: 'Empty Co',
    email: 'dash-route-empty@example.com',
  });
  emptyClientId = empty.id;

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

test('GET /dashboard — client picker lists seeded clients', async () => {
  const { status, contentType, text } = await get('/dashboard');
  assert.equal(status, 200);
  assert.match(contentType, /text\/html/);
  assert.match(text, /Executive Dashboard/);
  assert.match(text, /Acme/);
  // Links to the per-client dashboard.
  assert.ok(text.includes(`/dashboard?clientId=${clientId}`));
});

test('GET /dashboard?clientId&asOf — renders all four views from live data', async () => {
  const { status, contentType, text } = await get(`/dashboard?clientId=${clientId}&asOf=${asOf}`);
  assert.equal(status, 200);
  assert.match(contentType, /text\/html/);

  // The required views are present, including the conversion/volume trend.
  assert.match(text, /Funnel Health/);
  assert.match(text, /Lead Volume Trend/);
  assert.match(text, /CEO Brief/);
  assert.match(text, /Recommendations/);
  assert.match(text, />Leads</);

  // Funnel visualizer shows seeded stage data.
  assert.match(text, /Traffic/);
  assert.match(text, /Conversion/);
  // Exact rendered KPI value at the HTML boundary: Qualification's step
  // conversion is 0.6 → "60%" (catches regressions in rendered percentages).
  assert.match(text, /60%/);

  // Trend visualizer shows seeded daily history (oldest and newest seeded days).
  assert.match(text, /2026-05-29/);
  assert.match(text, /2026-06-10/);

  // CEO Brief viewer shows a seeded anomaly (FB Push spends without converting).
  assert.match(text, /FB Push/);

  // Recommendations panel shows a derived recommendation title.
  assert.match(text, /Unblock the Activation stage/);

  // Lead list shows seeded lead detail (source from the fixture).
  assert.match(text, /newsletter/);
});

test('GET /dashboard for an empty client renders explicit no-data states', async () => {
  const { status, text } = await get(`/dashboard?clientId=${emptyClientId}&asOf=${asOf}`);
  assert.equal(status, 200);

  // Each section degrades to an explicit no-data message, not a fabricated value.
  assert.match(text, /the funnel is empty/i);
  assert.match(text, /No lead activity recorded yet/i);
  assert.match(text, /No leads yet for this client/i);
  assert.match(text, /No recommendations/i);
});

test('GET /dashboard?clientId=unknown — 404 not-found page', async () => {
  const { status, text } = await get('/dashboard?clientId=does-not-exist');
  assert.equal(status, 404);
  assert.match(text, /Client not found/i);
});

test('GET /dashboard?clientId&asOf=invalid — 400 for a bad date', async () => {
  const { status, text } = await get(`/dashboard?clientId=${clientId}&asOf=2026-99-99`);
  assert.equal(status, 400);
  assert.match(text, /asOf must be a valid/i);
});
