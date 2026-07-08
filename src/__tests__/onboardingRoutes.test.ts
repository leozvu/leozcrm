/**
 * Onboarding + readiness HTTP route tests (Milestone #10). Boots the real app
 * with auth enabled and asserts: public health/readiness probes, admin-only
 * onboarding, that the issued tenant token actually authenticates, and clean
 * rejection of malformed/duplicate input.
 *
 * Run: npm test
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import config from '../../knexfile';
import { seedFunnelStages } from '../db/fixtures';
import { createApp } from '../http/app';
import { TEST_AUTH, adminHeaders, clientHeaders } from './support/authHarness';

const db = knexFactory(config.test);
let server: Server;
let baseUrl: string;

before(async () => {
  await db.migrate.latest();
  await seedFunnelStages(db);
  const app = createApp({ knex: db, auth: TEST_AUTH });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await db.destroy();
});

async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: /json/.test(ct) && text ? JSON.parse(text) : text };
}

test('health and readiness probes are public; readiness confirms the platform is seeded', async () => {
  assert.equal((await req('GET', '/health')).status, 200);

  const ready = await req('GET', '/ready');
  assert.equal(ready.status, 200);
  assert.equal(ready.body.ok, true);
  assert.equal(ready.body.checks.funnel_stages, 9);
  assert.equal(ready.body.checks.funnel_ready, true);
});

test('readiness rejects a drifted funnel table: nine NON-canonical rows are not ready', async () => {
  // Rename one canonical stage key — the count is still 9, but the funnel is
  // no longer canonical, so /ready must flip to 503 (Codex M10 review item).
  await db('funnel_stages').where({ key: 'lead' }).update({ key: 'drifted' });
  try {
    const ready = await req('GET', '/ready');
    assert.equal(ready.status, 503);
    assert.equal(ready.body.ok, false);
    assert.equal(ready.body.checks.funnel_stages, 9);
    assert.equal(ready.body.checks.funnel_ready, false);
  } finally {
    await db('funnel_stages').where({ key: 'drifted' }).update({ key: 'lead' });
  }
});

test('onboarding is admin-only', async () => {
  // Unauthenticated → 401.
  assert.equal((await req('POST', '/onboarding', { name: 'X', email: 'x@example.com' })).status, 401);
  // A client-scoped (non-admin) caller → 403.
  const asClient = await req(
    'POST',
    '/onboarding',
    { name: 'X', email: 'x2@example.com' },
    clientHeaders('00000000-0000-4000-8000-000000000000'),
  );
  assert.equal(asClient.status, 403);
  assert.equal(asClient.body.code, 'forbidden_admin');
});

test('admin onboards a tenant and receives a working API token', async () => {
  const r = await req(
    'POST',
    '/onboarding',
    { name: 'Pilot Co', email: 'pilot-route@example.com', company: 'Pilot' },
    adminHeaders(),
  );
  assert.equal(r.status, 201);
  assert.ok(r.body.client.id);
  assert.equal(r.body.client.email, 'pilot-route@example.com');
  assert.equal(r.body.readiness.funnel_ready, true);

  const token = r.body.api_token;
  assert.ok(typeof token === 'string' && token.includes('.'));

  // The freshly issued token authenticates as the new tenant: it can read its
  // own client record…
  const auth = { authorization: `Bearer ${token}` };
  const selfRead = await req('GET', `/clients/${r.body.client.id}`, undefined, auth);
  assert.equal(selfRead.status, 200);
  assert.equal(selfRead.body.email, 'pilot-route@example.com');

  // …but is scoped to itself — it cannot read another tenant's record.
  const otherRead = await req('GET', '/clients/00000000-0000-4000-8000-000000000000', undefined, auth);
  assert.equal(otherRead.status, 403);
});

test('onboarding rejects malformed input with a clean 400 (never 500)', async () => {
  assert.equal((await req('POST', '/onboarding', { name: 'No Email' }, adminHeaders())).status, 400);
  const badEmail = await req('POST', '/onboarding', { name: 'Bad', email: 'nope' }, adminHeaders());
  assert.equal(badEmail.status, 400);
  assert.equal(badEmail.body.code, 'invalid_email');
});

test('onboarding will not duplicate an existing tenant email (409)', async () => {
  await req('POST', '/onboarding', { name: 'First', email: 'dup-route@example.com' }, adminHeaders());
  const dup = await req('POST', '/onboarding', { name: 'Second', email: 'dup-route@example.com' }, adminHeaders());
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'client_exists');
});
