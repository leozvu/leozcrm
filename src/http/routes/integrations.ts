import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { IntegrationRegistry, integrationRegistry } from '../../integrations/registry';

/**
 * Read-only integration registry endpoints (Milestone #6). These expose the
 * placeholder adapter *metadata* only — which channels exist, their
 * capabilities, and that they are `mode: "placeholder"` / `advisory_only`.
 *
 *   GET /integrations            list all placeholder adapters
 *   GET /integrations/:channel   one adapter's info (404 if unknown)
 *
 * There is deliberately NO action/execute endpoint: the HTTP surface cannot
 * trigger a (no-op or otherwise) channel action, so nothing here can publish or
 * mutate anything. The no-op `execute` behaviour is exercised in unit tests, not
 * exposed over HTTP.
 *
 * Built by a factory so its registry can be injected for tests; the default
 * binds to the process-wide singleton.
 */
export interface IntegrationsRouterDeps {
  registry: IntegrationRegistry;
}

export function createIntegrationsRouter(
  deps: IntegrationsRouterDeps = { registry: integrationRegistry },
): Router {
  const { registry } = deps;
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ mode: 'placeholder', advisory_only: true, integrations: registry.listInfo() });
    }),
  );

  router.get(
    '/:channel',
    asyncHandler(async (req, res) => {
      const adapter = registry.get(req.params.channel);
      if (!adapter) {
        return res.status(404).json({ error: 'integration not found' });
      }
      res.json(adapter.info());
    }),
  );

  return router;
}

/** Default router bound to the process-wide registry singleton. */
export const integrationsRouter = createIntegrationsRouter();
