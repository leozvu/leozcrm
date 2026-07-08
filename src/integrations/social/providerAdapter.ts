import { SocialChannel, SocialFailureReason, SocialPostMessage, SocialProvider } from '../../domain/social';

/**
 * The seam between `SocialPublishService` (validate → guard → retry/backoff)
 * and a concrete provider edge (Meta Graph, TikTok Content Posting API).
 * One adapter instance serves one channel; the service picks by
 * `post.channel` and never talks to a provider any other way.
 */

/** What a provider edge returns for ONE publish attempt. */
export type SocialPublishAttempt =
  | { kind: 'success'; id: string }
  | { kind: 'retryable'; reason: Extract<SocialFailureReason, 'timeout' | 'network_error' | 'provider_error'>; detail: string }
  | { kind: 'fatal'; reason: Extract<SocialFailureReason, 'provider_error' | 'invalid_message' | 'not_configured'>; detail: string };

export interface SocialProviderAdapter {
  readonly channel: SocialChannel;
  readonly provider: SocialProvider;
  /** Whether this channel is actually wired up (credentials + transport + target). */
  isConfigured(): boolean;
  /** Perform ONE provider attempt (no retry, no guard — the service owns those). */
  publishOnce(post: SocialPostMessage): Promise<SocialPublishAttempt>;
}
