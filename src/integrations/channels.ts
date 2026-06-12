import { IntegrationAdapter, IntegrationCapability, IntegrationChannel } from '../domain/integration';
import { PlaceholderAdapter } from './placeholderAdapter';
import { ResendEmailAdapter } from './email/resendEmailAdapter';

/**
 * Concrete channel adapters for the registry.
 *
 * Social (Facebook / TikTok / Instagram) and AI media remain safe **placeholder**
 * no-ops (Milestone #6) — they only declare identity/capabilities and inherit the
 * no-op behaviour. The **email** channel is, as of Milestone #8A, the live
 * `ResendEmailAdapter` (its actual sending happens via the separate, guarded
 * publish path, not through `execute`).
 */

export class FacebookAdapter extends PlaceholderAdapter {
  readonly channel: IntegrationChannel = 'facebook';
  readonly displayName = 'Facebook';
  readonly capabilities: readonly IntegrationCapability[] = ['publish_post'];
}

export class TikTokAdapter extends PlaceholderAdapter {
  readonly channel: IntegrationChannel = 'tiktok';
  readonly displayName = 'TikTok';
  readonly capabilities: readonly IntegrationCapability[] = ['publish_post'];
}

export class InstagramAdapter extends PlaceholderAdapter {
  readonly channel: IntegrationChannel = 'instagram';
  readonly displayName = 'Instagram';
  readonly capabilities: readonly IntegrationCapability[] = ['publish_post'];
}

export class AiMediaAdapter extends PlaceholderAdapter {
  readonly channel: IntegrationChannel = 'ai_media';
  readonly displayName = 'AI Media Generation';
  readonly capabilities: readonly IntegrationCapability[] = ['generate_media'];
}

/**
 * Canonical construction order for the registry (single source of truth for
 * which adapters exist). The email entry is the live Resend adapter; the others
 * remain placeholders. The registry instance only needs metadata/`execute` from
 * the email adapter, so an unconfigured instance is fine here — the real send
 * path uses its own configured adapter via `EmailPublishService`.
 */
export function createDefaultAdapters(): IntegrationAdapter[] {
  return [
    new FacebookAdapter(),
    new TikTokAdapter(),
    new InstagramAdapter(),
    new ResendEmailAdapter(),
    new AiMediaAdapter(),
  ];
}
