import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { SocialPublishService, buildSocialPublisherFromEnv } from '../../integrations/social/socialPublishService';
import { SocialFailureReason } from '../../domain/social';
import { enforceClientScope } from '../auth';

/**
 * Explicit social publish endpoint (Milestone #8B, extended in #8C).
 *
 *   POST /integrations/social/publish
 *   body: { clientId, channel: 'facebook' | 'instagram' | 'tiktok',
 *           message?, link?, image_url?, video_url?, recommendation_code? }
 *
 * Publishing is **explicitly invoked** and tenant-scoped: the caller must be
 * authenticated (middleware) and authorised for `clientId` (`enforceClientScope`).
 * Spend guardrails (daily cap / rate limit / stop-on-failure, per tenant per
 * channel) and retry/backoff live in `SocialPublishService`. Nothing here posts
 * autonomously.
 *
 * Built by a factory so the publisher can be injected for tests; the default is
 * built from environment configuration.
 */
export interface SocialPublishRouterDeps {
  publisher: SocialPublishService;
}

/** Map a publish failure reason to an HTTP status (same mapping as email, M8A). */
const STATUS_BY_REASON: Record<SocialFailureReason, number> = {
  not_configured: 503,
  invalid_message: 400,
  daily_cap_exceeded: 429,
  rate_limited: 429,
  circuit_open: 503,
  provider_error: 502,
  timeout: 504,
  network_error: 502,
};

export function createSocialPublishRouter(
  deps: SocialPublishRouterDeps = { publisher: buildSocialPublisherFromEnv() },
): Router {
  const { publisher } = deps;
  const router = Router();

  router.post(
    '/publish',
    asyncHandler(async (req, res) => {
      const { clientId, channel, message, link, image_url, video_url, recommendation_code } = req.body ?? {};
      if (!clientId || !channel) {
        return res.status(400).json({ error: 'clientId and channel are required', code: 'invalid_message' });
      }
      // Tenant isolation: only publish for your own client (admin may publish for any).
      if (!enforceClientScope(req, res, clientId)) return;

      const result = await publisher.publish(clientId, { channel, message, link, image_url, video_url, recommendation_code });

      if (result.ok) {
        return res.status(200).json(result);
      }

      // Failures are surfaced, not swallowed: log and return a precise status.
      const status = STATUS_BY_REASON[result.reason] ?? 502;
      console.warn(`[social] ${result.channel} publish failed for client ${clientId}: ${result.reason} — ${result.detail}`);
      if (result.retry_after_seconds !== undefined) {
        res.set('Retry-After', String(result.retry_after_seconds));
      }
      res.status(status).json({ error: result.detail, code: result.reason, ...result });
    }),
  );

  return router;
}

/** Default router bound to the env-built publisher. */
export const socialPublishRouter = createSocialPublishRouter();
