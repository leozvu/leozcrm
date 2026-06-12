/**
 * Email publishing service tests (Milestone #8A). Drive the EmailPublishService
 * against a SANDBOX transport (no real network) with an injected clock and a
 * no-op sleep, proving: successful send, message validation, provider-failure
 * handling, timeout handling, retry + exponential backoff, and all three spend
 * guardrails (daily cap, rate limit, stop-on-failure) — isolated per tenant.
 *
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ResendEmailAdapter,
  EmailTransport,
  EmailTransportResponse,
} from '../integrations/email/resendEmailAdapter';
import { EmailSpendGuard, SpendGuardConfig } from '../integrations/email/spendGuard';
import { EmailPublishService } from '../integrations/email/emailPublishService';

const GOOD = { to: 'lead@example.com', subject: 'Hi', text: 'hello there' };

/** Build a service around a sandbox transport with overridable knobs. */
function makeService(opts: {
  transport?: EmailTransport;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  guard?: Partial<SpendGuardConfig>;
  sleeps?: number[];
} = {}) {
  const adapter = new ResendEmailAdapter({
    apiKey: 'apiKey' in opts ? opts.apiKey : 'test_key',
    from: 'LeozOps <noreply@example.com>',
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
    sleep: async (ms) => { sleeps.push(ms); },
  });
  return { service, guard, sleeps };
}

const okTransport = (): EmailTransport => async () => ({ status: 200, body: { id: 'email_abc123' } });

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
