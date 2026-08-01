import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import { createApp, resolveRuntimeProfile } from '../http/app';
import { signTenantReadToken } from '../http/integrationReadAuth';
import { seedEgoricMemory } from './support/egoricMemoryScenario';

const db = knexFactory(config.test);
const AUTH = { secret: 'separate-output-secret', adminKey: 'separate-output-admin' };
let baseUrl = '';
let closeServer: (() => Promise<void>) | undefined;

before(async () => {
  await db.migrate.latest();
  await seedEgoricMemory(db, { tenantKey: 'profile-a', displayName: 'Profile A' });
  await seedEgoricMemory(db, { tenantKey: 'profile-b', displayName: 'Profile B' });
  const app = createApp({
    profile: 'egoric-readonly',
    knex: db,
    integrationReadAuth: AUTH,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
});

after(async () => {
  await closeServer?.();
  await db.destroy();
});

function authHeaders(tenantKey: string): Record<string, string> {
  return { authorization: `Bearer ${signTenantReadToken(tenantKey, AUTH.secret)}` };
}

test('egoric-readonly profile exposes public health and an authenticated tenant brief', async () => {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, profile: 'egoric-readonly' });

  const ready = await fetch(`${baseUrl}/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), {
    ok: true,
    profile: 'egoric-readonly',
    checks: { db: 'ok', migrations_current: true },
  });

  assert.equal((await fetch(`${baseUrl}/v1/tenants/profile-a/brief`)).status, 401);
  const response = await fetch(`${baseUrl}/v1/tenants/profile-a/brief?asOf=2026-07-28`, {
    headers: authHeaders('profile-a'),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'private, no-cache');
  const body = await response.json() as any;
  assert.equal(body.tenant.key, 'profile-a');
  assert.equal(body.funnel_definition.id, 'egoric_sales_v1');
  assert.equal(body.advisory_only, true);
});

test('tenant read token is scoped; separate read admin may access either tenant', async () => {
  assert.equal((await fetch(`${baseUrl}/v1/tenants/profile-b/brief`, {
    headers: authHeaders('profile-a'),
  })).status, 403);
  assert.equal((await fetch(`${baseUrl}/v1/tenants/profile-b/brief`, {
    headers: { authorization: `Bearer ${AUTH.adminKey}` },
  })).status, 200);
  assert.equal((await fetch(`${baseUrl}/v1/tenants/profile-a/brief`, {
    headers: { authorization: 'Bearer invalid' },
  })).status, 401);
});

test('legacy CRM, task, onboarding, email, dashboard, and write routes are absent', async () => {
  const denied: Array<[string, string, string?]> = [
    ['GET', '/clients'],
    ['POST', '/clients', '{bad-json'],
    ['GET', '/campaigns'],
    ['PATCH', '/leads/anything', '{}'],
    ['GET', '/metrics/funnel?clientId=anything'],
    ['GET', '/brief?clientId=anything'],
    ['GET', '/recommendations?clientId=anything'],
    ['GET', '/dashboard'],
    ['POST', '/tasks', '{}'],
    ['POST', '/onboarding', '{}'],
    ['POST', '/integrations/email/send', '{}'],
    ['GET', '/integrations'],
  ];
  for (const [method, path, body] of denied) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${AUTH.adminKey}`, 'content-type': 'application/json' },
      body,
    });
    assert.equal(response.status, 404, `${method} ${path} must stay unmounted`);
  }
  assert.equal((await fetch(`${baseUrl}/v1/tenants/profile-a/brief`, {
    method: 'POST',
    headers: { ...authHeaders('profile-a'), 'content-type': 'application/json' },
    body: '{}',
  })).status, 404);
});

test('runtime profile selection is strict and can resolve from INTEGRATION_MODE', () => {
  assert.equal(resolveRuntimeProfile('legacy'), 'legacy');
  assert.equal(resolveRuntimeProfile('egoric-readonly'), 'egoric-readonly');
  assert.throws(() => resolveRuntimeProfile('unsafe-mode'), /Unsupported INTEGRATION_MODE/);
});
