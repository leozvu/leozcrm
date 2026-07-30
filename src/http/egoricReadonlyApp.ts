import express, { NextFunction, Request, Response } from 'express';
import type { Knex } from '../db/knex';
import { db } from '../db/knex';
import { BusinessMemoryError, BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { EgoricBriefError, EgoricBriefService } from '../services/egoricBriefService';
import {
  authenticateIntegrationRead,
  IntegrationReadAuthConfig,
  resolveIntegrationReadAuthConfig,
} from './integrationReadAuth';
import { createEgoricBriefRouter } from './routes/egoricBrief';

export interface EgoricReadonlyAppOptions {
  knex?: Knex;
  integrationReadAuth?: IntegrationReadAuthConfig;
}

/** G3 runtime: health plus one authenticated tenant brief route, nothing else. */
export function createEgoricReadonlyApp(options: EgoricReadonlyAppOptions = {}) {
  const app = express();
  const knex = options.knex ?? db;
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, profile: 'egoric-readonly' });
  });
  app.get('/ready', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const requiredTables = [
        'tenants',
        'source_connections',
        'source_snapshots',
        'intelligence_runs',
        'source_poll_states',
        'source_reconciliations',
        'source_poll_runs',
        'shadow_daily_evidence',
        'phase2_release_decisions',
        'supervised_action_policies',
        'supervised_action_proposals',
        'supervised_action_previews',
        'supervised_action_approvals',
        'supervised_action_attempts',
        'supervised_action_events',
        'bounded_autonomy_simulations',
        'bounded_autonomy_policies',
        'bounded_autonomy_kill_switch_events',
        'bounded_autonomy_evaluations',
        'bounded_autonomy_attempts',
        'bounded_autonomy_recovery_previews',
        'bounded_autonomy_recovery_approvals',
        'bounded_autonomy_incident_events',
        'bounded_autonomy_events',
        'operational_assurance_policies',
        'operational_assurance_assessments',
        'operational_assurance_release_packages',
        'operational_assurance_events',
      ];
      const present = await Promise.all(requiredTables.map((table) => knex.schema.hasTable(table)));
      const [, pending] = await knex.migrate.list();
      const migrationsCurrent = present.every(Boolean) && pending.length === 0;
      res.status(migrationsCurrent ? 200 : 503).json({
        ok: migrationsCurrent,
        profile: 'egoric-readonly',
        checks: { db: 'ok', migrations_current: migrationsCurrent },
      });
    } catch {
      res.status(503).json({
        ok: false,
        profile: 'egoric-readonly',
        checks: { db: 'unreachable', migrations_current: false },
      });
    }
  });

  const repository = new BusinessMemoryRepository(knex);
  const brief = new EgoricBriefService(repository);
  const auth = resolveIntegrationReadAuthConfig(options.integrationReadAuth);
  app.use('/v1', authenticateIntegrationRead(auth));
  app.use('/v1/tenants', createEgoricBriefRouter(brief));

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof EgoricBriefError && error.status < 500) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof BusinessMemoryError) {
      console.error('[egoric-readonly] business memory request failed', { code: error.code });
    } else {
      console.error('[egoric-readonly] request failed', { code: 'internal_error' });
    }
    res.status(500).json({ error: 'internal error', code: 'internal_error' });
  });

  return app;
}
