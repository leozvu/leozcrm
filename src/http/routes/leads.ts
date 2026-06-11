import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { LeadRepository, leadRepository } from '../../repositories/leadRepository';
import { enforceClientScope, scopeAllows } from '../auth';

/**
 * Lead routes, scoped to the caller's tenant. Built by a factory so the
 * repository can be injected for tests; the default binds to the singleton.
 */
export interface LeadsRouterDeps {
  leads: LeadRepository;
}

export function createLeadsRouter(
  deps: LeadsRouterDeps = { leads: leadRepository },
): Router {
  const { leads } = deps;
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const auth = req.auth!;
      const requested = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
      if (auth.admin) {
        return res.json(
          requested ? await leads.listByClient(requested) : await leads.list(),
        );
      }
      // Client-scoped: only ever its own leads, never the global list.
      if (requested && requested !== auth.clientId) {
        return res.status(403).json({ error: 'forbidden: client scope mismatch', code: 'forbidden_tenant' });
      }
      res.json(await leads.listByClient(auth.clientId!));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const lead = await leads.findById(req.params.id);
      if (!lead || !scopeAllows(req, lead.client_id)) {
        return res.status(404).json({ error: 'lead not found' });
      }
      res.json(lead);
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const { client_id, funnel_stage_id, campaign_id, name, email, phone, source, score, status } =
        req.body ?? {};
      if (!client_id || !funnel_stage_id) {
        return res.status(400).json({ error: 'client_id and funnel_stage_id are required' });
      }
      if (!enforceClientScope(req, res, client_id)) return;
      const lead = await leads.create({
        client_id, funnel_stage_id, campaign_id, name, email, phone, source, score, status,
      });
      res.status(201).json(lead);
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const existing = await leads.findById(req.params.id);
      if (!existing || !scopeAllows(req, existing.client_id)) {
        return res.status(404).json({ error: 'lead not found' });
      }
      const { campaign_id, name, email, phone, source, score, status } = req.body ?? {};
      const updated = await leads.update(req.params.id, {
        campaign_id, name, email, phone, source, score, status,
      });
      if (!updated) return res.status(404).json({ error: 'lead not found' });
      res.json(updated);
    }),
  );

  /** Move a lead to another funnel stage (records the transition + timestamp). */
  router.post(
    '/:id/move',
    asyncHandler(async (req, res) => {
      const existing = await leads.findById(req.params.id);
      if (!existing || !scopeAllows(req, existing.client_id)) {
        return res.status(404).json({ error: 'lead not found' });
      }
      const { funnel_stage_id } = req.body ?? {};
      if (!funnel_stage_id) {
        return res.status(400).json({ error: 'funnel_stage_id is required' });
      }
      const moved = await leads.moveToStage(req.params.id, funnel_stage_id);
      if (!moved) return res.status(404).json({ error: 'lead not found' });
      res.json(moved);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const existing = await leads.findById(req.params.id);
      if (!existing || !scopeAllows(req, existing.client_id)) {
        return res.status(404).json({ error: 'lead not found' });
      }
      const ok = await leads.remove(req.params.id);
      if (!ok) return res.status(404).json({ error: 'lead not found' });
      res.status(204).send();
    }),
  );

  return router;
}

/** Default router bound to the process-wide singleton repository. */
export const leadsRouter = createLeadsRouter();
