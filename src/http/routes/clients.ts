import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { clientRepository } from '../../repositories/clientRepository';

export const clientsRouter = Router();

clientsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await clientRepository.list());
  }),
);

clientsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const client = await clientRepository.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'client not found' });
    res.json(client);
  }),
);

clientsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, email, company, status, notes } = req.body ?? {};
    if (!name || !email) {
      return res.status(400).json({ error: 'name and email are required' });
    }
    const client = await clientRepository.create({ name, email, company, status, notes });
    res.status(201).json(client);
  }),
);

clientsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { name, email, company, status, notes } = req.body ?? {};
    const updated = await clientRepository.update(req.params.id, { name, email, company, status, notes });
    if (!updated) return res.status(404).json({ error: 'client not found' });
    res.json(updated);
  }),
);

clientsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const ok = await clientRepository.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'client not found' });
    res.status(204).send();
  }),
);
