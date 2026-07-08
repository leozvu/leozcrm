import {
  MAX_POST_TEXT_LENGTH,
  PROVIDER_BY_CHANNEL,
  SOCIAL_CHANNELS,
  SocialPostMessage,
  SocialProvider,
  SocialPublishResult,
} from '../../domain/social';
import { isHttpUrl, isOneOf } from '../../domain/validate';
import { MetaGraphAdapter, fetchSocialTransport } from './metaGraphAdapter';
import { TikTokContentAdapter, fetchTikTokTransport } from './tiktokAdapter';
import { SocialProviderAdapter } from './providerAdapter';
import { PublishSpendGuard } from '../spendGuard';

/**
 * Social publish orchestration (Milestone #8B, extended in #8C) — the
 * Facebook/Instagram/TikTok counterpart of `EmailPublishService` (M8A),
 * deliberately structured the same way. The single, explicitly-invoked entry
 * point for posting. It is the only place that ties together:
 *
 *   1. message validation (clean failure, never a provider call on bad input),
 *   2. per-tenant-per-channel spend guardrails (daily cap, rate limit,
 *      stop-on-failure) via the shared `PublishSpendGuard`,
 *   3. the provider edge (`SocialProviderAdapter.publishOnce` — Meta Graph or
 *      TikTok) with retry + exponential backoff on transient failures.
 *
 * It performs NO autonomous posting: callers (the publish route) invoke
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

export interface SocialPublishConfig {
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
  /** Injectable sleep (so tests don't actually wait). */
  sleep?: (ms: number) => Promise<void>;
}

/** The per-channel adapters the service publishes through. */
export interface SocialAdapters {
  facebook: SocialProviderAdapter;
  instagram: SocialProviderAdapter;
  tiktok: SocialProviderAdapter;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Clamp `value` into `[min, max]`, falling back to `fallback` when not finite. */
function clampInt(value: number, min: number, max: number, fallback: number): number {
  const n = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export class SocialPublishService {
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly adapters: SocialAdapters,
    private readonly guard: PublishSpendGuard,
    config: SocialPublishConfig,
  ) {
    // Hard-bound retries so neither env nor injected config can multiply
    // external calls without limit.
    this.maxRetries = clampInt(config.maxRetries, 0, MAX_RETRIES_CEILING, DEFAULT_MAX_RETRIES);
    this.backoffBaseMs = Number.isFinite(config.backoffBaseMs) ? Math.max(0, config.backoffBaseMs) : DEFAULT_BACKOFF_BASE_MS;
    this.backoffMaxMs = config.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    this.sleep = config.sleep ?? defaultSleep;
  }

  /** Whether publishing to the given channel is actually wired up. */
  isConfigured(channel: keyof SocialAdapters): boolean {
    return this.adapters[channel].isConfigured();
  }

  /**
   * Channel-aware validation. Bad input never reaches the provider or the
   * quota. Returns an error string, or `null` when the post is publishable.
   */
  private static validate(post: SocialPostMessage): string | null {
    if (!isOneOf(SOCIAL_CHANNELS, post.channel)) {
      return `"channel" must be one of: ${SOCIAL_CHANNELS.join(', ')}`;
    }
    if (post.message !== undefined && typeof post.message !== 'string') return '"message" must be a string';
    if (hasText(post.message) && post.message.length > MAX_POST_TEXT_LENGTH) {
      return `"message" exceeds the ${MAX_POST_TEXT_LENGTH}-character limit`;
    }
    if (post.channel === 'facebook') {
      if (!hasText(post.message) && !hasText(post.link)) return 'a Facebook post needs "message" and/or "link"';
      if (post.link !== undefined && !isHttpUrl(post.link)) return '"link" must be an absolute http(s) URL';
      if (post.image_url !== undefined) return '"image_url" is not supported for Facebook feed posts';
      if (post.video_url !== undefined) return '"video_url" is not supported for Facebook feed posts';
      return null;
    }
    if (post.channel === 'instagram') {
      if (!isHttpUrl(post.image_url)) return 'an Instagram post needs a publicly-reachable "image_url" (absolute http(s) URL)';
      if (post.link !== undefined) return '"link" is not supported for Instagram posts';
      if (post.video_url !== undefined) return '"video_url" is not supported for Instagram posts (image posts only)';
      return null;
    }
    // tiktok — exactly ONE media source: a video post or a photo post.
    if (post.video_url !== undefined && post.image_url !== undefined) {
      return 'a TikTok post needs exactly one of "video_url" or "image_url", not both';
    }
    if (post.video_url !== undefined) {
      if (!isHttpUrl(post.video_url)) return '"video_url" must be a publicly-reachable absolute http(s) URL';
    } else if (!isHttpUrl(post.image_url)) {
      return 'a TikTok post needs a publicly-reachable "video_url" or "image_url" (absolute http(s) URL)';
    }
    if (post.link !== undefined) return '"link" is not supported for TikTok posts';
    return null;
  }

  async publish(clientId: string, post: SocialPostMessage): Promise<SocialPublishResult> {
    const channel = post.channel;
    // For an unknown channel (rejected below) there is no adapter to name a
    // provider — fall back to meta_graph purely so the failure envelope is typed.
    const provider: SocialProvider = PROVIDER_BY_CHANNEL[channel] ?? 'meta_graph';
    const fail = (reason: any, detail: string, attempts: number, retry_after_seconds?: number): SocialPublishResult => ({
      ok: false, provider, channel, client_id: clientId, reason, detail, attempts, retry_after_seconds,
    });

    // 1. Validate the post — bad input never reaches the provider or quota.
    const invalid = SocialPublishService.validate(post);
    if (invalid) return fail('invalid_message', invalid, 0);

    // 2. Not wired up (missing token/transport or channel target id) →
    //    explicit, non-silent 503-class failure, before any provider call.
    const adapter = this.adapters[channel];
    if (!adapter.isConfigured()) {
      const hint = channel === 'tiktok' ? 'set TIKTOK_ACCESS_TOKEN' : 'set META_ACCESS_TOKEN and the channel target id';
      return fail('not_configured', `${channel} publishing is not configured (${hint})`, 0);
    }

    // 3. Attempt with retry + bounded exponential backoff. The spend/rate/circuit
    //    guard is checked and one unit reserved BEFORE EVERY provider attempt, so
    //    retries can never exceed the daily cap, rate limit, or circuit breaker.
    //    The guard scope is tenant+channel, so Facebook and Instagram budgets are
    //    independent and one tenant can never spend another's.
    const scope = `${clientId}|${channel}`;
    let providerAttempts = 0;
    let lastDetail = '';
    let lastReason: any = 'provider_error';
    for (let i = 0; i <= this.maxRetries; i++) {
      const decision = this.guard.check(scope);
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
      this.guard.reserve(scope);
      providerAttempts++;

      const result = await adapter.publishOnce(post);
      if (result.kind === 'success') {
        this.guard.recordSuccess(scope);
        return {
          ok: true, provider: adapter.provider, channel, id: result.id, client_id: clientId,
          attempts: providerAttempts, remaining_today: this.guard.remainingToday(scope),
        };
      }

      // Record EVERY failed provider attempt toward the circuit breaker.
      this.guard.recordFailure(scope);
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
 * Build the process-wide social publisher from environment configuration. When
 * a channel's credentials are unset (`META_ACCESS_TOKEN` + target id for
 * Facebook/Instagram; `TIKTOK_ACCESS_TOKEN` for TikTok) that channel is
 * "unconfigured" and the service returns a `not_configured` failure rather than
 * throwing — so the route mounts either way and the failure is explicit.
 */
export function buildSocialPublisherFromEnv(): SocialPublishService {
  const shared = {
    accessToken: process.env.META_ACCESS_TOKEN,
    facebookPageId: process.env.META_FACEBOOK_PAGE_ID,
    instagramUserId: process.env.META_INSTAGRAM_USER_ID,
    transport: process.env.META_ACCESS_TOKEN ? fetchSocialTransport : undefined,
    timeoutMs: numberEnv('SOCIAL_TIMEOUT_MS', 10_000),
    graphVersion: process.env.META_GRAPH_VERSION,
  };
  const adapters: SocialAdapters = {
    facebook: new MetaGraphAdapter('facebook', shared),
    instagram: new MetaGraphAdapter('instagram', shared),
    tiktok: new TikTokContentAdapter({
      accessToken: process.env.TIKTOK_ACCESS_TOKEN,
      transport: process.env.TIKTOK_ACCESS_TOKEN ? fetchTikTokTransport : undefined,
      timeoutMs: numberEnv('SOCIAL_TIMEOUT_MS', 10_000),
      privacyLevel: process.env.TIKTOK_PRIVACY_LEVEL,
    }),
  };
  const guard = new PublishSpendGuard({
    dailyCap: numberEnv('SOCIAL_DAILY_CAP', 25),
    ratePerMinute: numberEnv('SOCIAL_RATE_PER_MINUTE', 5),
    failureThreshold: numberEnv('SOCIAL_FAILURE_THRESHOLD', 5),
  });
  return new SocialPublishService(adapters, guard, {
    // Clamped to [0, MAX_RETRIES_CEILING] inside the service.
    maxRetries: numberEnv('SOCIAL_MAX_RETRIES', DEFAULT_MAX_RETRIES),
    backoffBaseMs: numberEnv('SOCIAL_BACKOFF_MS', DEFAULT_BACKOFF_BASE_MS),
    backoffMaxMs: numberEnv('SOCIAL_BACKOFF_MAX_MS', DEFAULT_BACKOFF_MAX_MS),
  });
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
