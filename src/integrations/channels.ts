import { IntegrationAdapter, IntegrationCapability, IntegrationChannel } from '../domain/integration';
import { PlaceholderAdapter } from './placeholderAdapter';
import { ResendEmailAdapter } from './email/resendEmailAdapter';
import { MetaGraphAdapter } from './social/metaGraphAdapter';

/**
 * Concrete channel adapters for the registry.
 *
 * TikTok and AI media remain safe **placeholder** no-ops (Milestone #6) — they
 * only declare identity/capabilities and inherit the no-op behaviour. The
 * **email** channel is the live `ResendEmailAdapter` (Milestone #8A) and the
 * **facebook** and **instagram** channels are, as of Milestone #8B, the live
 * `MetaGraphAdapter` (their actual posting happens via the separate, guarded
 * publish path, not through `execute`).
 */

export class TikTokAdapter extends PlaceholderAdapter {
  readonly channel: IntegrationChannel = 'tiktok';
  readonly displayName = 'TikTok';
  readonly capabilities: readonly IntegrationCapability[] = ['publish_post'];
}

export class AiMediaAdapter extends PlaceholderAdapter {
  readonly channel: IntegrationChannel = 'ai_media';
  readonly displayName = 'AI Media Generation';
  readonly capabilities: readonly IntegrationCapability[] = ['generate_media'];
}

/**
 * Canonical construction order for the registry (single source of truth for
 * which adapters exist). Email + facebook/instagram are the live adapters;
 * tiktok/ai_media remain placeholders. The registry instances only need
 * metadata/`execute` from the live adapters, so unconfigured instances are fine
 * here — the real publish paths use their own configured adapters via
 * `EmailPublishService` / `SocialPublishService`.
 */
export function createDefaultAdapters(): IntegrationAdapter[] {
  return [
    new MetaGraphAdapter('facebook'),
    new TikTokAdapter(),
    new MetaGraphAdapter('instagram'),
    new ResendEmailAdapter(),
    new AiMediaAdapter(),
  ];
}
