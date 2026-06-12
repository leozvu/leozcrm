/**
 * Email publishing service tests (Milestone #8A + remediation).
 *
 * SANDBOX STRATEGY (explicit and intentional): these tests drive a pluggable
 * `EmailTransport` double instead of the real network, with an injected clock
 * and a no-op sleep, so they are deterministic and never send a real email. The
 * *provider contract* (the exact Resend request shape and credential header) is
 * still proven — see "Resend request contract" (asserts the request the adapter
 * builds) and "fetchEmailTransport ... HTTP request" (asserts the real default
 * transport's `fetch` call). End-to-end against the real Resend sandbox is a
 * deployment-gate step (set `RESEND_API_KEY` + `EMAIL_FROM` and POST to the
 * endpoint); it is intentionally out of the unit suite.
 *
 * Coverage: successful send, validation, provider-failure, timeout, bounded
 * retry/backoff, sender-identity enforcement, and per-attempt accounting for all
 * three guardrails (daily cap, rate limit, stop-on-failure) — isolated per tenant.
 *
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ResendEmailAdapter,
  EmailTransport,
  EmailTransportResponse,
  fetchEmailTransport,
} from '../integrations/email/resendEmailAdapter';
import { EmailSpendGuard, SpendGuardConfig } from '../integrations/email/spendGuard';
import { EmailPublishService, MAX_RETRIES_CEILING } from '../integrations/email/emailPublishService';

const GOOD = { to: 'lead@example.com', subject: 'Hi', text: 'hello there' };
const FROM = 'LeozOps <noreply@example.com>';

/** Build a service around a sandbox transport with overridable knobs. */
function makeService(opts: {
  transport?: EmailTransport;
  apiKey?: string;
  from?: string; // use the `'from' in opts` sentinel to set undefined/invalid
  timeoutMs?: number;
  maxRetries?: number;
  backoffMaxMs?: number;
  allowedFrom?: string[];
  guard?: Partial<SpendGuardConfig>;
  sleeps?: number[];
} = {}) {
  const adapter = new ResendEmailAdapter({
    apiKey: 'apiKey' in opts ? opts.apiKey : 'test_key',
    from: 'from' in opts ? opts.from : FROM,
    transport: opts.transport,
    timeoutMs: opts.timeoutMs ?? 20,
  });
  const guard = new EmailSpendGuard({
    dailyCap: opts.guard?.dailyCap ?? 100,
    ratePerMinute: opts.guard?.ratePerMinute ?? 100,
    failureThreshold: opts.guard?.failureThreshold ?? 5,
    circuitCooldownMs: opts.guard?.circuitCooldownMs ?? 60_000,
    now: opts.guard?.now ?? (() => 1_700_000_000_000),
  });
  const sleeps = opts.sleeps ?? [];
  const service = new EmailPublishService(adapter, guard, {
    maxRetries: opts.maxRetries ?? 0,
    backoffBaseMs: 10,
    backoffMaxMs: opts.backoffMaxMs,
    allowedFrom: opts.allowedFrom,
    sleep: async (ms) => { sleeps.push(ms); },
  });
  return { service, guard, sleeps };
}

const okTransport = (): EmailTransport => async () => ({ status: 200, body: { id: 'email_abc123' } });

/** A transport that records every request it receives, for call-count assertions. */
function capturingTransport(responder: (n: number) => EmailTransportResponse) {
  const requests: Array<Parameters<EmailTransport>[0]> = [];
  const transport: EmailTransport = async (req) => {
    requests.push(req);
    return responder(requests.length);
  };
  return { transport, requests };
}

const FAIL_500 = (): EmailTransportResponse => ({ status: 500, body: {} });
const OK_200 = (): EmailTransportResponse => ({ status: 200, body: { id: 'email_ok' } });

test('sandbox: a valid message sends and returns the provider id', async () => {
  const { service } = makeService({ transport: okTransport(), guard: { dailyCap: 5 } });
  const result = await service.publish('client-A', GOOD);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.provider, 'resend');
    assert.equal(result.id, 'email_abc123');
    assert.equal(result.attempts, 1);
    assert.equal(result.remaining_today, 4); // 5 cap - 1 sent
  }
});

test('validation: bad recipient / missing subject / empty body never reach the provider', async () => {
  let calls = 0;
  const spy: EmailTransport = async () => { calls++; return { status: 200, body: { id: 'x' } }; };
  const { service } = makeService({ transport: spy });

  for (const bad of [
    { to: 'not-an-email', subject: 'a', text: 'b' },
    { to: 'a@b.com', subject: '', text: 'b' },
    { to: 'a@b.com', subject: 'a' }, // no body
  ]) {
    const r = await service.publish('client-A', bad as any);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'invalid_message');
  }
  assert.equal(calls, 0, 'invalid messages must not call the provider');
});

test('not configured: missing API key/transport yields an explicit not_configured failure', async () => {
  const { service } = makeService({ apiKey: undefined, transport: undefined });
  const r = await service.publish('client-A', GOOD);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'not_configured');
    assert.equal(r.attempts, 0);
  }
});

test('failure handling: a persistent provider error is reported after exhausting retries', async () => {
  const fail: EmailTransport = async () => ({ status: 500, body: { message: 'server error' } });
  const { service } = makeService({ transport: fail, maxRetries: 2 });
  const r = await service.publish('client-A', GOOD);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'provider_error');
    assert.equal(r.attempts, 3); // 1 + 2 retries
  }
});

test('timeout handling: a slow provider is aborted and classified as timeout', async () => {
  // Never resolves until the adapter's timeout aborts the request.
  const slow: EmailTransport = (req) =>
    new Promise<EmailTransportResponse>((_, reject) => {
      req.signal.addEventListener('abort', () => {
        const e: any = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    });
  const { service } = makeService({ transport: slow, timeoutMs: 5, maxRetries: 1 });
  const r = await service.publish('client-A', GOOD);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'timeout');
    assert.equal(r.attempts, 2);
  }
});

test('retry/backoff: transient failures retry with exponential backoff, then succeed', async () => {
  let n = 0;
  const flaky: EmailTransport = async () => {
    n++;
    return n <= 2 ? { status: 503, body: { message: 'busy' } } : { status: 200, body: { id: 'email_ok' } };
  };
  const sleeps: number[] = [];
  const { service } = makeService({ transport: flaky, maxRetries: 3, sleeps });
  const r = await service.publish('client-A', GOOD);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.attempts, 3);
  // base=10 → 10 then 20 (exponential), no sleep after the successful attempt.
  assert.deepEqual(sleeps, [10, 20]);
});

test('spend guard: daily cap blocks further sends for the tenant', async () => {
  const { service } = makeService({ transport: okTransport(), guard: { dailyCap: 2 } });
  assert.equal((await service.publish('client-A', GOOD)).ok, true);
  assert.equal((await service.publish('client-A', GOOD)).ok, true);
  const third = await service.publish('client-A', GOOD);
  assert.equal(third.ok, false);
  if (!third.ok) {
    assert.equal(third.reason, 'daily_cap_exceeded');
    assert.ok((third.retry_after_seconds ?? 0) > 0);
  }
});

test('spend guard: rate limit blocks bursts within the window', async () => {
  const { service } = makeService({ transport: okTransport(), guard: { ratePerMinute: 1, dailyCap: 100 } });
  assert.equal((await service.publish('client-A', GOOD)).ok, true);
  const burst = await service.publish('client-A', GOOD);
  assert.equal(burst.ok, false);
  if (!burst.ok) assert.equal(burst.reason, 'rate_limited');
});

test('spend guard: stop-on-failure opens the circuit after consecutive failures', async () => {
  const fail: EmailTransport = async () => ({ status: 500, body: {} });
  const { service } = makeService({ transport: fail, maxRetries: 0, guard: { failureThreshold: 2 } });
  // Two real provider failures trip the breaker...
  assert.equal((await service.publish('client-A', GOOD)).ok, false); // failure 1 (provider_error)
  assert.equal((await service.publish('client-A', GOOD)).ok, false); // failure 2 -> circuit opens
  // ...the next send is blocked by the open circuit before reaching the provider.
  const blocked = await service.publish('client-A', GOOD);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.reason, 'circuit_open');
    assert.equal(blocked.attempts, 0);
  }
});

test('guardrails are isolated per tenant', async () => {
  const { service } = makeService({ transport: okTransport(), guard: { dailyCap: 1 } });
  assert.equal((await service.publish('client-A', GOOD)).ok, true);
  // A's cap is spent...
  assert.equal((await service.publish('client-A', GOOD)).ok, false);
  // ...but B has its own budget.
  assert.equal((await service.publish('client-B', GOOD)).ok, true);
});

// ---- remediation: per-attempt guard accounting ----

test('each retry consumes a daily-quota unit (not one unit per logical publish)', async () => {
  const { service, guard } = makeService({ transport: async () => FAIL_500(), maxRetries: 2, guard: { dailyCap: 5 } });
  const r = await service.publish('client-A', GOOD);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.attempts, 3);
  // 3 provider attempts consumed 3 units of the 5/day cap.
  assert.equal(guard.remainingToday('client-A'), 2);
});

test('the daily cap bounds total provider calls across retries', async () => {
  const cap = capturingTransport(FAIL_500);
  const { service } = makeService({ transport: cap.transport, maxRetries: 5, guard: { dailyCap: 2 } });
  const r = await service.publish('client-A', GOOD);
  assert.equal(r.ok, false);
  assert.equal(cap.requests.length, 2, 'retries must not exceed the daily cap of provider calls');
});

test('the rate limit bounds total provider calls across retries', async () => {
  const cap = capturingTransport(FAIL_500);
  const { service } = makeService({ transport: cap.transport, maxRetries: 5, guard: { ratePerMinute: 1, dailyCap: 100 } });
  const r = await service.publish('client-A', GOOD);
  assert.equal(r.ok, false);
  assert.equal(cap.requests.length, 1, 'retries must not exceed the rate limit of provider calls');
});

test('the circuit breaker counts every failed attempt and bounds retries within one publish', async () => {
  const cap = capturingTransport(FAIL_500);
  const { service } = makeService({ transport: cap.transport, maxRetries: 5, guard: { failureThreshold: 2 } });
  const r = await service.publish('client-A', GOOD);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.attempts, 2);
  // attempt 1 → failure 1; attempt 2 → failure 2 opens the circuit; the next
  // pre-attempt check blocks, so only 2 provider calls were made.
  assert.equal(cap.requests.length, 2);
});

test('per-attempt failures open the circuit, blocking subsequent publishes', async () => {
  const cap = capturingTransport(FAIL_500);
  const { service } = makeService({ transport: cap.transport, maxRetries: 5, guard: { failureThreshold: 3 } });
  const first = await service.publish('client-A', GOOD);
  assert.equal(first.ok, false);
  assert.equal(cap.requests.length, 3, '3 failed attempts trip the threshold of 3');
  const second = await service.publish('client-A', GOOD);
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.reason, 'circuit_open');
    assert.equal(second.attempts, 0);
  }
  assert.equal(cap.requests.length, 3, 'an open circuit makes no further provider calls');
});

// ---- remediation: bounded retry/backoff ----

test('maxRetries is hard-capped at the ceiling (no unbounded retry path)', async () => {
  const cap = capturingTransport(FAIL_500);
  const { service } = makeService({
    transport: cap.transport,
    maxRetries: 1000, // absurd config…
    guard: { dailyCap: 10_000, ratePerMinute: 10_000, failureThreshold: 10_000 },
  });
  const r = await service.publish('client-A', GOOD);
  assert.equal(r.ok, false);
  // …is clamped: total provider calls = ceiling + 1.
  assert.equal(cap.requests.length, MAX_RETRIES_CEILING + 1);
});

// ---- remediation: sender identity enforcement ----

test('missing EMAIL_FROM is rejected (not_configured) before any provider call', async () => {
  const cap = capturingTransport(OK_200);
  const { service } = makeService({ from: undefined, transport: cap.transport });
  const r = await service.publish('client-A', GOOD);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'not_configured');
  assert.equal(cap.requests.length, 0);
});

test('invalid EMAIL_FROM is rejected (not_configured) before any provider call', async () => {
  const cap = capturingTransport(OK_200);
  const { service } = makeService({ from: 'not a real sender', transport: cap.transport });
  const r = await service.publish('client-A', GOOD);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'not_configured');
  assert.equal(cap.requests.length, 0);
});

test('a caller-provided "from" is rejected when no allowlist is configured', async () => {
  const cap = capturingTransport(OK_200);
  const { service } = makeService({ transport: cap.transport });
  const r = await service.publish('client-A', { ...GOOD, from: 'spoof@attacker.com' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'invalid_message');
  assert.equal(cap.requests.length, 0, 'a disallowed sender must never reach the provider');
});

test('a caller-provided "from" on the allowlist is honoured', async () => {
  const sender = 'Promo <promo@example.com>';
  const cap = capturingTransport(OK_200);
  const { service } = makeService({ transport: cap.transport, allowedFrom: [sender] });
  const r = await service.publish('client-A', { ...GOOD, from: sender });
  assert.equal(r.ok, true);
  assert.equal(cap.requests[0].body.from, sender);
});

// ---- remediation: explicit provider contract (no real network) ----

test('Resend request contract: the adapter builds the documented POST body + credentials', async () => {
  const cap = capturingTransport(OK_200);
  const { service } = makeService({ transport: cap.transport, apiKey: 'sk_test_123' });
  await service.publish('client-A', { to: 'r@example.com', subject: 'Subj', html: '<p>hi</p>' });
  assert.equal(cap.requests.length, 1);
  const req = cap.requests[0];
  assert.equal(req.url, 'https://api.resend.com/emails');
  assert.equal(req.apiKey, 'sk_test_123');
  assert.equal(req.body.from, FROM); // configured sender, not caller-controlled
  assert.deepEqual(req.body.to, ['r@example.com']);
  assert.equal(req.body.subject, 'Subj');
  assert.equal(req.body.html, '<p>hi</p>');
});

test('fetchEmailTransport issues the documented Resend HTTP request and parses the response', async () => {
  const calls: Array<{ url: any; init: any }> = [];
  const realFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: any, init: any) => {
    calls.push({ url, init });
    return { status: 200, json: async () => ({ id: 'email_real' }) };
  };
  try {
    const ac = new AbortController();
    const res = await fetchEmailTransport({
      url: 'https://api.resend.com/emails',
      apiKey: 'sk_live_abc',
      body: { from: 'A <a@b.com>', to: ['x@y.z'], subject: 'S', text: 'T' },
      signal: ac.signal,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 'email_real');

    const { url, init } = calls[0];
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.authorization, 'Bearer sk_live_abc');
    assert.match(init.headers['content-type'], /application\/json/);
    const sent = JSON.parse(init.body);
    assert.equal(sent.from, 'A <a@b.com>');
    assert.deepEqual(sent.to, ['x@y.z']);
    assert.equal(sent.subject, 'S');
    assert.equal(sent.text, 'T');
  } finally {
    (globalThis as any).fetch = realFetch;
  }
});
