import { IntegrationAdapter, IntegrationCapability, IntegrationChannel } from '../domain/integration';
import { PlaceholderAdapter } from './placeholderAdapter';
import { ResendEmailAdapter } from './email/resendEmailAdapter';
import { MetaGraphAdapter } from './social/metaGraphAdapter';
import { TikTokContentAdapter } from './social/tiktokAdapter';

/**
 * Concrete channel adapters for the registry.
 *
 * AI media remains a safe **placeholder** no-op (Milestone #6) — it only
 * declares identity/capabilities and inherits the no-op behaviour. The
 * **email** channel is the live `ResendEmailAdapter` (Milestone #8A), the
 * **facebook** and **instagram** channels are the live `MetaGraphAdapter`
 * (Milestone #8B), and **tiktok** is the live `TikTokContentAdapter`
 * (Milestone #8C). Live adapters' actual publishing happens via the separate,
 * guarded publish paths, not through `execute`.
 */

export class AiMediaAdapter extends PlaceholderAdapter {
  readonly channel: IntegrationChannel = 'ai_media';
  readonly displayName = 'AI Media Generation';
  readonly capabilities: readonly IntegrationCapability[] = ['generate_media'];
}

/**
 * Canonical construction order for the registry (single source of truth for
 * which adapters exist). Email + facebook/instagram/tiktok are the live
 * adapters; ai_media remains a placeholder. The registry instances only need
 * metadata/`execute` from the live adapters, so unconfigured instances are fine
 * here — the real publish paths use their own configured adapters via
 * `EmailPublishService` / `SocialPublishService`.
 */
export function createDefaultAdapters(): IntegrationAdapter[] {
  return [
    new MetaGraphAdapter('facebook'),
    new TikTokContentAdapter(),
    new MetaGraphAdapter('instagram'),
    new ResendEmailAdapter(),
    new AiMediaAdapter(),
  ];
}
