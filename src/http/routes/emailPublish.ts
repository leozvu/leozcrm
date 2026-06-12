import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { EmailPublishService, buildEmailPublisherFromEnv } from '../../integrations/email/emailPublishService';
import { EmailFailureReason } from '../../domain/email';
import { enforceClientScope } from '../auth';

/**
 * Explicit email publish endpoint (Milestone #8A).
 *
 *   POST /integrations/email/send
 *   body: { clientId, to, subject, html?, text?, from?, recommendation_code? }
 *
 * Publishing is **explicitly invoked** and tenant-scoped: the caller must be
 * authenticated (middleware) and authorised for `clientId` (`enforceClientScope`).
 * Spend guardrails (daily cap / rate limit / stop-on-failure) and retry/backoff
 * live in `EmailPublishService`. Nothing here sends autonomously.
 *
 * Built by a factory so the publisher can be injected for tests; the default is
 * built from environment configuration.
 */
export interface EmailPublishRouterDeps {
  publisher: EmailPublishService;
}

/** Map a publish failure reason to an HTTP status. */
const STATUS_BY_REASON: Record<EmailFailureReason, number> = {
  not_configured: 503,
  invalid_message: 400,
  daily_cap_exceeded: 429,
  rate_limited: 429,
  circuit_open: 503,
  provider_error: 502,
  timeout: 504,
  network_error: 502,
};

export function createEmailPublishRouter(
  deps: EmailPublishRouterDeps = { publisher: buildEmailPublisherFromEnv() },
): Router {
  const { publisher } = deps;
  const router = Router();

  router.post(
    '/send',
    asyncHandler(async (req, res) => {
      const { clientId, to, subject, html, text, from, recommendation_code } = req.body ?? {};
      if (!clientId || !to || !subject) {
        return res.status(400).json({ error: 'clientId, to, and subject are required', code: 'invalid_message' });
      }
      // Tenant isolation: only send for your own client (admin may send for any).
      if (!enforceClientScope(req, res, clientId)) return;

      const result = await publisher.publish(clientId, { to, subject, html, text, from, recommendation_code });

      if (result.ok) {
        return res.status(200).json(result);
      }

      // Failures are surfaced, not swallowed: log and return a precise status.
      const status = STATUS_BY_REASON[result.reason] ?? 502;
      console.warn(`[email] publish failed for client ${clientId}: ${result.reason} — ${result.detail}`);
      if (result.retry_after_seconds !== undefined) {
        res.set('Retry-After', String(result.retry_after_seconds));
      }
      res.status(status).json({ error: result.detail, code: result.reason, ...result });
    }),
  );

  return router;
}

/** Default router bound to the env-built publisher. */
export const emailPublishRouter = createEmailPublishRouter();
