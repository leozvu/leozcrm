import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { db } from './db/knex';
import { EGORIC_SNAPSHOT_PATH } from './domain/businessMemory';
import { validateP1Decision } from './domain/p1Decision';
import {
  Phase2Environment,
  ShadowReleaseDecision,
} from './domain/shadowTrust';
import {
  OperatorAccessGuard,
  SourceOperationsAlert,
  SourceOperationsError,
  safeSourceOperationsCode,
} from './domain/sourceOperations';
import { SOURCE_POLL_CADENCE_MS, SourcePollPolicy } from './domain/pollReliability';
import { validatePhase2Authorization } from './domain/phase2Proof';
import { BusinessMemoryRepository } from './repositories/businessMemoryRepository';
import { SourceOperationsRepository } from './repositories/sourceOperationsRepository';
import { SourcePollStateRepository } from './repositories/sourcePollStateRepository';
import { ShadowTrustRepository } from './repositories/shadowTrustRepository';
import { EgoricBriefService } from './services/egoricBriefService';
import { ShadowTrustService } from './services/shadowTrustService';
import { SnapshotIngestionService } from './services/snapshotIngestionService';
import { SourcePollCoordinator } from './services/sourcePollCoordinator';
import { SourceReconciliationService } from './services/sourceReconciliationService';
import { SourceShadowWorker } from './services/sourceShadowWorker';

dotenv.config();

type Command = 'poll' | 'daily-close' | 'status' | 'decide';

function required(value: string | undefined, code: string): string {
  if (!value) throw new SourceOperationsError(code, 'required Phase 2 configuration is missing');
  return value;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function parseArgs(argv: string[]): { command: Command; flags: Record<string, string> } {
  const command = argv[0] as Command;
  if (!['poll', 'daily-close', 'status', 'decide'].includes(command)) {
    throw new SourceOperationsError('invalid_shadow_command', 'shadow command is invalid');
  }
  const flags: Record<string, string> = {};
  for (let index = 1; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name.startsWith('--') || !value || value.startsWith('--')) {
      throw new SourceOperationsError('invalid_shadow_arguments', 'shadow arguments are invalid');
    }
    flags[name.slice(2)] = value;
    index += 1;
  }
  return { command, flags };
}

function exactBoolean(value: string | undefined, code: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new SourceOperationsError(code, 'boolean evidence must be explicitly true or false');
}

function integer(value: string | undefined, code: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new SourceOperationsError(code, 'numeric evidence must be a non-negative integer');
  }
  return parsed;
}

function environment(): Phase2Environment {
  const value = required(process.env.LEOZOPS_PHASE2_ENVIRONMENT, 'missing_phase2_environment');
  if (value !== 'test' && value !== 'production') {
    throw new SourceOperationsError('invalid_phase2_environment', 'Phase 2 environment is invalid');
  }
  return value;
}

function sourcePolicy(manifest: ReturnType<typeof validateP1Decision>['manifest']): SourcePollPolicy {
  if (!manifest) throw new SourceOperationsError('invalid_p1_decision', 'P1 decision is unavailable');
  const { staleAfterMs: _stale, ...policy } = manifest.poll_policy;
  return { ...policy, cadenceMs: SOURCE_POLL_CADENCE_MS };
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const target = environment();
  const p1Raw = readJson(required(process.env.LEOZOPS_P1_MANIFEST, 'missing_p1_manifest'));
  const checkpointRaw = target === 'production'
    ? readJson(required(process.env.LEOZOPS_CHECKPOINT_B_EVIDENCE, 'missing_checkpoint_b_evidence'))
    : undefined;
  const p2Raw = target === 'production'
    ? readJson(required(process.env.LEOZOPS_P2_MANIFEST, 'missing_p2_manifest'))
    : undefined;
  const authorization = validatePhase2Authorization({
    environment: target,
    p1: p1Raw,
    checkpointB: checkpointRaw,
    p2: p2Raw,
  });
  if (!authorization.ok || !authorization.value) {
    throw new SourceOperationsError('phase2_authorization_blocked', authorization.issues.join('; '));
  }
  const p1 = validateP1Decision(p1Raw);
  if (!p1.ok || !p1.manifest) {
    throw new SourceOperationsError('invalid_p1_decision', p1.issues.join('; '));
  }
  const selected = target === 'test' ? 'test' : 'production';
  const runtime = p1.manifest.runtime[selected];
  const database = p1.manifest.database[selected];
  const egoric = p1.manifest.egoric[selected];
  if (
    required(process.env.LEOZOPS_RUNTIME_PROJECT_ID, 'missing_runtime_identity') !== runtime.project_id
    || required(process.env.LEOZOPS_DATABASE_ID, 'missing_database_identity') !== database.database_id
    || required(process.env.LEOZOPS_EGORIC_PROJECT_ID, 'missing_egoric_identity') !== egoric.project_id
  ) {
    throw new SourceOperationsError('environment_identity_mismatch', 'runtime identity does not match P1');
  }

  const operatorToken = required(process.env.LEOZOPS_OPERATOR_TOKEN, 'missing_operator_token');
  const access = new OperatorAccessGuard(required(
    process.env.LEOZOPS_OPERATOR_TOKEN_SHA256,
    'missing_operator_fingerprint',
  ));
  access.assertAuthorized(operatorToken);
  const tenantId = required(flags['tenant-id'], 'missing_tenant_id');
  const sourceConnectionId = required(flags['connection-id'], 'missing_source_connection_id');
  const memory = new BusinessMemoryRepository(db);
  const operations = new SourceOperationsRepository(db);
  const states = new SourcePollStateRepository(db);
  const evidence = new ShadowTrustRepository(db);
  const context = await operations.findContext(tenantId, sourceConnectionId);
  const expectedEndpoint = `${egoric.base_url}${EGORIC_SNAPSHOT_PATH}`;
  if (
    !context
    || context.connection.source_tenant_key !== egoric.tenant_key
    || context.connection.endpoint_url !== expectedEndpoint
  ) {
    throw new SourceOperationsError(
      'source_identity_mismatch',
      'source connection does not match the authorized Egoric environment',
    );
  }

  const reconciliation = new SourceReconciliationService(
    operations,
    new EgoricBriefService(memory),
    {
      emit: async (alert: SourceOperationsAlert) => {
        console.error(JSON.stringify({ event: 'source_operations_alert', ...alert }));
      },
    },
  );
  const shadow = new ShadowTrustService(evidence, operations, reconciliation);
  const common = { tenantId, sourceConnectionId };

  if (command === 'poll') {
    const worker = new SourceShadowWorker(
      () => new SourcePollCoordinator(
        states,
        new SnapshotIngestionService(memory),
        memory,
        sourcePolicy(p1.manifest),
      ),
      operations,
      evidence,
    );
    const result = await worker.runOnce({
      ...common,
      environment: target,
      authorizationId: authorization.value.authorization_id,
      bearerToken: required(process.env.LEOZOPS_SOURCE_BEARER_TOKEN, 'missing_source_bearer'),
      engineVersion: required(process.env.LEOZOPS_SOURCE_ENGINE_VERSION, 'missing_engine_version'),
    });
    console.log(JSON.stringify({
      outcome: result.evidence.outcome,
      correlation_id: result.evidence.correlation_id,
      attempts: result.evidence.attempt_count,
      evidence_id: result.evidence.id,
    }, null, 2));
    if (result.evidence.outcome === 'failed') {
      throw new SourceOperationsError(
        result.evidence.error_code ?? 'shadow_poll_failed',
        'poll failure was recorded; scheduler invocation must fail for alerting',
      );
    }
    if (
      result.result.kind === 'skipped'
      && ['disabled', 'unknown_connection', 'circuit_open'].includes(result.result.reason)
    ) {
      throw new SourceOperationsError(
        `shadow_poll_${result.result.reason}`,
        'unsafe skipped poll was recorded; scheduler invocation must fail for alerting',
      );
    }
    return;
  }

  if (target !== 'production') {
    throw new SourceOperationsError(
      'production_shadow_required',
      'daily evidence and release decisions require P2 production authorization',
    );
  }
  if (command === 'daily-close') {
    const result = await shadow.closeBusinessDay({
      ...common,
      authorizationId: authorization.value.authorization_id,
      businessDate: required(flags['business-date'], 'missing_business_date'),
      businessTimezone: p1.manifest.operations.business_timezone,
      businessDays: p1.manifest.operations.business_days,
      businessStartLocal: p1.manifest.operations.business_start_local,
      businessEndLocal: p1.manifest.operations.business_end_local,
      staleAfterMs: p1.manifest.poll_policy.staleAfterMs,
      expectedReviewer: p1.manifest.operations.director_reviewer,
      reviewer: required(flags.reviewer, 'missing_reviewer'),
      reviewerScore: integer(flags.score, 'invalid_reviewer_score'),
      materialFalseClaim: exactBoolean(flags['material-false-claim'], 'missing_false_claim_evidence'),
      observedSourceMutationCount: integer(flags['source-mutations'], 'missing_mutation_evidence'),
      employeeWorkflowRegression: exactBoolean(
        flags['employee-regression'],
        'missing_employee_regression_evidence',
      ),
      sourceLatencyRegression: exactBoolean(
        flags['latency-regression'],
        'missing_latency_regression_evidence',
      ),
      sourceErrorRegression: exactBoolean(
        flags['error-regression'],
        'missing_error_regression_evidence',
      ),
      incidentCount: integer(flags.incidents, 'missing_incident_evidence'),
      rollbackEventCount: integer(flags.rollbacks, 'missing_rollback_evidence'),
    });
    console.log(JSON.stringify({
      business_date: result.business_date,
      status: result.status,
      evidence_key: result.evidence_key,
      failure_codes: JSON.parse(result.failure_codes_json),
    }, null, 2));
    if (result.status === 'failed') {
      throw new SourceOperationsError(
        'shadow_day_failed',
        'failed daily evidence was recorded; nightly invocation must fail for alerting',
      );
    }
    return;
  }
  if (command === 'status') {
    console.log(JSON.stringify(await shadow.evaluate({
      ...common,
      businessDays: p1.manifest.operations.business_days,
    }), null, 2));
    return;
  }

  const decision = required(flags.decision, 'missing_release_decision') as ShadowReleaseDecision;
  if (!['go', 'extend', 'revoke'].includes(decision)) {
    throw new SourceOperationsError('invalid_release_decision', 'release decision is invalid');
  }
  const result = await shadow.decide({
    ...common,
    authorizationId: authorization.value.authorization_id,
    businessDays: p1.manifest.operations.business_days,
    decision,
    decidedBy: required(flags['decided-by'], 'missing_decider'),
    reasonCode: required(flags.reason, 'missing_reason_code'),
    extendUntilBusinessDate: flags['extend-until'],
  });
  console.log(JSON.stringify({
    decision: result.decision.decision,
    decision_id: result.decision.id,
    evaluation: result.evaluation,
    external_actions_performed: false,
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    const code = error && typeof error === 'object' && 'code' in error
      ? safeSourceOperationsCode(String(error.code))
      : 'shadow_command_failed';
    console.error(JSON.stringify({ ok: false, code }));
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
