import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { FunnelStageRepository, funnelStageRepository } from '../../repositories/funnelStageRepository';

/**
 * Funnel stages are reference data seeded from src/domain/funnel.ts.
 * Read-only over HTTP in this foundation (no create/delete) so the canonical
 * funnel cannot be corrupted by accident.
 *
 * Built by a factory so the repository can be injected for tests; the default
 * binds to the process-wide singleton.
 */
export interface FunnelStagesRouterDeps {
  stages: FunnelStageRepository;
}

export function createFunnelStagesRouter(
  deps: FunnelStagesRouterDeps = { stages: funnelStageRepository },
): Router {
  const { stages } = deps;
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await stages.listOrdered());
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const stage = await stages.findById(req.params.id);
      if (!stage) return res.status(404).json({ error: 'funnel stage not found' });
      res.json(stage);
    }),
  );

  return router;
}

/** Default router bound to the process-wide singleton repository. */
export const funnelStagesRouter = createFunnelStagesRouter();
