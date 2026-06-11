import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { CampaignRepository, campaignRepository } from '../../repositories/campaignRepository';
import { enforceClientScope, scopeAllows } from '../auth';

/**
 * Campaign routes, scoped to the caller's tenant. Built by a factory so the
 * repository can be injected for tests; the default binds to the singleton.
 */
export interface CampaignsRouterDeps {
  campaigns: CampaignRepository;
}

export function createCampaignsRouter(
  deps: CampaignsRouterDeps = { campaigns: campaignRepository },
): Router {
  const { campaigns } = deps;
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const auth = req.auth!;
      const requested = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
      if (auth.admin) {
        return res.json(
          requested ? await campaigns.listByClient(requested) : await campaigns.list(),
        );
      }
      // Client-scoped: only ever its own campaigns, never the global list.
      if (requested && requested !== auth.clientId) {
        return res.status(403).json({ error: 'forbidden: client scope mismatch', code: 'forbidden_tenant' });
      }
      res.json(await campaigns.listByClient(auth.clientId!));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const campaign = await campaigns.findById(req.params.id);
      // Cross-tenant rows are reported as not-found so existence is not leaked.
      if (!campaign || !scopeAllows(req, campaign.client_id)) {
        return res.status(404).json({ error: 'campaign not found' });
      }
      res.json(campaign);
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const { client_id, name, channel, status, budget_cents, started_at, ended_at } = req.body ?? {};
      if (!client_id || !name) {
        return res.status(400).json({ error: 'client_id and name are required' });
      }
      if (!enforceClientScope(req, res, client_id)) return;
      const campaign = await campaigns.create({
        client_id, name, channel, status, budget_cents, started_at, ended_at,
      });
      res.status(201).json(campaign);
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const existing = await campaigns.findById(req.params.id);
      if (!existing || !scopeAllows(req, existing.client_id)) {
        return res.status(404).json({ error: 'campaign not found' });
      }
      const { name, channel, status, budget_cents, started_at, ended_at } = req.body ?? {};
      const updated = await campaigns.update(req.params.id, {
        name, channel, status, budget_cents, started_at, ended_at,
      });
      if (!updated) return res.status(404).json({ error: 'campaign not found' });
      res.json(updated);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const existing = await campaigns.findById(req.params.id);
      if (!existing || !scopeAllows(req, existing.client_id)) {
        return res.status(404).json({ error: 'campaign not found' });
      }
      const ok = await campaigns.remove(req.params.id);
      if (!ok) return res.status(404).json({ error: 'campaign not found' });
      res.status(204).send();
    }),
  );

  return router;
}

/** Default router bound to the process-wide singleton repository. */
export const campaignsRouter = createCampaignsRouter();
