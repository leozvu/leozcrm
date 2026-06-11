import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { funnelStageRepository } from '../../repositories/funnelStageRepository';

/**
 * Funnel stages are reference data seeded from src/domain/funnel.ts.
 * Read-only over HTTP in this foundation (no create/delete) so the canonical
 * funnel cannot be corrupted by accident.
 */
export const funnelStagesRouter = Router();

funnelStagesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await funnelStageRepository.listOrdered());
  }),
);

funnelStagesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const stage = await funnelStageRepository.findById(req.params.id);
    if (!stage) return res.status(404).json({ error: 'funnel stage not found' });
    res.json(stage);
  }),
);
