import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { FunnelStageRepository } from '../../repositories/funnelStageRepository';
import { FUNNEL_STAGES } from '../../domain/funnel';
import type { Knex } from '../../db/knex';

/**
 * Readiness probe (Milestone #10), for monitoring of the deployed pilot surface.
 *
 *   GET /ready → 200 { ok: true,  checks: { db, funnel_stages, funnel_ready } }
 *             → 503 { ok: false, checks: { ... } }   when not deploy-ready
 *
 * Unlike `/health` (a pure liveness probe that says only "the process is up"),
 * readiness verifies the dependencies a request actually needs:
 *   - the database is reachable (the stage count query succeeds), and
 *   - the canonical funnel stages are seeded (`npm run seed` has been run).
 *
 * It is mounted publicly (before auth), like `/health`, so a load balancer or
 * uptime monitor can poll it without a token. DB access goes through the
 * repository, not an ad-hoc query, per the architecture conventions.
 */
export interface ReadinessRouterDeps {
  knex: Knex;
}

export function createReadinessRouter(deps: ReadinessRouterDeps): Router {
  const stages = new FunnelStageRepository(deps.knex);
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      try {
        const present = await stages.count();
        const funnelReady = present === FUNNEL_STAGES.length;
        res.status(funnelReady ? 200 : 503).json({
          ok: funnelReady,
          checks: { db: 'ok', funnel_stages: present, funnel_ready: funnelReady },
        });
      } catch {
        // A failed query means the DB is unreachable — a 503, not a 500.
        res.status(503).json({ ok: false, checks: { db: 'unreachable' } });
      }
    }),
  );

  return router;
}
