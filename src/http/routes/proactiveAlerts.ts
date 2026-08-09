import { Router, json } from 'express';
import { asyncHandler } from '../asyncHandler';
import { enforceTenantReadScope } from '../integrationReadAuth';
import { ProactiveAlertService } from '../../services/proactiveAlertService';

const parseJson = json({ limit: '32kb', strict: true });

function body(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasOnly(input: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(input).every((key) => allowed.includes(key));
}

function alertView(view: Awaited<ReturnType<ProactiveAlertService['listAlerts']>>[number]) {
  return {
    id: view.alert.id,
    rule_id: view.alert.rule_id,
    severity: view.alert.severity,
    confidence: view.alert.confidence,
    title: view.alert.title,
    rationale: view.alert.rationale,
    recommendation: view.alert.recommendation,
    state: view.state,
    snoozed_until: view.snoozed_until,
    outcome: view.outcome,
    evidence: JSON.parse(view.alert.evidence_json),
    evidence_hash: view.alert.evidence_hash,
    source_snapshot_id: view.alert.source_snapshot_id,
    intelligence_run_id: view.alert.intelligence_run_id,
    created_at: view.alert.created_at,
  };
}

export function createProactiveAlertRouter(service: ProactiveAlertService): Router {
  const router = Router();

  router.get('/:tenantKey/alerts', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const alerts = await service.listAlerts(tenantKey, typeof req.query.state === 'string' ? req.query.state : undefined);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json({ alerts: alerts.map(alertView) });
  }));

  router.post('/:tenantKey/alerts/:alertId/acknowledgements', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const input = body(req.body);
    if (!hasOnly(input, [])) {
      res.status(400).json({ error: 'request has unsupported fields', code: 'invalid_input' });
      return;
    }
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) {
      res.status(400).json({ error: 'Idempotency-Key is required', code: 'missing_idempotency_key' });
      return;
    }
    const output = await service.acknowledge(tenantKey, {
      alertId: req.params.alertId,
      idempotencyKey,
      actor: 'founder',
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(output.replayed ? 200 : 201).json({
      event: { id: output.event.id, type: output.event.event_type, created_at: output.event.created_at },
      replayed: output.replayed,
    });
  }));

  router.post('/:tenantKey/alerts/:alertId/snoozes', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const input = body(req.body);
    if (!hasOnly(input, ['until'])) {
      res.status(400).json({ error: 'request has unsupported fields', code: 'invalid_input' });
      return;
    }
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) {
      res.status(400).json({ error: 'Idempotency-Key is required', code: 'missing_idempotency_key' });
      return;
    }
    const output = await service.snooze(tenantKey, {
      alertId: req.params.alertId,
      idempotencyKey,
      actor: 'founder',
      until: typeof input.until === 'string' ? input.until : '',
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(output.replayed ? 200 : 201).json({
      event: {
        id: output.event.id,
        type: output.event.event_type,
        snoozed_until: output.event.snoozed_until,
        created_at: output.event.created_at,
      },
      replayed: output.replayed,
    });
  }));

  router.post('/:tenantKey/alerts/:alertId/outcomes', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const input = body(req.body);
    if (!hasOnly(input, ['outcome'])) {
      res.status(400).json({ error: 'request has unsupported fields', code: 'invalid_input' });
      return;
    }
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) {
      res.status(400).json({ error: 'Idempotency-Key is required', code: 'missing_idempotency_key' });
      return;
    }
    const output = await service.recordOutcome(tenantKey, {
      alertId: req.params.alertId,
      idempotencyKey,
      actor: 'founder',
      outcome: input.outcome as 'useful' | 'false_positive',
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(output.replayed ? 200 : 201).json({
      event: { id: output.event.id, type: output.event.event_type, created_at: output.event.created_at },
      replayed: output.replayed,
    });
  }));

  router.get('/:tenantKey/alert-shadow-baseline', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const output = await service.shadowBaseline(tenantKey, {
      from: typeof req.query.from === 'string' ? req.query.from : '',
      to: typeof req.query.to === 'string' ? req.query.to : '',
    });
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json(output);
  }));

  router.get('/:tenantKey/notification-deliveries', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const deliveries = await service.listDeliveries(tenantKey);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json({
      deliveries: deliveries.map((delivery) => ({
        id: delivery.outbox.id,
        alert_id: delivery.outbox.alert_id,
        kind: delivery.outbox.delivery_kind,
        status: delivery.status,
        available_at: delivery.outbox.available_at,
        evidence_hash: delivery.outbox.evidence_hash,
        adapter: delivery.latest_attempt
          ? { key: delivery.latest_attempt.adapter_key, version: delivery.latest_attempt.adapter_version }
          : null,
        receipt_id: delivery.latest_result?.receipt_id ?? null,
        failure_code: delivery.latest_result?.failure_code ?? null,
        created_at: delivery.outbox.created_at,
      })),
    });
  }));

  return router;
}
