/**
 * Per-tenant publish spend guardrails (introduced in Milestone #8A for email,
 * generalised in #8B so the social channels share the identical mechanism).
 *
 * Three independent guards, all keyed by a caller-chosen scope key (the email
 * path keys by `client_id`; the social path keys by `client_id|channel`) so one
 * tenant can never spend another's budget:
 *
 *   - daily send cap      — at most `dailyCap` publishes per UTC day
 *   - rate limit          — at most `ratePerMinute` publishes per rolling 60s
 *   - stop-on-failure     — after `failureThreshold` consecutive provider
 *                           failures the circuit opens for `circuitCooldownMs`,
 *                           refusing publishes until it cools down or one succeeds
 *
 * State is in-memory (no schema change): a daily counter that rolls over by UTC
 * date, a sliding window of recent publish timestamps, and a consecutive-failure
 * counter / circuit deadline. The clock is injectable so the behaviour is
 * deterministic under test.
 */

export interface SpendGuardConfig {
  /** Max publishes per scope key per UTC day. */
  dailyCap: number;
  /** Max publishes per scope key per rolling 60 seconds. */
  ratePerMinute: number;
  /** Consecutive provider failures before the circuit opens. */
  failureThreshold: number;
  /** How long the circuit stays open once tripped (ms). */
  circuitCooldownMs?: number;
  /** Injectable clock (ms since epoch). Defaults to `Date.now`. */
  now?: () => number;
}

export type GuardDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'daily_cap_exceeded' | 'rate_limited' | 'circuit_open';
      retry_after_seconds: number;
    };

interface TenantState {
  day: string; // UTC YYYY-MM-DD the dayCount belongs to
  dayCount: number;
  recent: number[]; // publish timestamps within the rate window
  consecutiveFailures: number;
  circuitOpenUntil: number; // ms; 0 when closed
}

const RATE_WINDOW_MS = 60_000;

export class PublishSpendGuard {
  private readonly dailyCap: number;
  private readonly ratePerMinute: number;
  private readonly failureThreshold: number;
  private readonly circuitCooldownMs: number;
  private readonly now: () => number;
  private readonly tenants = new Map<string, TenantState>();

  constructor(config: SpendGuardConfig) {
    this.dailyCap = config.dailyCap;
    this.ratePerMinute = config.ratePerMinute;
    this.failureThreshold = config.failureThreshold;
    this.circuitCooldownMs = config.circuitCooldownMs ?? 5 * 60_000;
    this.now = config.now ?? (() => Date.now());
  }

  private dayKey(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  private state(scopeKey: string): TenantState {
    let s = this.tenants.get(scopeKey);
    if (!s) {
      s = { day: this.dayKey(this.now()), dayCount: 0, recent: [], consecutiveFailures: 0, circuitOpenUntil: 0 };
      this.tenants.set(scopeKey, s);
    }
    // Roll the daily counter over at the UTC date boundary.
    const today = this.dayKey(this.now());
    if (s.day !== today) {
      s.day = today;
      s.dayCount = 0;
    }
    // Drop publish timestamps outside the rate window.
    const cutoff = this.now() - RATE_WINDOW_MS;
    s.recent = s.recent.filter((t) => t > cutoff);
    // Auto-close the circuit once it has cooled down.
    if (s.circuitOpenUntil && this.now() >= s.circuitOpenUntil) {
      s.circuitOpenUntil = 0;
      s.consecutiveFailures = 0;
    }
    return s;
  }

  /** Whether a publish is currently allowed for this scope (does not consume quota). */
  check(scopeKey: string): GuardDecision {
    const s = this.state(scopeKey);
    const now = this.now();
    if (s.circuitOpenUntil) {
      return { allowed: false, reason: 'circuit_open', retry_after_seconds: Math.ceil((s.circuitOpenUntil - now) / 1000) };
    }
    if (s.recent.length >= this.ratePerMinute) {
      const oldest = s.recent[0];
      return { allowed: false, reason: 'rate_limited', retry_after_seconds: Math.max(1, Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000)) };
    }
    if (s.dayCount >= this.dailyCap) {
      const tomorrow = Date.parse(`${this.dayKey(now)}T00:00:00.000Z`) + 24 * 60 * 60_000;
      return { allowed: false, reason: 'daily_cap_exceeded', retry_after_seconds: Math.max(1, Math.ceil((tomorrow - now) / 1000)) };
    }
    return { allowed: true };
  }

  /**
   * Consume one unit of daily + rate quota. Called once per PROVIDER ATTEMPT
   * (including retries) so a single logical publish can never exceed the caps by
   * retrying. Must be preceded by an allowed `check`.
   */
  reserve(scopeKey: string): void {
    const s = this.state(scopeKey);
    s.dayCount += 1;
    s.recent.push(this.now());
  }

  /** Record a successful publish: clears the failure streak and closes the circuit. */
  recordSuccess(scopeKey: string): void {
    const s = this.state(scopeKey);
    s.consecutiveFailures = 0;
    s.circuitOpenUntil = 0;
  }

  /** Record a failed publish: trips the circuit once the threshold is reached. */
  recordFailure(scopeKey: string): void {
    const s = this.state(scopeKey);
    s.consecutiveFailures += 1;
    if (s.consecutiveFailures >= this.failureThreshold) {
      s.circuitOpenUntil = this.now() + this.circuitCooldownMs;
    }
  }

  /** Publishes still allowed for this scope today. */
  remainingToday(scopeKey: string): number {
    const s = this.state(scopeKey);
    return Math.max(0, this.dailyCap - s.dayCount);
  }
}
