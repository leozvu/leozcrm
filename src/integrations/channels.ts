import { IntegrationCapability, IntegrationChannel } from '../domain/integration';
import { PlaceholderAdapter } from './placeholderAdapter';

/**
 * Concrete placeholder adapters, one per future channel (Milestone #6). Each is
 * a trivial specialisation of `PlaceholderAdapter` — it only declares identity
 * and capabilities; the no-op behaviour is inherited. These are the seam where
 * real Facebook/TikTok/Instagram/email/AI-media connectors plug in later (M8),
 * but today they perform no external action.
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

export class EmailAdapter extends PlaceholderAdapter {
  readonly channel: IntegrationChannel = 'email';
  readonly displayName = 'Email';
  readonly capabilities: readonly IntegrationCapability[] = ['send_email'];
}

export class AiMediaAdapter extends PlaceholderAdapter {
  readonly channel: IntegrationChannel = 'ai_media';
  readonly displayName = 'AI Media Generation';
  readonly capabilities: readonly IntegrationCapability[] = ['generate_media'];
}

/**
 * Canonical construction order for the registry. New placeholder channels are
 * added here (and nowhere else) so the registry stays the single source of
 * truth for which adapters exist.
 */
export function createPlaceholderAdapters(): PlaceholderAdapter[] {
  return [
    new FacebookAdapter(),
    new TikTokAdapter(),
    new InstagramAdapter(),
    new EmailAdapter(),
    new AiMediaAdapter(),
  ];
}
