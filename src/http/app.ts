import express, { NextFunction, Request, Response } from 'express';
import { clientsRouter } from './routes/clients';
import { campaignsRouter } from './routes/campaigns';
import { leadsRouter } from './routes/leads';
import { funnelStagesRouter } from './routes/funnelStages';
import { createMetricsRouter, metricsRouter } from './routes/metrics';
import { createBriefRouter, briefRouter } from './routes/brief';
import { MetricsRepository } from '../repositories/metricsRepository';
import { ClientRepository } from '../repositories/clientRepository';
import { BriefService } from '../services/briefService';
import { ValidationError } from '../errors';
import type { Knex } from '../db/knex';

export interface CreateAppOptions {
  /**
   * Optional Knex connection for the read-only KPI + brief layers. When
   * provided, the `/metrics` and `/brief` routes are bound to repositories on
   * this connection — used by the HTTP route tests to point the endpoints at a
   * seeded in-memory database. Omitted in production, where the routes use the
   * process-wide singletons.
   */
  knex?: Knex;
}

/** Detect raw DB constraint violations (SQLite + Postgres) as a 500 backstop. */
function isConstraintViolation(err: any): boolean {
  const code = typeof err?.code === 'string' ? err.code : '';
  return code.startsWith('SQLITE_CONSTRAINT') || /^23\d{3}$/.test(code); // pg 23xxx
}

/**
 * Express app wiring the four CRUD resources. Kept framework-light and
 * stateless — auth, validation middleware, and rate limiting are deliberately
 * out of scope for this data-layer foundation (see Codex review list).
 */
export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/funnel-stages', funnelStagesRouter);
  app.use('/clients', clientsRouter);
  app.use('/campaigns', campaignsRouter);
  app.use('/leads', leadsRouter);

  // Read-only KPI + brief layers. When a connection is injected (route tests),
  // bind both to repositories on it; otherwise use the process-wide singletons.
  if (options.knex) {
    const metrics = new MetricsRepository(options.knex);
    const clients = new ClientRepository(options.knex);
    app.use('/metrics', createMetricsRouter({ metrics, clients }));
    app.use('/brief', createBriefRouter({ brief: new BriefService(metrics), clients }));
  } else {
    app.use('/metrics', metricsRouter);
    app.use('/brief', briefRouter);
  }

  // Centralized error handler. Bad input (unknown/conflicting references) is a
  // client error, not a server fault — so it must never become a 500.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    // Backstop: any DB constraint violation that slipped past validation.
    if (isConstraintViolation(err)) {
      return res.status(409).json({ error: 'constraint violation', code: 'constraint_violation' });
    }
    console.error(err);
    res.status(500).json({ error: 'internal error', detail: err.message });
  });

  return app;
}
