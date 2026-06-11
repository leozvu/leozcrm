import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { ClientRepository, clientRepository } from '../../repositories/clientRepository';
import { enforceClientScope, requireAdmin } from '../auth';

/**
 * Client routes. A client IS a tenant, so access is scoped to the caller:
 * listing/creating clients is an admin operation, while reading/updating a
 * single client requires that the caller is that client (or admin).
 *
 * Built by a factory so its repository can be injected (route tests bind it to a
 * seeded in-memory DB); the default binds to the process-wide singleton.
 */
export interface ClientsRouterDeps {
  clients: ClientRepository;
}

export function createClientsRouter(
  deps: ClientsRouterDeps = { clients: clientRepository },
): Router {
  const { clients } = deps;
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      // Listing every client crosses tenants — admin only.
      if (!requireAdmin(req, res)) return;
      res.json(await clients.list());
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      if (!enforceClientScope(req, res, req.params.id)) return;
      const client = await clients.findById(req.params.id);
      if (!client) return res.status(404).json({ error: 'client not found' });
      res.json(client);
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      // Creating a new tenant is an admin operation.
      if (!requireAdmin(req, res)) return;
      const { name, email, company, status, notes } = req.body ?? {};
      if (!name || !email) {
        return res.status(400).json({ error: 'name and email are required' });
      }
      const client = await clients.create({ name, email, company, status, notes });
      res.status(201).json(client);
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      if (!enforceClientScope(req, res, req.params.id)) return;
      const { name, email, company, status, notes } = req.body ?? {};
      const updated = await clients.update(req.params.id, { name, email, company, status, notes });
      if (!updated) return res.status(404).json({ error: 'client not found' });
      res.json(updated);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      if (!enforceClientScope(req, res, req.params.id)) return;
      const ok = await clients.remove(req.params.id);
      if (!ok) return res.status(404).json({ error: 'client not found' });
      res.status(204).send();
    }),
  );

  return router;
}

/** Default router bound to the process-wide singleton repository. */
export const clientsRouter = createClientsRouter();
