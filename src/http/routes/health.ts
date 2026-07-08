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
 *   - the database is reachable (the stage query succeeds), and
 *   - the CANONICAL funnel stages are seeded (`npm run seed` has been run):
 *     every canonical key is present at its canonical position, not merely
 *     "some nine rows exist" (Codex M10 review: a drifted table must not pass).
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
        const rows = await stages.listOrdered();
        const byKey = new Map(rows.map((s) => [s.key, s]));
        // Canonical means: exact count, and every canonical key present at its
        // canonical position. Nine drifted/renamed rows must NOT read as ready.
        const canonical =
          rows.length === FUNNEL_STAGES.length &&
          FUNNEL_STAGES.every((def) => byKey.get(def.key)?.position === def.position);
        res.status(canonical ? 200 : 503).json({
          ok: canonical,
          checks: { db: 'ok', funnel_stages: rows.length, funnel_ready: canonical },
        });
      } catch {
        // A failed query means the DB is unreachable — a 503, not a 500.
        res.status(503).json({ ok: false, checks: { db: 'unreachable' } });
      }
    }),
  );

  return router;
}
