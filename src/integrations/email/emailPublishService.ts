import { EmailMessage, EmailPublishResult } from '../../domain/email';
import { isEmail } from '../../domain/validate';
import { ResendEmailAdapter, fetchEmailTransport } from './resendEmailAdapter';
import { EmailSpendGuard } from './spendGuard';

/**
 * Email publish orchestration (Milestone #8A).
 *
 * The single, explicitly-invoked entry point for sending email. It is the only
 * place that ties together:
 *
 *   1. message validation (clean failure, never a provider call on bad input),
 *   2. per-tenant spend guardrails (daily cap, rate limit, stop-on-failure),
 *   3. the provider edge (`ResendEmailAdapter.sendOnce`) with retry + exponential
 *      backoff on transient (retryable) failures.
 *
 * It performs NO autonomous sending: callers (the publish route) invoke
 * `publish` explicitly per request. `sleep` is injectable so backoff is instant
 * under test.
 */

/** Default extra attempts after the first. */
export const DEFAULT_MAX_RETRIES = 2;
/** Hard ceiling on retries — configuration can never exceed this. */
export const MAX_RETRIES_CEILING = 5;
/** Default base backoff (ms). */
export const DEFAULT_BACKOFF_BASE_MS = 250;
/** Hard ceiling on a single backoff wait (ms), so backoff can't grow unbounded. */
export const DEFAULT_BACKOFF_MAX_MS = 30_000;

export interface EmailPublishConfig {
  /**
   * Extra attempts after the first (total provider attempts = maxRetries + 1).
   * Clamped to `[0, MAX_RETRIES_CEILING]` so no configuration can produce an
   * unbounded retry path.
   */
  maxRetries: number;
  /** Base backoff in ms; retry N waits `min(backoffMaxMs, backoffBaseMs * 2^N)`. */
  backoffBaseMs: number;
  /** Upper bound on a single backoff wait (defaults to DEFAULT_BACKOFF_MAX_MS). */
  backoffMaxMs?: number;
  /**
   * Exact sender strings a caller may pass as `from`. Empty (default) means a
   * caller-provided `from` is rejected and only the configured `EMAIL_FROM` is
   * used.
   */
  allowedFrom?: string[];
  /** Injectable sleep (so tests don't actually wait). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Clamp `value` into `[min, max]`, falling back to `fallback` when not finite. */
function clampInt(value: number, min: number, max: number, fallback: number): number {
  const n = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

export class EmailPublishService {
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly allowedFrom: string[];
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly adapter: ResendEmailAdapter,
    private readonly guard: EmailSpendGuard,
    config: EmailPublishConfig,
  ) {
    // Hard-bound retries so neither env nor injected config can multiply
    // external calls without limit.
    this.maxRetries = clampInt(config.maxRetries, 0, MAX_RETRIES_CEILING, DEFAULT_MAX_RETRIES);
    this.backoffBaseMs = Number.isFinite(config.backoffBaseMs) ? Math.max(0, config.backoffBaseMs) : DEFAULT_BACKOFF_BASE_MS;
    this.backoffMaxMs = config.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    this.allowedFrom = config.allowedFrom ?? [];
    this.sleep = config.sleep ?? defaultSleep;
  }

  /** Whether sending is actually wired up (provider + valid sender configured). */
  isConfigured(): boolean {
    return this.adapter.isConfigured();
  }

  private static validate(message: EmailMessage): string | null {
    if (!isEmail(message.to)) return 'a valid "to" email address is required';
    if (typeof message.subject !== 'string' || message.subject.trim() === '') return 'a non-empty "subject" is required';
    const hasBody = (typeof message.html === 'string' && message.html.trim() !== '') ||
      (typeof message.text === 'string' && message.text.trim() !== '');
    if (!hasBody) return 'an email body ("html" or "text") is required';
    return null;
  }

  async publish(clientId: string, message: EmailMessage): Promise<EmailPublishResult> {
    const fail = (reason: any, detail: string, attempts: number, retry_after_seconds?: number): EmailPublishResult => ({
      ok: false, provider: 'resend', client_id: clientId, reason, detail, attempts, retry_after_seconds,
    });

    // 1. Validate the message — bad input never reaches the provider or quota.
    const invalid = EmailPublishService.validate(message);
    if (invalid) return fail('invalid_message', invalid, 0);

    // 2. Sender identity: a caller-provided `from` is only honoured when it is on
    //    the configured allowlist; otherwise it is rejected before any send.
    if (message.from !== undefined && !this.allowedFrom.includes(message.from)) {
      return fail('invalid_message', 'a caller-provided "from" sender is not allowed', 0);
    }

    // 3. Not wired up (missing API key/transport or missing/invalid EMAIL_FROM)
    //    → explicit, non-silent 503-class failure, before any provider call.
    if (!this.adapter.isConfigured()) {
      return fail('not_configured', 'email provider is not configured (set RESEND_API_KEY and a valid EMAIL_FROM)', 0);
    }

    // 4. Attempt with retry + bounded exponential backoff. The spend/rate/circuit
    //    guard is checked and one unit reserved BEFORE EVERY provider attempt, so
    //    retries can never exceed the daily cap, rate limit, or circuit breaker.
    let providerAttempts = 0;
    let lastDetail = '';
    let lastReason: any = 'provider_error';
    for (let i = 0; i <= this.maxRetries; i++) {
      const decision = this.guard.check(clientId);
      if (!decision.allowed) {
        // Blocked before the very first call → report the guard reason. Blocked
        // mid-retry → stop here (don't exceed the guard) and report the last
        // provider failure that already occurred.
        if (providerAttempts === 0) {
          return fail(decision.reason, `blocked by ${decision.reason} guardrail`, 0, decision.retry_after_seconds);
        }
        break;
      }

      // Consume one daily + rate unit for THIS attempt.
      this.guard.reserve(clientId);
      providerAttempts++;

      const result = await this.adapter.sendOnce(message);
      if (result.kind === 'success') {
        this.guard.recordSuccess(clientId);
        return {
          ok: true, provider: 'resend', id: result.id, client_id: clientId,
          attempts: providerAttempts, remaining_today: this.guard.remainingToday(clientId),
        };
      }

      // Record EVERY failed provider attempt toward the circuit breaker.
      this.guard.recordFailure(clientId);
      lastDetail = result.detail;
      lastReason = result.reason;
      if (result.kind === 'fatal') break;

      // Transient: back off (bounded) before the next iteration re-checks the guard.
      if (i < this.maxRetries) {
        await this.sleep(Math.min(this.backoffMaxMs, this.backoffBaseMs * 2 ** i));
      }
    }

    return fail(lastReason, lastDetail, providerAttempts);
  }
}

/**
 * Build the process-wide publisher from environment configuration. When
 * `RESEND_API_KEY` is unset the adapter is "unconfigured" and the service
 * returns a `not_configured` failure rather than throwing — so the route mounts
 * either way and the failure is explicit.
 */
export function buildEmailPublisherFromEnv(): EmailPublishService {
  const adapter = new ResendEmailAdapter({
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    transport: process.env.RESEND_API_KEY ? fetchEmailTransport : undefined,
    timeoutMs: numberEnv('EMAIL_TIMEOUT_MS', 10_000),
  });
  const guard = new EmailSpendGuard({
    dailyCap: numberEnv('EMAIL_DAILY_CAP', 100),
    ratePerMinute: numberEnv('EMAIL_RATE_PER_MINUTE', 10),
    failureThreshold: numberEnv('EMAIL_FAILURE_THRESHOLD', 5),
  });
  // Exact sender strings a caller may supply as `from` (comma-separated). Empty
  // by default → caller-provided senders are rejected.
  const allowedFrom = (process.env.EMAIL_ALLOWED_FROM ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new EmailPublishService(adapter, guard, {
    // Clamped to [0, MAX_RETRIES_CEILING] inside the service.
    maxRetries: numberEnv('EMAIL_MAX_RETRIES', DEFAULT_MAX_RETRIES),
    backoffBaseMs: numberEnv('EMAIL_BACKOFF_MS', DEFAULT_BACKOFF_BASE_MS),
    backoffMaxMs: numberEnv('EMAIL_BACKOFF_MAX_MS', DEFAULT_BACKOFF_MAX_MS),
    allowedFrom,
  });
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
