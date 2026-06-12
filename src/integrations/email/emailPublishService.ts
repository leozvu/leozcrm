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

export interface EmailPublishConfig {
  /** Extra attempts after the first (so total attempts = maxRetries + 1). */
  maxRetries: number;
  /** Base backoff in ms; attempt N waits `backoffBaseMs * 2^(N-1)`. */
  backoffBaseMs: number;
  /** Injectable sleep (so tests don't actually wait). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class EmailPublishService {
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly adapter: ResendEmailAdapter,
    private readonly guard: EmailSpendGuard,
    config: EmailPublishConfig,
  ) {
    this.maxRetries = config.maxRetries;
    this.backoffBaseMs = config.backoffBaseMs;
    this.sleep = config.sleep ?? defaultSleep;
  }

  /** Whether sending is actually wired up (provider configured). */
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

    // 1. Validate before anything else — a bad message never reaches the provider
    //    and never consumes quota.
    const invalid = EmailPublishService.validate(message);
    if (invalid) return fail('invalid_message', invalid, 0);

    // 2. Not wired up → explicit, non-silent 503-class failure.
    if (!this.adapter.isConfigured()) {
      return fail('not_configured', 'email provider is not configured (set RESEND_API_KEY and EMAIL_FROM)', 0);
    }

    // 3. Spend guardrails (per tenant). Blocked sends never reach the provider.
    const decision = this.guard.check(clientId);
    if (!decision.allowed) {
      return fail(decision.reason, `blocked by ${decision.reason} guardrail`, 0, decision.retry_after_seconds);
    }

    // 4. Reserve one unit of daily + rate quota for this logical send.
    this.guard.reserve(clientId);

    // 5. Attempt with retry + exponential backoff on transient failures.
    let attempts = 0;
    let lastDetail = '';
    let lastReason: any = 'provider_error';
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      attempts = attempt;
      const result = await this.adapter.sendOnce(message);

      if (result.kind === 'success') {
        this.guard.recordSuccess(clientId);
        return {
          ok: true, provider: 'resend', id: result.id, client_id: clientId,
          attempts, remaining_today: this.guard.remainingToday(clientId),
        };
      }

      lastDetail = result.detail;
      lastReason = result.reason;

      if (result.kind === 'fatal') break;

      // retryable: back off and try again, unless this was the last attempt.
      if (attempt <= this.maxRetries) {
        await this.sleep(this.backoffBaseMs * 2 ** (attempt - 1));
      }
    }

    // Exhausted retries or hit a fatal error — count it toward the circuit.
    this.guard.recordFailure(clientId);
    return fail(lastReason, lastDetail, attempts);
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
  return new EmailPublishService(adapter, guard, {
    maxRetries: numberEnv('EMAIL_MAX_RETRIES', 2),
    backoffBaseMs: numberEnv('EMAIL_BACKOFF_MS', 250),
  });
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
