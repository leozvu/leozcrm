/**
 * Email publish route tests (Milestone #8A). Boots the real app with an injected
 * SANDBOX publisher (no real network) and asserts the HTTP contract: auth +
 * tenant isolation on the publish endpoint, the success path, reason→status
 * mapping (400/429/502/503), Retry-After, and — critically — that generating
 * recommendations sends NO email (publishing is explicit, never autonomous).
 *
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import knexFactory from 'knex';
import type { AddressInfo } from 'node:net';
import config from '../../knexfile';
import { createApp } from '../http/app';
import { ResendEmailAdapter, EmailTransport } from '../integrations/email/resendEmailAdapter';
import { EmailSpendGuard, SpendGuardConfig } from '../integrations/email/spendGuard';
import { EmailPublishService } from '../integrations/email/emailPublishService';
import { TEST_AUTH, adminHeaders, clientHeaders } from './support/authHarness';
import { seedBriefScenario } from './support/briefScenario';
import type { Knex } from 'knex';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const GOOD = { to: 'lead@example.com', subject: 'Hi', text: 'hello there' };

interface PublisherOpts {
  transport?: EmailTransport;
  configured?: boolean; // default true
  maxRetries?: number;
  guard?: Partial<SpendGuardConfig>;
}

function makePublisher(opts: PublisherOpts = {}) {
  const configured = opts.configured ?? true;
  const adapter = new ResendEmailAdapter({
    apiKey: configured ? 'test_key' : undefined,
    from: 'LeozOps <noreply@example.com>',
    transport: configured ? (opts.transport ?? okTransport()) : undefined,
    timeoutMs: 20,
  });
  const guard = new EmailSpendGuard({
    dailyCap: opts.guard?.dailyCap ?? 100,
    ratePerMinute: opts.guard?.ratePerMinute ?? 100,
    failureThreshold: opts.guard?.failureThreshold ?? 5,
    now: opts.guard?.now ?? (() => 1_700_000_000_000),
  });
  return new EmailPublishService(adapter, guard, { maxRetries: opts.maxRetries ?? 0, backoffBaseMs: 1, sleep: async () => {} });
}

function okTransport(): EmailTransport {
  return async () => ({ status: 200, body: { id: 'email_route_ok' } });
}

async function withApp(
  opts: { publisher: EmailPublishService; knex?: Knex },
  fn: (base: string) => Promise<void>,
) {
  const app = createApp({ auth: TEST_AUTH, emailPublisher: opts.publisher, knex: opts.knex });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn(base);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

async function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, retryAfter: res.headers.get('retry-after'), body: text ? JSON.parse(text) : null };
}

test('publish requires authentication', async () => {
  await withApp({ publisher: makePublisher() }, async (base) => {
    const r = await post(base, '/integrations/email/send', { clientId: CLIENT, ...GOOD });
    assert.equal(r.status, 401);
  });
});

test('publish is tenant-scoped: a client cannot send for another tenant', async () => {
  await withApp({ publisher: makePublisher() }, async (base) => {
    const r = await post(base, '/integrations/email/send', { clientId: 'someone-else', ...GOOD }, clientHeaders(CLIENT));
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'forbidden_tenant');
  });
});

test('publish succeeds for an in-scope client (sandbox) and for admin', async () => {
  await withApp({ publisher: makePublisher() }, async (base) => {
    const own = await post(base, '/integrations/email/send', { clientId: CLIENT, ...GOOD }, clientHeaders(CLIENT));
    assert.equal(own.status, 200);
    assert.equal(own.body.ok, true);
    assert.equal(own.body.id, 'email_route_ok');

    const asAdmin = await post(base, '/integrations/email/send', { clientId: 'any-client', ...GOOD }, adminHeaders());
    assert.equal(asAdmin.status, 200);
    assert.equal(asAdmin.body.ok, true);
  });
});

test('publish rejects missing fields and invalid messages with 400', async () => {
  await withApp({ publisher: makePublisher() }, async (base) => {
    const missing = await post(base, '/integrations/email/send', { clientId: CLIENT, to: 'a@b.com' }, clientHeaders(CLIENT));
    assert.equal(missing.status, 400);

    const bad = await post(base, '/integrations/email/send', { clientId: CLIENT, to: 'not-email', subject: 's', text: 'b' }, clientHeaders(CLIENT));
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'invalid_message');
  });
});

test('daily cap returns 429 with Retry-After', async () => {
  await withApp({ publisher: makePublisher({ guard: { dailyCap: 1 } }) }, async (base) => {
    const first = await post(base, '/integrations/email/send', { clientId: CLIENT, ...GOOD }, clientHeaders(CLIENT));
    assert.equal(first.status, 200);
    const second = await post(base, '/integrations/email/send', { clientId: CLIENT, ...GOOD }, clientHeaders(CLIENT));
    assert.equal(second.status, 429);
    assert.equal(second.body.code, 'daily_cap_exceeded');
    assert.ok(second.retryAfter && Number(second.retryAfter) > 0);
  });
});

test('a provider error maps to 502; a tripped circuit maps to 503', async () => {
  const fail: EmailTransport = async () => ({ status: 500, body: { message: 'down' } });
  await withApp({ publisher: makePublisher({ transport: fail, maxRetries: 0, guard: { failureThreshold: 1 } }) }, async (base) => {
    const err = await post(base, '/integrations/email/send', { clientId: CLIENT, ...GOOD }, clientHeaders(CLIENT));
    assert.equal(err.status, 502);
    assert.equal(err.body.code, 'provider_error');
    // failureThreshold=1 → circuit now open.
    const open = await post(base, '/integrations/email/send', { clientId: CLIENT, ...GOOD }, clientHeaders(CLIENT));
    assert.equal(open.status, 503);
    assert.equal(open.body.code, 'circuit_open');
  });
});

test('an unconfigured provider returns 503 not_configured', async () => {
  await withApp({ publisher: makePublisher({ configured: false }) }, async (base) => {
    const r = await post(base, '/integrations/email/send', { clientId: CLIENT, ...GOOD }, adminHeaders());
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'not_configured');
  });
});

test('no autonomous sending: generating recommendations sends no email', async () => {
  const db = knexFactory(config.test);
  let providerCalls = 0;
  const countingTransport: EmailTransport = async () => {
    providerCalls++;
    return { status: 200, body: { id: 'should-not-happen' } };
  };
  const publisher = makePublisher({ transport: countingTransport });
  try {
    const { clientId, asOf } = await seedBriefScenario(db);
    await withApp({ publisher, knex: db }, async (base) => {
      const res = await fetch(`${base}/recommendations?clientId=${clientId}&asOf=${asOf}`, { headers: adminHeaders() });
      assert.equal(res.status, 200);
    });
    assert.equal(providerCalls, 0, 'recommendations must not trigger any email send');
  } finally {
    await db.destroy();
  }
});
