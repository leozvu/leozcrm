import { Router, json } from 'express';
import { AmbientJarvisService } from '../../services/ambientJarvisService';
import { asyncHandler } from '../asyncHandler';
import { enforceTenantReadScope } from '../integrationReadAuth';

const parseJson = json({ limit: '32kb', strict: true });

export function createAmbientJarvisRouter(service: AmbientJarvisService): Router {
  const router = Router();

  router.get('/:tenantKey/jarvis/preferences', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json(await service.current(tenantKey));
  }));

  router.post('/:tenantKey/jarvis/preferences', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) {
      res.status(400).json({ error: 'Idempotency-Key is required', code: 'missing_idempotency_key' });
      return;
    }
    const output = await service.update(tenantKey, req.body, idempotencyKey);
    res.setHeader('Cache-Control', 'no-store');
    res.status(output.replayed ? 200 : 201).json(output);
  }));

  return router;
}
