/**
 * Email publishing contract (Milestone #8A).
 *
 * The first real, `'live'` integration: sending transactional email through
 * Resend. It is **explicitly invoked** — an operator (or a tenant) calls the
 * publish endpoint; nothing here sends autonomously, and recommendations may
 * only *reference* a send (via `recommendation_code`), never trigger one.
 *
 * Pure types only — no I/O. The send path, spend guardrails, and provider client
 * live under `src/integrations/email/`.
 */

/** A single outbound email. At least one of `html`/`text` must be present. */
export interface EmailMessage {
  /** Recipient address. */
  to: string;
  subject: string;
  html?: string;
  text?: string;
  /** Optional sender override; defaults to the configured `EMAIL_FROM`. */
  from?: string;
  /**
   * Optional traceability: the recommendation code that prompted this send.
   * Recording it links an explicit publish back to the advice that suggested it
   * — it does NOT cause the send (which is always operator-invoked).
   */
  recommendation_code?: string;
}

/** Why a publish did not (successfully) happen. */
export type EmailFailureReason =
  | 'not_configured' // no Resend API key / transport configured
  | 'invalid_message' // missing/invalid recipient, subject, or body
  | 'daily_cap_exceeded' // per-tenant daily send cap hit
  | 'rate_limited' // per-tenant rate limit hit
  | 'circuit_open' // stop-on-failure threshold tripped
  | 'provider_error' // Resend returned an error (or non-2xx) after retries
  | 'timeout' // request exceeded the timeout after retries
  | 'network_error'; // transport failed to reach the provider after retries

export interface EmailPublishSuccess {
  ok: true;
  provider: 'resend';
  /** Provider message id. */
  id: string;
  client_id: string;
  /** Number of provider attempts made (1 = no retry needed). */
  attempts: number;
  /** Remaining sends allowed for this tenant today (after this send). */
  remaining_today: number;
}

export interface EmailPublishFailure {
  ok: false;
  provider: 'resend';
  client_id: string;
  reason: EmailFailureReason;
  detail: string;
  /** Provider attempts made before giving up (0 when blocked before sending). */
  attempts: number;
  /** Suggested wait before retrying, when the failure is a cap/rate/circuit limit. */
  retry_after_seconds?: number;
}

export type EmailPublishResult = EmailPublishSuccess | EmailPublishFailure;
