/**
 * Social publish route tests (Milestone #8B).
 *
 * SANDBOX STRATEGY: the app is booted with an injected publisher whose transport
 * is a deterministic double (no real network) — these tests assert the HTTP
 * contract, not provider delivery. The real Meta Graph request/credential
 * contract is proven separately in socialPublish.test.ts; real end-to-end
 * posting is a deployment-gate step gated on `META_ACCESS_TOKEN`.
 *
 * Asserts: auth + tenant isolation, Facebook and Instagram success paths,
 * reason→status mapping (400/429/502/503), Retry-After, and — critically — that
 * generating recommendations publishes NO post (publishing is explicit, never
 * autonomous).
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
import { MetaGraphAdapter, SocialTransport } from '../integrations/social/metaGraphAdapter';
import { PublishSpendGuard, SpendGuardConfig } from '../integrations/spendGuard';
import { SocialPublishService } from '../integrations/social/socialPublishService';
import { TEST_AUTH, adminHeaders, clientHeaders } from './support/authHarness';
import { seedBriefScenario } from './support/briefScenario';
import type { Knex } from 'knex';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const FB_POST = { channel: 'facebook', message: 'Launch update' };
const IG_POST = { channel: 'instagram', message: 'Launch pic', image_url: 'https://cdn.example.com/pic.jpg' };

interface PublisherOpts {
  transport?: SocialTransport;
  configured?: boolean; // default true
  maxRetries?: number;
  guard?: Partial<SpendGuardConfig>;
}

function makePublisher(opts: PublisherOpts = {}) {
  const configured = opts.configured ?? true;
  const shared = {
    accessToken: configured ? 'meta_test_token' : undefined,
    facebookPageId: 'page-123',
    instagramUserId: 'ig-456',
    transport: configured ? (opts.transport ?? okTransport()) : undefined,
    timeoutMs: 20,
  };
  const adapters = {
    facebook: new MetaGraphAdapter('facebook', shared),
    instagram: new MetaGraphAdapter('instagram', shared),
  };
  const guard = new PublishSpendGuard({
    dailyCap: opts.guard?.dailyCap ?? 100,
    ratePerMinute: opts.guard?.ratePerMinute ?? 100,
    failureThreshold: opts.guard?.failureThreshold ?? 5,
    now: opts.guard?.now ?? (() => 1_700_000_000_000),
  });
  return new SocialPublishService(adapters, guard, { maxRetries: opts.maxRetries ?? 0, backoffBaseMs: 1, sleep: async () => {} });
}

function okTransport(): SocialTransport {
  return async () => ({ status: 200, body: { id: 'post_route_ok' } });
}

async function withApp(
  opts: { publisher: SocialPublishService; knex?: Knex },
  fn: (base: string) => Promise<void>,
) {
  const app = createApp({ auth: TEST_AUTH, socialPublisher: opts.publisher, knex: opts.knex });
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
    const r = await post(base, '/integrations/social/publish', { clientId: CLIENT, ...FB_POST });
    assert.equal(r.status, 401);
  });
});

test('publish is tenant-scoped: a client cannot post for another tenant', async () => {
  await withApp({ publisher: makePublisher() }, async (base) => {
    const r = await post(base, '/integrations/social/publish', { clientId: 'someone-else', ...FB_POST }, clientHeaders(CLIENT));
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'forbidden_tenant');
  });
});

test('publish succeeds for an in-scope client (sandbox) and for admin, on both channels', async () => {
  const publisher = makePublisher({
    transport: async (req) => ({
      status: 200,
      body: { id: req.url.endsWith('/media') ? 'container_x' : 'post_route_ok' },
    }),
  });
  await withApp({ publisher }, async (base) => {
    const fb = await post(base, '/integrations/social/publish', { clientId: CLIENT, ...FB_POST }, clientHeaders(CLIENT));
    assert.equal(fb.status, 200);
    assert.equal(fb.body.ok, true);
    assert.equal(fb.body.channel, 'facebook');
    assert.equal(fb.body.id, 'post_route_ok');

    const ig = await post(base, '/integrations/social/publish', { clientId: CLIENT, ...IG_POST }, clientHeaders(CLIENT));
    assert.equal(ig.status, 200);
    assert.equal(ig.body.channel, 'instagram');

    const asAdmin = await post(base, '/integrations/social/publish', { clientId: 'any-client', ...FB_POST }, adminHeaders());
    assert.equal(asAdmin.status, 200);
    assert.equal(asAdmin.body.ok, true);
  });
});

test('publish rejects missing fields and invalid posts with 400', async () => {
  await withApp({ publisher: makePublisher() }, async (base) => {
    const missing = await post(base, '/integrations/social/publish', { clientId: CLIENT }, clientHeaders(CLIENT));
    assert.equal(missing.status, 400);

    const badChannel = await post(base, '/integrations/social/publish', { clientId: CLIENT, channel: 'linkedin', message: 'x' }, clientHeaders(CLIENT));
    assert.equal(badChannel.status, 400);
    assert.equal(badChannel.body.code, 'invalid_message');

    const noBody = await post(base, '/integrations/social/publish', { clientId: CLIENT, channel: 'facebook' }, clientHeaders(CLIENT));
    assert.equal(noBody.status, 400);

    const noImage = await post(base, '/integrations/social/publish', { clientId: CLIENT, channel: 'instagram', message: 'x' }, clientHeaders(CLIENT));
    assert.equal(noImage.status, 400);
    assert.equal(noImage.body.code, 'invalid_message');
  });
});

test('daily cap returns 429 with Retry-After', async () => {
  await withApp({ publisher: makePublisher({ guard: { dailyCap: 1 } }) }, async (base) => {
    const first = await post(base, '/integrations/social/publish', { clientId: CLIENT, ...FB_POST }, clientHeaders(CLIENT));
    assert.equal(first.status, 200);
    const second = await post(base, '/integrations/social/publish', { clientId: CLIENT, ...FB_POST }, clientHeaders(CLIENT));
    assert.equal(second.status, 429);
    assert.equal(second.body.code, 'daily_cap_exceeded');
    assert.ok(second.retryAfter && Number(second.retryAfter) > 0);
  });
});

test('a provider error maps to 502; a tripped circuit maps to 503', async () => {
  const fail: SocialTransport = async () => ({ status: 500, body: { error: { message: 'down' } } });
  await withApp({ publisher: makePublisher({ transport: fail, maxRetries: 0, guard: { failureThreshold: 1 } }) }, async (base) => {
    const err = await post(base, '/integrations/social/publish', { clientId: CLIENT, ...FB_POST }, clientHeaders(CLIENT));
    assert.equal(err.status, 502);
    assert.equal(err.body.code, 'provider_error');
    // failureThreshold=1 → circuit now open for this tenant+channel.
    const open = await post(base, '/integrations/social/publish', { clientId: CLIENT, ...FB_POST }, clientHeaders(CLIENT));
    assert.equal(open.status, 503);
    assert.equal(open.body.code, 'circuit_open');
  });
});

test('an unconfigured provider returns 503 not_configured', async () => {
  await withApp({ publisher: makePublisher({ configured: false }) }, async (base) => {
    const r = await post(base, '/integrations/social/publish', { clientId: CLIENT, ...FB_POST }, adminHeaders());
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'not_configured');
  });
});

test('no autonomous posting: generating recommendations publishes no post', async () => {
  const db = knexFactory(config.test);
  let providerCalls = 0;
  const countingTransport: SocialTransport = async () => {
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
    assert.equal(providerCalls, 0, 'recommendations must not trigger any social publish');
  } finally {
    await db.destroy();
  }
});
