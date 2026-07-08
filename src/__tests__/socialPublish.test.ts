/**
 * Social publishing service tests (Milestone #8B).
 *
 * SANDBOX STRATEGY (explicit and intentional, mirroring M8A email): these tests
 * drive a pluggable `SocialTransport` double instead of the real network, with
 * an injected clock and a no-op sleep, so they are deterministic and never
 * publish a real post. The *provider contract* (the exact Meta Graph request
 * shapes — Facebook `/feed`, Instagram `/media` + `/media_publish` — and the
 * token-in-body rule) is still proven — see "Graph request contract" and
 * "fetchSocialTransport ... HTTP request". End-to-end against a real Meta app
 * is a deployment-gate step (set `META_ACCESS_TOKEN` + target ids and POST to
 * the endpoint); it is intentionally out of the unit suite.
 *
 * Coverage: Facebook + Instagram success paths, channel-aware validation, Graph
 * error classification (transient/rate codes vs fatal), timeout, bounded
 * retry/backoff, the Instagram two-step container flow, and per-attempt
 * accounting for all three guardrails (daily cap, rate limit, stop-on-failure)
 * — isolated per tenant AND per channel.
 *
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MetaGraphAdapter,
  SocialTransport,
  SocialTransportResponse,
  fetchSocialTransport,
} from '../integrations/social/metaGraphAdapter';
import { PublishSpendGuard, SpendGuardConfig } from '../integrations/spendGuard';
import { SocialPublishService, MAX_RETRIES_CEILING } from '../integrations/social/socialPublishService';
import { SocialPostMessage } from '../domain/social';

const FB_POST: SocialPostMessage = { channel: 'facebook', message: 'Big launch today' };
const IG_POST: SocialPostMessage = { channel: 'instagram', message: 'Launch pic', image_url: 'https://cdn.example.com/launch.jpg' };

/** Build a service around a sandbox transport with overridable knobs. */
function makeService(opts: {
  transport?: SocialTransport;
  accessToken?: string; // use the `'accessToken' in opts` sentinel to unset
  facebookPageId?: string;
  instagramUserId?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMaxMs?: number;
  guard?: Partial<SpendGuardConfig>;
  sleeps?: number[];
} = {}) {
  const shared = {
    accessToken: 'accessToken' in opts ? opts.accessToken : 'meta_test_token',
    facebookPageId: 'facebookPageId' in opts ? opts.facebookPageId : 'page-123',
    instagramUserId: 'instagramUserId' in opts ? opts.instagramUserId : 'ig-456',
    transport: opts.transport,
    timeoutMs: opts.timeoutMs ?? 20,
  };
  const adapters = {
    facebook: new MetaGraphAdapter('facebook', shared),
    instagram: new MetaGraphAdapter('instagram', shared),
  };
  const guard = new PublishSpendGuard({
    dailyCap: opts.guard?.dailyCap ?? 100,
    ratePerMinute: opts.guard?.ratePerMinute ?? 100,
    failureThreshold: opts.guard?.failureThreshold ?? 5,
    circuitCooldownMs: opts.guard?.circuitCooldownMs ?? 60_000,
    now: opts.guard?.now ?? (() => 1_700_000_000_000),
  });
  const sleeps = opts.sleeps ?? [];
  const service = new SocialPublishService(adapters, guard, {
    maxRetries: opts.maxRetries ?? 0,
    backoffBaseMs: 10,
    backoffMaxMs: opts.backoffMaxMs,
    sleep: async (ms) => { sleeps.push(ms); },
  });
  return { service, guard, sleeps };
}

const okTransport = (): SocialTransport => async () => ({ status: 200, body: { id: 'post_abc123' } });

/** A transport that records every request it receives, for call-count assertions. */
function capturingTransport(responder: (n: number) => SocialTransportResponse) {
  const requests: Array<Parameters<SocialTransport>[0]> = [];
  const transport: SocialTransport = async (req) => {
    requests.push(req);
    return responder(requests.length);
  };
  return { transport, requests };
}

const FAIL_500 = (): SocialTransportResponse => ({ status: 500, body: {} });
const OK_200 = (): SocialTransportResponse => ({ status: 200, body: { id: 'post_ok' } });

test('sandbox: a valid Facebook post publishes and returns the provider id', async () => {
  const { service } = makeService({ transport: okTransport(), guard: { dailyCap: 5 } });
  const result = await service.publish('client-A', FB_POST);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.provider, 'meta_graph');
    assert.equal(result.channel, 'facebook');
    assert.equal(result.id, 'post_abc123');
    assert.equal(result.attempts, 1);
    assert.equal(result.remaining_today, 4); // 5 cap - 1 published
  }
});

test('sandbox: an Instagram post runs the two-step container flow and returns the media id', async () => {
  const cap = capturingTransport((n) =>
    n === 1 ? { status: 200, body: { id: 'container_1' } } : { status: 200, body: { id: 'media_99' } },
  );
  const { service } = makeService({ transport: cap.transport });
  const result = await service.publish('client-A', IG_POST);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.channel, 'instagram');
    assert.equal(result.id, 'media_99');
    assert.equal(result.attempts, 1); // two HTTP calls, ONE logical attempt
  }
  assert.equal(cap.requests.length, 2);
  assert.match(cap.requests[0].url, /\/ig-456\/media$/);
  assert.match(cap.requests[1].url, /\/ig-456\/media_publish$/);
  assert.equal(cap.requests[1].params.creation_id, 'container_1');
});

test('validation: channel-invalid posts never reach the provider', async () => {
  let calls = 0;
  const spy: SocialTransport = async () => { calls++; return { status: 200, body: { id: 'x' } }; };
  const { service } = makeService({ transport: spy });

  for (const bad of [
    { channel: 'linkedin', message: 'hi' }, // unknown channel
    { channel: 'facebook' }, // no message, no link
    { channel: 'facebook', message: '   ' }, // blank message, no link
    { channel: 'facebook', message: 'hi', link: 'not-a-url' },
    { channel: 'facebook', message: 'hi', image_url: 'https://x.com/a.jpg' }, // image not supported on feed
    { channel: 'facebook', message: 'x'.repeat(2201) }, // over the text ceiling
    { channel: 'instagram', message: 'no image' }, // IG requires image_url
    { channel: 'instagram', image_url: 'ftp://cdn.example.com/a.jpg' }, // non-http(s)
    { channel: 'instagram', image_url: 'https://cdn.example.com/a.jpg', link: 'https://x.com' }, // link unsupported
  ]) {
    const r = await service.publish('client-A', bad as any);
    assert.equal(r.ok, false, JSON.stringify(bad));
    if (!r.ok) assert.equal(r.reason, 'invalid_message');
  }
  assert.equal(calls, 0, 'invalid posts must not call the provider');
});

test('a Facebook link-only post (no message) is valid', async () => {
  const cap = capturingTransport(OK_200);
  const { service } = makeService({ transport: cap.transport });
  const r = await service.publish('client-A', { channel: 'facebook', link: 'https://example.com/launch' });
  assert.equal(r.ok, true);
  assert.equal(cap.requests[0].params.link, 'https://example.com/launch');
});

test('not configured: a missing access token yields an explicit not_configured failure', async () => {
  const { service } = makeService({ accessToken: undefined, transport: undefined });
  const r = await service.publish('client-A', FB_POST);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'not_configured');
    assert.equal(r.attempts, 0);
  }
});

test('not configured is per channel: a missing IG user id blocks instagram but not facebook', async () => {
  const { service } = makeService({ transport: okTransport(), instagramUserId: undefined });
  const ig = await service.publish('client-A', IG_POST);
  assert.equal(ig.ok, false);
  if (!ig.ok) assert.equal(ig.reason, 'not_configured');
  const fb = await service.publish('client-A', FB_POST);
  assert.equal(fb.ok, true);
});

test('failure handling: a persistent provider error is reported after exhausting retries', async () => {
  const fail: SocialTransport = async () => ({ status: 500, body: { error: { message: 'server error' } } });
  const { service } = makeService({ transport: fail, maxRetries: 2 });
  const r = await service.publish('client-A', FB_POST);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'provider_error');
    assert.equal(r.attempts, 3); // 1 + 2 retries
  }
});

test('timeout handling: a slow provider is aborted and classified as timeout', async () => {
  // Never resolves until the adapter's timeout aborts the request.
  const slow: SocialTransport = (req) =>
    new Promise<SocialTransportResponse>((_, reject) => {
      req.signal.addEventListener('abort', () => {
        const e: any = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    });
  const { service } = makeService({ transport: slow, timeoutMs: 5, maxRetries: 1 });
  const r = await service.publish('client-A', FB_POST);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'timeout');
    assert.equal(r.attempts, 2);
  }
});

test('retry/backoff: transient failures retry with exponential backoff, then succeed', async () => {
  let n = 0;
  const flaky: SocialTransport = async () => {
    n++;
    return n <= 2 ? { status: 503, body: { error: { message: 'busy' } } } : { status: 200, body: { id: 'post_ok' } };
  };
  const sleeps: number[] = [];
  const { service } = makeService({ transport: flaky, maxRetries: 3, sleeps });
  const r = await service.publish('client-A', FB_POST);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.attempts, 3);
  // base=10 → 10 then 20 (exponential), no sleep after the successful attempt.
  assert.deepEqual(sleeps, [10, 20]);
});

// ---- Graph error classification ----

test('a Graph rate-limit error (code 4) is retryable', async () => {
  let n = 0;
  const throttled: SocialTransport = async () => {
    n++;
    return n === 1
      ? { status: 400, body: { error: { message: 'Application request limit reached', code: 4 } } }
      : { status: 200, body: { id: 'post_ok' } };
  };
  const { service } = makeService({ transport: throttled, maxRetries: 1 });
  const r = await service.publish('client-A', FB_POST);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.attempts, 2);
});

test('a Graph transient error (is_transient) is retryable', async () => {
  let n = 0;
  const transient: SocialTransport = async () => {
    n++;
    return n === 1
      ? { status: 400, body: { error: { message: 'Please retry', code: 2, is_transient: true } } }
      : { status: 200, body: { id: 'post_ok' } };
  };
  const { service } = makeService({ transport: transient, maxRetries: 1 });
  const r = await service.publish('client-A', FB_POST);
  assert.equal(r.ok, true);
});

test('an invalid-token Graph error (code 190) is fatal — no retry storm against a dead token', async () => {
  const cap = capturingTransport(() => ({
    status: 400,
    body: { error: { message: 'Error validating access token', code: 190 } },
  }));
  const { service } = makeService({ transport: cap.transport, maxRetries: 5 });
  const r = await service.publish('client-A', FB_POST);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'provider_error');
    assert.equal(r.attempts, 1);
    assert.match(r.detail, /access token/);
  }
  assert.equal(cap.requests.length, 1, 'a fatal provider error must not be retried');
});

test('an invalid-parameter Graph error (code 100) is fatal and classified invalid_message', async () => {
  const cap = capturingTransport(() => ({
    status: 400,
    body: { error: { message: 'Invalid parameter', code: 100 } },
  }));
  const { service } = makeService({ transport: cap.transport, maxRetries: 3 });
  const r = await service.publish('client-A', FB_POST);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'invalid_message');
  assert.equal(cap.requests.length, 1);
});

// ---- Instagram two-step specifics ----

test('an Instagram container-create failure fails the attempt without calling media_publish', async () => {
  const cap = capturingTransport(() => ({ status: 500, body: {} }));
  const { service } = makeService({ transport: cap.transport, maxRetries: 0 });
  const r = await service.publish('client-A', IG_POST);
  assert.equal(r.ok, false);
  assert.equal(cap.requests.length, 1, 'media_publish must not be called when creation fails');
  assert.match(cap.requests[0].url, /\/media$/);
});

test('an Instagram publish-step failure is retried as a whole attempt (container re-created)', async () => {
  // Attempt 1: create ok, publish 500. Attempt 2: create ok, publish ok.
  const responses: SocialTransportResponse[] = [
    { status: 200, body: { id: 'container_1' } },
    { status: 500, body: {} },
    { status: 200, body: { id: 'container_2' } },
    { status: 200, body: { id: 'media_final' } },
  ];
  const cap = capturingTransport((n) => responses[n - 1]);
  const { service } = makeService({ transport: cap.transport, maxRetries: 1 });
  const r = await service.publish('client-A', IG_POST);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.id, 'media_final');
    assert.equal(r.attempts, 2);
  }
  assert.equal(cap.requests.length, 4);
  assert.equal(cap.requests[3].params.creation_id, 'container_2', 'the retry must publish the NEW container');
});

// ---- spend guardrails (shared PublishSpendGuard, scoped tenant+channel) ----

test('spend guard: daily cap blocks further publishes for the tenant+channel', async () => {
  const { service } = makeService({ transport: okTransport(), guard: { dailyCap: 2 } });
  assert.equal((await service.publish('client-A', FB_POST)).ok, true);
  assert.equal((await service.publish('client-A', FB_POST)).ok, true);
  const third = await service.publish('client-A', FB_POST);
  assert.equal(third.ok, false);
  if (!third.ok) {
    assert.equal(third.reason, 'daily_cap_exceeded');
    assert.ok((third.retry_after_seconds ?? 0) > 0);
  }
});

test('spend guard: rate limit blocks bursts within the window', async () => {
  const { service } = makeService({ transport: okTransport(), guard: { ratePerMinute: 1, dailyCap: 100 } });
  assert.equal((await service.publish('client-A', FB_POST)).ok, true);
  const burst = await service.publish('client-A', FB_POST);
  assert.equal(burst.ok, false);
  if (!burst.ok) assert.equal(burst.reason, 'rate_limited');
});

test('spend guard: stop-on-failure opens the circuit after consecutive failures', async () => {
  const fail: SocialTransport = async () => ({ status: 500, body: {} });
  const { service } = makeService({ transport: fail, maxRetries: 0, guard: { failureThreshold: 2 } });
  assert.equal((await service.publish('client-A', FB_POST)).ok, false); // failure 1 (provider_error)
  assert.equal((await service.publish('client-A', FB_POST)).ok, false); // failure 2 -> circuit opens
  const blocked = await service.publish('client-A', FB_POST);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.reason, 'circuit_open');
    assert.equal(blocked.attempts, 0);
  }
});

test('guardrails are isolated per tenant', async () => {
  const { service } = makeService({ transport: okTransport(), guard: { dailyCap: 1 } });
  assert.equal((await service.publish('client-A', FB_POST)).ok, true);
  assert.equal((await service.publish('client-A', FB_POST)).ok, false);
  // ...but B has its own budget.
  assert.equal((await service.publish('client-B', FB_POST)).ok, true);
});

test('guardrails are isolated per channel: a spent Facebook budget does not block Instagram', async () => {
  const { service } = makeService({ transport: okTransport(), guard: { dailyCap: 1 } });
  assert.equal((await service.publish('client-A', FB_POST)).ok, true);
  assert.equal((await service.publish('client-A', FB_POST)).ok, false); // FB budget spent
  const ig = await service.publish('client-A', IG_POST);
  assert.equal(ig.ok, true, 'the Instagram budget is independent of Facebook');
});

test('each retry consumes a daily-quota unit (not one unit per logical publish)', async () => {
  const { service, guard } = makeService({ transport: async () => FAIL_500(), maxRetries: 2, guard: { dailyCap: 5 } });
  const r = await service.publish('client-A', FB_POST);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.attempts, 3);
  // 3 provider attempts consumed 3 units of the 5/day cap for this channel scope.
  assert.equal(guard.remainingToday('client-A|facebook'), 2);
});

test('the daily cap bounds total provider attempts across retries', async () => {
  const cap = capturingTransport(FAIL_500);
  const { service } = makeService({ transport: cap.transport, maxRetries: 5, guard: { dailyCap: 2 } });
  const r = await service.publish('client-A', FB_POST);
  assert.equal(r.ok, false);
  assert.equal(cap.requests.length, 2, 'retries must not exceed the daily cap of provider attempts');
});

test('maxRetries is hard-capped at the ceiling (no unbounded retry path)', async () => {
  const cap = capturingTransport(FAIL_500);
  const { service } = makeService({
    transport: cap.transport,
    maxRetries: 1000, // absurd config…
    guard: { dailyCap: 10_000, ratePerMinute: 10_000, failureThreshold: 10_000 },
  });
  const r = await service.publish('client-A', FB_POST);
  assert.equal(r.ok, false);
  // …is clamped: total provider attempts = ceiling + 1.
  assert.equal(cap.requests.length, MAX_RETRIES_CEILING + 1);
});

// ---- explicit provider contract (no real network) ----

test('Graph request contract: Facebook posts to /{page-id}/feed with the token in the BODY, not the URL', async () => {
  const cap = capturingTransport(OK_200);
  const { service } = makeService({ transport: cap.transport });
  await service.publish('client-A', { channel: 'facebook', message: 'Hello', link: 'https://example.com' });
  assert.equal(cap.requests.length, 1);
  const req = cap.requests[0];
  assert.equal(req.url, 'https://graph.facebook.com/v23.0/page-123/feed');
  assert.ok(!req.url.includes('meta_test_token'), 'the access token must never appear in the URL');
  assert.equal(req.params.access_token, 'meta_test_token');
  assert.equal(req.params.message, 'Hello');
  assert.equal(req.params.link, 'https://example.com');
});

test('Graph request contract: Instagram creates a container then publishes it', async () => {
  const cap = capturingTransport((n) =>
    n === 1 ? { status: 200, body: { id: 'container_7' } } : { status: 200, body: { id: 'media_7' } },
  );
  const { service } = makeService({ transport: cap.transport });
  await service.publish('client-A', IG_POST);
  const [create, publish] = cap.requests;
  assert.equal(create.url, 'https://graph.facebook.com/v23.0/ig-456/media');
  assert.equal(create.params.image_url, IG_POST.image_url);
  assert.equal(create.params.caption, IG_POST.message);
  assert.equal(create.params.access_token, 'meta_test_token');
  assert.equal(publish.url, 'https://graph.facebook.com/v23.0/ig-456/media_publish');
  assert.equal(publish.params.creation_id, 'container_7');
});

test('fetchSocialTransport issues a form-encoded POST and parses the response', async () => {
  const calls: Array<{ url: any; init: any }> = [];
  const realFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: any, init: any) => {
    calls.push({ url, init });
    return { status: 200, json: async () => ({ id: 'post_real' }) };
  };
  try {
    const ac = new AbortController();
    const res = await fetchSocialTransport({
      url: 'https://graph.facebook.com/v23.0/page-1/feed',
      params: { message: 'hi there', access_token: 'tok_live_abc' },
      signal: ac.signal,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 'post_real');

    const { url, init } = calls[0];
    assert.equal(url, 'https://graph.facebook.com/v23.0/page-1/feed');
    assert.equal(init.method, 'POST');
    assert.match(init.headers['content-type'], /application\/x-www-form-urlencoded/);
    const sent = new URLSearchParams(init.body);
    assert.equal(sent.get('message'), 'hi there');
    assert.equal(sent.get('access_token'), 'tok_live_abc');
  } finally {
    (globalThis as any).fetch = realFetch;
  }
});
