import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { campaignRepository } from '../../repositories/campaignRepository';

export const campaignsRouter = Router();

campaignsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = req.query;
    if (typeof clientId === 'string') {
      return res.json(await campaignRepository.listByClient(clientId));
    }
    res.json(await campaignRepository.list());
  }),
);

campaignsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const campaign = await campaignRepository.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'campaign not found' });
    res.json(campaign);
  }),
);

campaignsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { client_id, name, channel, status, budget_cents, started_at, ended_at } = req.body ?? {};
    if (!client_id || !name) {
      return res.status(400).json({ error: 'client_id and name are required' });
    }
    const campaign = await campaignRepository.create({
      client_id, name, channel, status, budget_cents, started_at, ended_at,
    });
    res.status(201).json(campaign);
  }),
);

campaignsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { name, channel, status, budget_cents, started_at, ended_at } = req.body ?? {};
    const updated = await campaignRepository.update(req.params.id, {
      name, channel, status, budget_cents, started_at, ended_at,
    });
    if (!updated) return res.status(404).json({ error: 'campaign not found' });
    res.json(updated);
  }),
);

campaignsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const ok = await campaignRepository.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'campaign not found' });
    res.status(204).send();
  }),
);
