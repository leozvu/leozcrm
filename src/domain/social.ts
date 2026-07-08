/**
 * Social publishing contract (Milestone #8B).
 *
 * The second real, `'live'` integration family: publishing posts to Facebook
 * Pages and Instagram Business accounts through the Meta Graph API. Like email
 * (M8A) it is **explicitly invoked** — an operator (or a tenant) calls the
 * publish endpoint; nothing here posts autonomously, and recommendations may
 * only *reference* a publish (via `recommendation_code`), never trigger one.
 *
 * Pure types only — no I/O. The publish path, spend guardrails, and provider
 * client live under `src/integrations/social/`.
 */

/** Channels the live social publish path supports. TikTok stays placeholder (M8C). */
export type SocialChannel = 'facebook' | 'instagram';

export const SOCIAL_CHANNELS: readonly SocialChannel[] = ['facebook', 'instagram'];

/** Instagram's documented caption ceiling; also applied to Facebook messages. */
export const MAX_POST_TEXT_LENGTH = 2200;

/**
 * A single outbound social post. Channel-specific requirements:
 *
 *   - `facebook`  — needs `message` and/or `link` (a Page feed post).
 *   - `instagram` — needs a publicly-reachable `image_url` (the Graph API
 *     fetches it); `message` becomes the caption and `link` is not supported.
 */
export interface SocialPostMessage {
  channel: SocialChannel;
  /** Post body (Facebook) / caption (Instagram). */
  message?: string;
  /** Link to attach (Facebook feed posts only). */
  link?: string;
  /** Publicly-reachable image URL (required for Instagram). */
  image_url?: string;
  /**
   * Optional traceability: the recommendation code that prompted this publish.
   * Recording it links an explicit publish back to the advice that suggested it
   * — it does NOT cause the publish (which is always operator-invoked).
   */
  recommendation_code?: string;
}

/** Why a publish did not (successfully) happen. */
export type SocialFailureReason =
  | 'not_configured' // no Meta access token / page or IG account id configured
  | 'invalid_message' // missing/invalid channel, text, link, or image URL
  | 'daily_cap_exceeded' // per-tenant/channel daily publish cap hit
  | 'rate_limited' // per-tenant/channel rate limit hit
  | 'circuit_open' // stop-on-failure threshold tripped
  | 'provider_error' // the Graph API returned an error (or non-2xx) after retries
  | 'timeout' // request exceeded the timeout after retries
  | 'network_error'; // transport failed to reach the provider after retries

export interface SocialPublishSuccess {
  ok: true;
  provider: 'meta_graph';
  channel: SocialChannel;
  /** Provider post id (Facebook post id / Instagram media id). */
  id: string;
  client_id: string;
  /** Number of provider attempts made (1 = no retry needed). */
  attempts: number;
  /** Remaining publishes allowed for this tenant+channel today (after this one). */
  remaining_today: number;
}

export interface SocialPublishFailure {
  ok: false;
  provider: 'meta_graph';
  channel: SocialChannel;
  client_id: string;
  reason: SocialFailureReason;
  detail: string;
  /** Provider attempts made before giving up (0 when blocked before publishing). */
  attempts: number;
  /** Suggested wait before retrying, when the failure is a cap/rate/circuit limit. */
  retry_after_seconds?: number;
}

export type SocialPublishResult = SocialPublishSuccess | SocialPublishFailure;
