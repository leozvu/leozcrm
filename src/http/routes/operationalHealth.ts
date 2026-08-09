import { Router } from 'express';
import { OperatorAccessGuard } from '../../domain/sourceOperations';
import { OperationalHealthRepository, OperationalSnapshot } from '../../repositories/operationalHealthRepository';

function token(value: string | undefined): string | undefined {
  if (!value?.startsWith('Bearer ')) return undefined;
  return value.slice('Bearer '.length).trim() || undefined;
}

function prometheus(snapshot: OperationalSnapshot): string {
  const gauges: Array<[string, number]> = [
    ['leozops_source_connections', snapshot.source.connections],
    ['leozops_source_fresh_connections', snapshot.source.fresh],
    ['leozops_source_stale_connections', snapshot.source.stale],
    ['leozops_source_poll_succeeded_total', snapshot.source.poll_succeeded],
    ['leozops_source_poll_failed_total', snapshot.source.poll_failed],
    ['leozops_source_poll_latency_p95_ms', snapshot.source.latency_p95_ms],
    ['leozops_reconciliation_failed_total', snapshot.source.reconciliation_failed],
    ['leozops_advisor_runs_total', snapshot.advisor.runs],
    ['leozops_advisor_failed_total', snapshot.advisor.failed],
    ['leozops_advisor_cost_microunits', snapshot.advisor.cost_microunits],
    ['leozops_delivery_failed_total', snapshot.delivery.failed],
    ['leozops_observer_completed_total', snapshot.observer.completed],
    ['leozops_observer_failed_total', snapshot.observer.failed],
    ['leozops_incidents_opened_total', snapshot.incidents.opened],
  ];
  return `${gauges.map(([name, value]) => `# TYPE ${name} gauge\n${name} ${value}`).join('\n')}\n`;
}

export function createOperationalHealthRouter(
  repository: OperationalHealthRepository,
  credentialFingerprint: string | undefined,
  maxFreshnessSeconds: number,
): Router {
  const router = Router();
  router.use((req, res, next) => {
    const presented = token(req.header('authorization'));
    if (!credentialFingerprint || !presented) {
      res.status(401).json({ error: 'authentication required', code: 'unauthenticated' });
      return;
    }
    try {
      new OperatorAccessGuard(credentialFingerprint).assertAuthorized(presented);
      next();
    } catch {
      res.status(401).json({ error: 'invalid token', code: 'invalid_token' });
    }
  });
  router.get('/snapshot', async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await repository.snapshot(24, maxFreshnessSeconds));
    } catch (error) { next(error); }
  });
  router.get('/metrics', async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.type('text/plain; version=0.0.4').send(prometheus(await repository.snapshot(24, maxFreshnessSeconds)));
    } catch (error) { next(error); }
  });
  return router;
}
