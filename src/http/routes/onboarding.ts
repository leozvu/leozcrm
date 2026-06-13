import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { OnboardingService, onboardingService } from '../../services/onboardingService';
import { requireAdmin, signClientToken } from '../auth';

/**
 * Client onboarding route (Milestone #10): the operator surface that provisions
 * a new tenant for the MVP launch.
 *
 *   POST /onboarding   { name, email, company?, notes? }
 *     → 201 { client, api_token, readiness }
 *
 * Onboarding a tenant crosses the tenant boundary (it creates a new client), so
 * it is **admin only** — the same rule as `POST /clients`. The per-client
 * `api_token` is minted here at the http boundary from the same signing secret
 * the auth middleware verifies against; the service stays http-free.
 *
 * Built by a factory so the service + secret can be injected for tests; the
 * default binds to the singleton service and the environment secret.
 */
export interface OnboardingRouterDeps {
  onboarding: OnboardingService;
  /** Signing secret used to mint the tenant's bearer token. */
  secret: string;
}

export function createOnboardingRouter(
  deps: OnboardingRouterDeps = { onboarding: onboardingService, secret: process.env.AUTH_SECRET ?? '' },
): Router {
  const { onboarding, secret } = deps;
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      if (!requireAdmin(req, res)) return;
      // A tenant token is unusable if the server has no signing secret — surface
      // that as a clear 503 rather than issuing a token nothing can verify.
      if (!secret) {
        return res.status(503).json({
          error: 'onboarding unavailable: AUTH_SECRET is not configured',
          code: 'not_configured',
        });
      }
      const { name, email, company, notes } = req.body ?? {};
      const { client, readiness } = await onboarding.onboard({ name, email, company, notes });
      const api_token = signClientToken(client.id, secret);
      res.status(201).json({ client, api_token, readiness });
    }),
  );

  return router;
}

/** Default router bound to the singleton service + environment secret. */
export const onboardingRouter = createOnboardingRouter();
