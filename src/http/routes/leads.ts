import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { leadRepository } from '../../repositories/leadRepository';

export const leadsRouter = Router();

leadsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = req.query;
    if (typeof clientId === 'string') {
      return res.json(await leadRepository.listByClient(clientId));
    }
    res.json(await leadRepository.list());
  }),
);

leadsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const lead = await leadRepository.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'lead not found' });
    res.json(lead);
  }),
);

leadsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { client_id, funnel_stage_id, campaign_id, name, email, phone, source, score, status } =
      req.body ?? {};
    if (!client_id || !funnel_stage_id) {
      return res.status(400).json({ error: 'client_id and funnel_stage_id are required' });
    }
    const lead = await leadRepository.create({
      client_id, funnel_stage_id, campaign_id, name, email, phone, source, score, status,
    });
    res.status(201).json(lead);
  }),
);

leadsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { campaign_id, name, email, phone, source, score, status } = req.body ?? {};
    const updated = await leadRepository.update(req.params.id, {
      campaign_id, name, email, phone, source, score, status,
    });
    if (!updated) return res.status(404).json({ error: 'lead not found' });
    res.json(updated);
  }),
);

/** Move a lead to another funnel stage (records the transition + timestamp). */
leadsRouter.post(
  '/:id/move',
  asyncHandler(async (req, res) => {
    const { funnel_stage_id } = req.body ?? {};
    if (!funnel_stage_id) {
      return res.status(400).json({ error: 'funnel_stage_id is required' });
    }
    const moved = await leadRepository.moveToStage(req.params.id, funnel_stage_id);
    if (!moved) return res.status(404).json({ error: 'lead not found' });
    res.json(moved);
  }),
);

leadsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const ok = await leadRepository.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'lead not found' });
    res.status(204).send();
  }),
);
