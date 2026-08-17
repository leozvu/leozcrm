import { Router, json } from 'express';
import { VoiceSessionService } from '../../services/voiceSessionService';
import { asyncHandler } from '../asyncHandler';
import { enforceTenantReadScope } from '../integrationReadAuth';

const parseJson = json({ limit: '32kb', strict: true });

export function createVoiceSessionRouter(service: VoiceSessionService): Router {
  const router = Router();

  router.get('/:tenantKey/jarvis/voice/quality', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const rawDays = req.query.days;
    const days = rawDays === undefined ? 30 : Number(rawDays);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json(await service.quality(tenantKey, days));
  }));

  router.post('/:tenantKey/jarvis/voice/sessions', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) {
      res.status(400).json({ error: 'Idempotency-Key is required', code: 'missing_idempotency_key' });
      return;
    }
    const output = await service.create(tenantKey, req.body, idempotencyKey);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.status(output.replayed ? 200 : 201).json(output);
  }));

  router.get('/:tenantKey/jarvis/voice/sessions/:sessionId', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json(await service.get(tenantKey, req.params.sessionId));
  }));

  router.post('/:tenantKey/jarvis/voice/sessions/:sessionId/events', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const output = await service.recordClientEvent(tenantKey, req.params.sessionId, req.body);
    res.setHeader('Cache-Control', 'no-store');
    res.status(output.replayed ? 200 : 201).json(output);
  }));

  router.post('/:tenantKey/jarvis/voice/sessions/:sessionId/review', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) {
      res.status(400).json({ error: 'Idempotency-Key is required', code: 'missing_idempotency_key' });
      return;
    }
    const output = await service.review(tenantKey, req.params.sessionId, req.body, idempotencyKey);
    res.setHeader('Cache-Control', 'no-store');
    res.status(output.replayed ? 200 : 201).json(output);
  }));

  return router;
}
