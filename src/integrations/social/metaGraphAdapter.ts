import {
  IntegrationAdapter,
  IntegrationActionRequest,
  IntegrationActionResult,
  IntegrationAdapterInfo,
  IntegrationCapability,
  IntegrationChannel,
  IntegrationMode,
} from '../../domain/integration';
import { SocialChannel, SocialFailureReason, SocialPostMessage } from '../../domain/social';
import { ValidationError } from '../../errors';

/**
 * Live social adapter backed by the Meta Graph API (Milestone #8B) — one
 * instance per channel (`facebook` page posts / `instagram` business media).
 *
 * It fits the existing `IntegrationAdapter` boundary (metadata + a no-op
 * `execute` ack — `execute` NEVER posts), and adds an async, single-attempt
 * `publishOnce` that performs the real provider call(s) with a timeout.
 * Retry/backoff and spend guardrails live one level up in
 * `SocialPublishService`; this class is only the provider edge.
 *
 * Provider calls go through an injected `SocialTransport`, so tests drive a
 * sandbox transport and no real network is touched. The default transport uses
 * the built-in `fetch` (no new dependency, no Meta SDK). The access token is
 * sent as a form field in the request BODY — never in the URL — so it cannot
 * leak into request logs.
 */

const DEFAULT_GRAPH_BASE = 'https://graph.facebook.com';
const DEFAULT_GRAPH_VERSION = 'v23.0';

/** What the provider edge returns for one attempt. */
export type MetaGraphAttempt =
  | { kind: 'success'; id: string }
  | { kind: 'retryable'; reason: Extract<SocialFailureReason, 'timeout' | 'network_error' | 'provider_error'>; detail: string }
  | { kind: 'fatal'; reason: Extract<SocialFailureReason, 'provider_error' | 'invalid_message' | 'not_configured'>; detail: string };

export interface SocialTransportRequest {
  /** Full Graph endpoint URL (never contains the token). */
  url: string;
  /** Form fields for the POST body — includes `access_token`. */
  params: Record<string, string>;
  signal: AbortSignal;
}

export interface SocialTransportResponse {
  /** HTTP status returned by the provider. */
  status: number;
  /** Parsed JSON body (e.g. `{ id }` on success, `{ error: {...} }` on error). */
  body: any;
}

/** Pluggable provider transport. The default calls the Graph API via `fetch`. */
export type SocialTransport = (req: SocialTransportRequest) => Promise<SocialTransportResponse>;

/** Default transport: a real Graph API call over `fetch` (form-encoded POST). */
export const fetchSocialTransport: SocialTransport = async (req) => {
  const res = await fetch(req.url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(req.params).toString(),
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

export interface MetaGraphConfig {
  /** Meta access token (a Page token covers both the Page and its linked IG account). */
  accessToken?: string;
  /** Facebook Page id — target of `facebook` publishes. */
  facebookPageId?: string;
  /** Instagram Business account (IG user) id — target of `instagram` publishes. */
  instagramUserId?: string;
  transport?: SocialTransport;
  /** Per-HTTP-call timeout in ms (default 10s). */
  timeoutMs?: number;
  /** Graph API version segment (default v23.0). */
  graphVersion?: string;
  /** Provider base URL (override for sandbox/self-host). */
  baseUrl?: string;
}

/**
 * Graph error codes that are worth retrying: 1/2 (transient), 4/17/32/613
 * (rate/throttling). Anything else in a 4xx is treated as fatal.
 */
const RETRYABLE_GRAPH_CODES = new Set([1, 2, 4, 17, 32, 613]);

export class MetaGraphAdapter implements IntegrationAdapter {
  readonly channel: IntegrationChannel;
  readonly displayName: string;
  readonly capabilities: readonly IntegrationCapability[] = ['publish_post'];
  readonly mode: IntegrationMode = 'live';

  private readonly accessToken?: string;
  private readonly facebookPageId?: string;
  private readonly instagramUserId?: string;
  private readonly transport?: SocialTransport;
  private readonly timeoutMs: number;
  private readonly base: string;

  constructor(channel: SocialChannel, config: MetaGraphConfig = {}) {
    this.channel = channel;
    this.displayName = channel === 'facebook' ? 'Facebook (Meta Graph)' : 'Instagram (Meta Graph)';
    this.accessToken = config.accessToken;
    this.facebookPageId = config.facebookPageId;
    this.instagramUserId = config.instagramUserId;
    this.transport = config.transport;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    const baseUrl = (config.baseUrl ?? DEFAULT_GRAPH_BASE).replace(/\/+$/, '');
    this.base = `${baseUrl}/${config.graphVersion ?? DEFAULT_GRAPH_VERSION}`;
  }

  /** The publish target id for this adapter's channel, when configured. */
  private targetId(): string | undefined {
    return this.channel === 'facebook' ? this.facebookPageId : this.instagramUserId;
  }

  /**
   * Configured to actually publish: requires an access token, a transport, AND
   * the target id for this channel (Page id / IG user id). Missing any of them
   * makes the adapter report "not configured" so the publish boundary refuses
   * before any provider call.
   */
  isConfigured(): boolean {
    return Boolean(this.accessToken && this.transport && this.targetId());
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
   * Perform ONE provider attempt with a per-call timeout. Facebook is a single
   * `POST /{page-id}/feed`; Instagram is the documented two-step container flow
   * (`POST /{ig-user-id}/media` then `POST /{ig-user-id}/media_publish`).
   * Classifies the outcome as success, retryable (caller may back off and
   * retry), or fatal (stop). Does not touch the spend guard or retry — that is
   * the publish service's job.
   *
   * Note on Instagram retries: if container creation succeeds but the publish
   * step fails transiently, a retry re-creates the container. Unpublished
   * containers are inert (Meta expires them); no duplicate post can result.
   */
  async publishOnce(post: SocialPostMessage): Promise<MetaGraphAttempt> {
    if (!this.accessToken || !this.transport) {
      return { kind: 'fatal', reason: 'not_configured', detail: 'Meta access token/transport not configured' };
    }
    const target = this.targetId();
    if (!target) {
      const envVar = this.channel === 'facebook' ? 'META_FACEBOOK_PAGE_ID' : 'META_INSTAGRAM_USER_ID';
      return { kind: 'fatal', reason: 'not_configured', detail: `no ${this.channel} target configured (set ${envVar})` };
    }

    if (this.channel === 'facebook') {
      const params: Record<string, string> = { access_token: this.accessToken };
      if (post.message !== undefined) params.message = post.message;
      if (post.link !== undefined) params.link = post.link;
      return this.callOnce(`${this.base}/${target}/feed`, params);
    }

    // Instagram: 1) create a media container from the public image URL...
    const createParams: Record<string, string> = {
      access_token: this.accessToken,
      image_url: post.image_url as string,
    };
    if (post.message !== undefined) createParams.caption = post.message;
    const created = await this.callOnce(`${this.base}/${target}/media`, createParams);
    if (created.kind !== 'success') return created;

    // ...then 2) publish the container.
    return this.callOnce(`${this.base}/${target}/media_publish`, {
      access_token: this.accessToken,
      creation_id: created.id,
    });
  }

  /** One HTTP call to the Graph API with timeout + outcome classification. */
  private async callOnce(url: string, params: Record<string, string>): Promise<MetaGraphAttempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.transport!({ url, params, signal: controller.signal });

      if (res.status >= 200 && res.status < 300) {
        const id = typeof res.body?.id === 'string' ? res.body.id : '';
        if (!id) {
          return { kind: 'retryable', reason: 'provider_error', detail: 'provider returned 2xx without a post id' };
        }
        return { kind: 'success', id };
      }

      const err = res.body?.error;
      const code = typeof err?.code === 'number' ? err.code : undefined;
      const detail = typeof err?.message === 'string' ? err.message : `provider responded ${res.status}`;

      // Throttling / transient provider trouble → worth backing off and retrying.
      if (res.status === 429 || res.status >= 500 || err?.is_transient === true || (code !== undefined && RETRYABLE_GRAPH_CODES.has(code))) {
        return { kind: 'retryable', reason: 'provider_error', detail };
      }
      // Other 4xx: a bad request that retrying will not fix. Graph code 100 is
      // "invalid parameter" — the message itself is at fault.
      const reason: 'invalid_message' | 'provider_error' = code === 100 ? 'invalid_message' : 'provider_error';
      return { kind: 'fatal', reason, detail };
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
