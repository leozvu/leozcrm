import { Router, json } from 'express';
import { JarvisV1Service } from '../../services/jarvisV1Service';
import { asyncHandler } from '../asyncHandler';
import { enforceTenantReadScope } from '../integrationReadAuth';

const parseJson = json({ limit: '32kb', strict: true });

function days(raw: unknown): number {
  if (raw === undefined) return 30;
  if (typeof raw !== 'string' || !/^\d{1,2}$/.test(raw)) return 0;
  return Number(raw);
}

export function createJarvisV1Router(service: JarvisV1Service): Router {
  const router = Router();

  router.get('/:tenantKey/jarvis/evaluation', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json(await service.evaluation(tenantKey, days(req.query.days)));
  }));

  router.get('/:tenantKey/jarvis/readiness', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json(await service.readiness(tenantKey, days(req.query.days)));
  }));

  router.get('/:tenantKey/jarvis/data-policy', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json(service.retentionPolicy());
  }));

  router.get('/:tenantKey/jarvis/data-requests', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json({ requests: await service.listDataRequests(tenantKey) });
  }));

  router.post('/:tenantKey/jarvis/data-requests', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) {
      res.status(400).json({ error: 'Idempotency-Key is required', code: 'missing_idempotency_key' });
      return;
    }
    const output = await service.requestData(tenantKey, req.body, idempotencyKey);
    res.setHeader('Cache-Control', 'no-store');
    res.status(output.replayed ? 200 : 201).json(output);
  }));

  router.get('/:tenantKey/jarvis/exports/:requestId', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const output = await service.export(tenantKey, req.params.requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="leozops-${tenantKey}-sanitized-export.json"`);
    res.json(output);
  }));

  return router;
}
