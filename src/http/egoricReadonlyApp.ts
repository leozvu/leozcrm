import express, { NextFunction, Request, Response } from 'express';
import type { Knex } from '../db/knex';
import { db } from '../db/knex';
import { BusinessMemoryError, BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { EgoricBriefError, EgoricBriefService } from '../services/egoricBriefService';
import type { AdvisorModelProvider } from '../domain/advisorConversation';
import { ProactiveAlertError } from '../domain/proactiveAlerts';
import { buildAdvisorProviderFromEnv } from '../integrations/advisor/advisorProviderFactory';
import { AdvisorConversationRepository, AdvisorRepositoryError } from '../repositories/advisorConversationRepository';
import { AdvisorConversationService, AdvisorServiceError, AdvisorServiceLimits } from '../services/advisorConversationService';
import { AdvisorEvidenceError, AdvisorEvidenceService } from '../services/advisorEvidenceService';
import { CockpitService } from '../services/cockpitService';
import { ProactiveAlertRepository } from '../repositories/proactiveAlertRepository';
import { ProactiveAlertService } from '../services/proactiveAlertService';
import {
  buildNotificationDeliveryRegistry,
  NotificationDeliveryRegistry,
} from '../integrations/notifications/notificationDeliveryRegistry';
import {
  authenticateIntegrationRead,
  IntegrationReadAuthConfig,
  resolveIntegrationReadAuthConfig,
} from './integrationReadAuth';
import { createEgoricBriefRouter } from './routes/egoricBrief';
import { createAdvisorConversationRouter } from './routes/advisorConversation';
import { createCockpitApiRouter } from './routes/cockpit';
import { createCockpitExperienceRouter } from './routes/cockpitExperience';
import { createProactiveAlertRouter } from './routes/proactiveAlerts';
import { createOperationalHealthRouter } from './routes/operationalHealth';
import { OperationalHealthRepository } from '../repositories/operationalHealthRepository';
import { requestObservability, StructuredLogger } from '../observability/structuredLogger';
import { PlannerError, PLANNER_TABLES } from '../domain/planner';
import { PlannerRepository } from '../repositories/plannerRepository';
import { PlannerService } from '../services/plannerService';
import { createPlannerRouter } from './routes/planner';
import { SupervisedHandRepository } from '../repositories/supervisedHandRepository';
import { SupervisedHandError, SupervisedHandService } from '../services/supervisedHandService';
import { createSupervisedHandRouter } from './routes/supervisedHand';
import { AMBIENT_JARVIS_TABLES, AmbientJarvisError } from '../domain/ambientJarvis';
import { AmbientJarvisRepository } from '../repositories/ambientJarvisRepository';
import { AmbientJarvisService } from '../services/ambientJarvisService';
import { createAmbientJarvisRouter } from './routes/ambientJarvis';
import { JARVIS_V1_TABLES, JarvisV1Error } from '../domain/jarvisV1';
import { JarvisV1Repository } from '../repositories/jarvisV1Repository';
import { JarvisV1Service } from '../services/jarvisV1Service';
import { createJarvisV1Router } from './routes/jarvisV1';

export interface EgoricReadonlyAppOptions {
  knex?: Knex;
  integrationReadAuth?: IntegrationReadAuthConfig;
  advisorProvider?: AdvisorModelProvider;
  advisorLimits?: AdvisorServiceLimits;
  advisorClock?: () => Date;
  proactiveClock?: () => Date;
  notificationDeliveryRegistry?: NotificationDeliveryRegistry;
  structuredLogger?: StructuredLogger;
  deploymentFingerprint?: string;
  observabilityCredentialFingerprint?: string;
  maxFreshnessSeconds?: number;
  plannerClock?: () => Date;
  supervisedHandClock?: () => Date;
}

/** Read-only-to-Egoric runtime: health, cockpit, brief, and tenant-scoped Advisor memory. */
export function createEgoricReadonlyApp(options: EgoricReadonlyAppOptions = {}) {
  const app = express();
  const knex = options.knex ?? db;
  app.disable('x-powered-by');
  if (options.structuredLogger) app.use(requestObservability(options.structuredLogger));
  app.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, profile: 'egoric-readonly' });
  });
  app.get('/startup', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      profile: 'egoric-readonly',
      deployment_fingerprint: options.deploymentFingerprint ?? 'local-unbound',
    });
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
        'advisor_conversations',
        'advisor_context_entries',
        'advisor_messages',
        'advisor_runs',
        'advisor_run_results',
        'advisor_citations',
        'advisor_feedback',
        'proactive_cycles',
        'proactive_rule_evaluations',
        'proactive_alerts',
        'proactive_alert_events',
        'proactive_delivery_outbox',
        'proactive_delivery_attempts',
        'proactive_delivery_results',
        'live_observer_events',
        'live_recovery_drills',
        ...Object.values(PLANNER_TABLES),
        ...Object.values(AMBIENT_JARVIS_TABLES),
        ...Object.values(JARVIS_V1_TABLES),
      ];
      const present = await Promise.all(requiredTables.map((table) => knex.schema.hasTable(table)));
      const [, pending] = await knex.migrate.list();
      const migrationsCurrent = present.every(Boolean) && pending.length === 0;
      res.status(migrationsCurrent ? 200 : 503).json({
        ok: migrationsCurrent,
        profile: 'egoric-readonly',
        ...(options.deploymentFingerprint ? { deployment_fingerprint: options.deploymentFingerprint } : {}),
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

  const clock = options.advisorClock ?? (() => new Date());
  const repository = new BusinessMemoryRepository(knex, clock);
  const brief = new EgoricBriefService(repository);
  const advisorRepository = new AdvisorConversationRepository(knex, clock);
  const advisorEvidence = new AdvisorEvidenceService(repository, brief, advisorRepository);
  const cockpit = new CockpitService(brief);
  const proactiveClock = options.proactiveClock ?? clock;
  const proactive = new ProactiveAlertService(
    new ProactiveAlertRepository(knex, proactiveClock),
    repository,
    brief,
    options.notificationDeliveryRegistry ?? buildNotificationDeliveryRegistry(),
    proactiveClock,
  );
  const planner = new PlannerService(
    new PlannerRepository(knex, options.plannerClock ?? clock),
    repository,
    brief,
    options.plannerClock ?? clock,
  );
  const supervisedHand = new SupervisedHandService(
    repository,
    new SupervisedHandRepository(knex),
    options.supervisedHandClock ?? clock,
  );
  const ambientPreferences = new AmbientJarvisRepository(knex, clock);
  const ambientJarvis = new AmbientJarvisService(
    ambientPreferences,
    repository,
  );
  const jarvisV1 = new JarvisV1Service(
    new JarvisV1Repository(knex, clock),
    repository,
    ambientPreferences,
    clock,
  );
  const advisor = new AdvisorConversationService(
    repository,
    advisorRepository,
    advisorEvidence,
    options.advisorProvider ?? buildAdvisorProviderFromEnv(),
    options.advisorLimits,
    clock,
  );
  const auth = resolveIntegrationReadAuthConfig(options.integrationReadAuth);
  // The public shell contains no tenant data or credential. Every cockpit data
  // request still crosses the separately authenticated /v1 boundary below.
  app.use('/cockpit', createCockpitExperienceRouter());
  app.use('/internal/operations', createOperationalHealthRouter(
    new OperationalHealthRepository(knex, clock),
    options.observabilityCredentialFingerprint,
    options.maxFreshnessSeconds ?? 900,
  ));
  app.use('/v1', authenticateIntegrationRead(auth));
  app.use('/v1/tenants', createEgoricBriefRouter(brief));
  app.use('/v1/tenants', createCockpitApiRouter(cockpit));
  app.use('/v1/tenants', createAdvisorConversationRouter(advisor));
  app.use('/v1/tenants', createProactiveAlertRouter(proactive));
  app.use('/v1/tenants', createPlannerRouter(planner));
  app.use('/v1/tenants', createSupervisedHandRouter(supervisedHand));
  app.use('/v1/tenants', createAmbientJarvisRouter(ambientJarvis));
  app.use('/v1/tenants', createJarvisV1Router(jarvisV1));

  app.use((error: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (error.type === 'entity.too.large') {
      res.status(413).json({ error: 'request body exceeds 32 KiB', code: 'request_too_large' });
      return;
    }
    if (error instanceof SyntaxError && error.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'request body is invalid JSON', code: 'invalid_json' });
      return;
    }
    if (error instanceof AdvisorServiceError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof ProactiveAlertError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof PlannerError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof SupervisedHandError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof AmbientJarvisError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof JarvisV1Error) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof EgoricBriefError && error.status < 500) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof BusinessMemoryError) {
      options.structuredLogger?.log('error', 'business_memory_request_failed', { code: error.code });
      if (!options.structuredLogger) console.error('[egoric-readonly] business memory request failed', { code: error.code });
    } else if (error instanceof AdvisorRepositoryError || error instanceof AdvisorEvidenceError) {
      options.structuredLogger?.log('error', 'advisor_request_failed', { code: error.code });
      if (!options.structuredLogger) console.error('[egoric-readonly] advisor request failed', { code: error.code });
    } else {
      options.structuredLogger?.log('error', 'readonly_request_failed', { code: 'internal_error' });
      if (!options.structuredLogger) console.error('[egoric-readonly] request failed', { code: 'internal_error' });
    }
    res.status(500).json({ error: 'internal error', code: 'internal_error' });
  });

  return app;
}
