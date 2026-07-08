import {
  IntegrationAdapter,
  IntegrationActionRequest,
  IntegrationActionResult,
  IntegrationAdapterInfo,
  IntegrationCapability,
  IntegrationChannel,
  IntegrationMode,
} from '../../domain/integration';
import { SocialPostMessage, SocialProvider } from '../../domain/social';
import { SocialProviderAdapter, SocialPublishAttempt } from './providerAdapter';
import { ValidationError } from '../../errors';

/**
 * Live TikTok adapter backed by the Content Posting API v2 (Milestone #8C).
 *
 * Same shape as the Meta adapter (M8B): it fits the `IntegrationAdapter`
 * boundary (metadata + a no-op `execute` ack — `execute` NEVER posts) and adds
 * an async, single-attempt `publishOnce` that performs the real provider call
 * with a timeout. Retry/backoff and spend guardrails live one level up in
 * `SocialPublishService`; this class is only the provider edge.
 *
 * TikTok specifics:
 *   - Media is PULLED by TikTok from a public URL (`source: 'PULL_FROM_URL'`)
 *     — the app never uploads bytes. A video post inits at
 *     `/v2/post/publish/video/init/`; a photo post at
 *     `/v2/post/publish/content/init/`.
 *   - A successful init returns a `publish_id`; TikTok finishes processing
 *     asynchronously (trackable via its status API). The publish_id is the
 *     post id this adapter reports.
 *   - `privacy_level` defaults to `SELF_ONLY` — the safest launch posture: a
 *     freshly published post is visible only to the account until an operator
 *     widens it (or configures TIKTOK_PRIVACY_LEVEL).
 *
 * Provider calls go through an injected `TikTokTransport`, so tests drive a
 * sandbox transport and no real network is touched. The default transport uses
 * the built-in `fetch` (no new dependency, no SDK). The access token travels
 * in the Authorization header — never in the URL.
 */

const DEFAULT_TIKTOK_BASE = 'https://open.tiktokapis.com';
const DEFAULT_PRIVACY_LEVEL = 'SELF_ONLY';

export interface TikTokTransportRequest {
  /** Full Content Posting API endpoint URL (never contains the token). */
  url: string;
  /** Bearer token for the Authorization header. */
  accessToken: string;
  /** JSON request body. */
  body: Record<string, unknown>;
  signal: AbortSignal;
}

export interface TikTokTransportResponse {
  /** HTTP status returned by the provider. */
  status: number;
  /** Parsed JSON body (`{ data: { publish_id }, error: { code, message } }`). */
  body: any;
}

/** Pluggable provider transport. The default calls TikTok via `fetch`. */
export type TikTokTransport = (req: TikTokTransportRequest) => Promise<TikTokTransportResponse>;

/** Default transport: a real TikTok call over `fetch` (JSON POST + Bearer auth). */
export const fetchTikTokTransport: TikTokTransport = async (req) => {
  const res = await fetch(req.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${req.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(req.body),
    signal: req.signal,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
};

export interface TikTokConfig {
  /** TikTok user access token with the video.publish scope. */
  accessToken?: string;
  transport?: TikTokTransport;
  /** Per-attempt timeout in ms (default 10s). */
  timeoutMs?: number;
  /** Provider base URL (override for sandbox/self-host). */
  baseUrl?: string;
  /** Post visibility (default SELF_ONLY — private until an operator widens it). */
  privacyLevel?: string;
}

/** TikTok error codes that a retry can plausibly fix. */
const RETRYABLE_TIKTOK_CODES = new Set(['rate_limit_exceeded', 'internal_error', 'service_unavailable']);
/** TikTok error codes where the request itself is at fault (never retry). */
const INVALID_MESSAGE_TIKTOK_CODES = new Set(['invalid_params', 'invalid_param', 'url_ownership_unverified']);

export class TikTokContentAdapter implements IntegrationAdapter, SocialProviderAdapter {
  readonly channel: IntegrationChannel & 'tiktok' = 'tiktok';
  readonly provider: SocialProvider = 'tiktok';
  readonly displayName = 'TikTok (Content Posting API)';
  readonly capabilities: readonly IntegrationCapability[] = ['publish_post'];
  readonly mode: IntegrationMode = 'live';

  private readonly accessToken?: string;
  private readonly transport?: TikTokTransport;
  private readonly timeoutMs: number;
  private readonly base: string;
  private readonly privacyLevel: string;

  constructor(config: TikTokConfig = {}) {
    this.accessToken = config.accessToken;
    this.transport = config.transport;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.base = (config.baseUrl ?? DEFAULT_TIKTOK_BASE).replace(/\/+$/, '');
    this.privacyLevel = config.privacyLevel ?? DEFAULT_PRIVACY_LEVEL;
  }

  isConfigured(): boolean {
    return Boolean(this.accessToken && this.transport);
  }

  info(): IntegrationAdapterInfo {
    return {
      channel: this.channel,
      display_name: this.displayName,
      capabilities: [...this.capabilities],
      mode: this.mode,
      // Live, but only via the explicit publish path — never autonomous.
      advisory_only: false,
    };
  }

  supports(capability: IntegrationCapability): boolean {
    return this.capabilities.includes(capability);
  }

  /**
   * No-op acknowledgement, exactly like the placeholder adapters: `execute`
   * never posts. Real publishing is `publishOnce`, reached only via the guarded,
   * explicitly-invoked publish service.
   */
  execute(request: IntegrationActionRequest): IntegrationActionResult {
    if (!this.supports(request.capability)) {
      throw new ValidationError(
        400,
        `${this.displayName} adapter does not support capability "${request.capability}"`,
        'unsupported_capability',
      );
    }
    return {
      channel: this.channel,
      capability: request.capability,
      mode: this.mode,
      performed: false,
      no_op: true,
      detail: `${this.displayName} is live, but publishing is performed only via the explicit POST /integrations/social/publish endpoint — execute() never posts.`,
      request: { capability: request.capability, payload_keys: Object.keys(request.payload ?? {}) },
    };
  }

  /**
   * Perform ONE provider attempt with a timeout. A video post inits the video
   * endpoint; a photo post inits the content endpoint in DIRECT_POST mode.
   * The publish service has already validated that exactly one media URL is
   * present. Classification mirrors the Meta adapter: success / retryable /
   * fatal — the guard and retry loop live in the service.
   */
  async publishOnce(post: SocialPostMessage): Promise<SocialPublishAttempt> {
    if (!this.accessToken || !this.transport) {
      return { kind: 'fatal', reason: 'not_configured', detail: 'TikTok access token/transport not configured' };
    }

    const title = post.message ?? '';
    let url: string;
    let body: Record<string, unknown>;
    if (post.video_url !== undefined) {
      url = `${this.base}/v2/post/publish/video/init/`;
      body = {
        post_info: { title, privacy_level: this.privacyLevel },
        source_info: { source: 'PULL_FROM_URL', video_url: post.video_url },
      };
    } else {
      url = `${this.base}/v2/post/publish/content/init/`;
      body = {
        media_type: 'PHOTO',
        post_mode: 'DIRECT_POST',
        post_info: { title, description: title, privacy_level: this.privacyLevel },
        source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: [post.image_url] },
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.transport({ url, accessToken: this.accessToken, body, signal: controller.signal });

      const errCode: string | undefined = typeof res.body?.error?.code === 'string' ? res.body.error.code : undefined;
      const errOk = errCode === undefined || errCode === 'ok';
      const publishId = typeof res.body?.data?.publish_id === 'string' ? res.body.data.publish_id : '';

      if (res.status >= 200 && res.status < 300 && errOk) {
        if (!publishId) {
          return { kind: 'retryable', reason: 'provider_error', detail: 'provider returned 2xx without a publish_id' };
        }
        return { kind: 'success', id: publishId };
      }

      const detail = typeof res.body?.error?.message === 'string' ? res.body.error.message : `provider responded ${res.status}`;

      // Throttling / transient provider trouble → worth backing off and retrying.
      if (res.status === 429 || res.status >= 500 || (errCode !== undefined && RETRYABLE_TIKTOK_CODES.has(errCode))) {
        return { kind: 'retryable', reason: 'provider_error', detail };
      }
      // The request itself is at fault (bad params / unverified pull URL) → the
      // caller's message is the problem; retrying will not fix it.
      if (errCode !== undefined && INVALID_MESSAGE_TIKTOK_CODES.has(errCode)) {
        return { kind: 'fatal', reason: 'invalid_message', detail };
      }
      // Everything else in a 4xx (dead token, missing scope, spam_risk_* caps)
      // is fatal: no retry storm against a request the provider has refused.
      return { kind: 'fatal', reason: 'provider_error', detail };
    } catch (err: any) {
      // Abort (timeout) vs any other transport failure (network).
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        return { kind: 'retryable', reason: 'timeout', detail: `no response within ${this.timeoutMs}ms` };
      }
      return { kind: 'retryable', reason: 'network_error', detail: err?.message ?? 'transport error' };
    } finally {
      clearTimeout(timer);
    }
  }
}
