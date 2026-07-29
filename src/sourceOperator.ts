import * as dotenv from 'dotenv';
import { db } from './db/knex';
import { SOURCE_POLL_CADENCE_MS, SourcePollPolicy } from './domain/pollReliability';
import {
  OperatorAccessGuard,
  SourceOperationsAlert,
  SourceOperationsError,
  safeSourceOperationsCode,
} from './domain/sourceOperations';
import { BusinessMemoryRepository } from './repositories/businessMemoryRepository';
import { SourceOperationsRepository } from './repositories/sourceOperationsRepository';
import { SourcePollStateRepository } from './repositories/sourcePollStateRepository';
import { EgoricBriefService } from './services/egoricBriefService';
import { SnapshotIngestionService } from './services/snapshotIngestionService';
import { SourceHealthService } from './services/sourceHealthService';
import { SourceOperatorService } from './services/sourceOperatorService';
import { SourcePollCoordinator } from './services/sourcePollCoordinator';
import { SourceReconciliationService } from './services/sourceReconciliationService';

dotenv.config();

type Command = 'health' | 'poll' | 'reconcile' | 'disable' | 'recover';

function parseArgs(argv: string[]): { command: Command; flags: Record<string, string> } {
  const command = argv[0] as Command;
  if (!['health', 'poll', 'reconcile', 'disable', 'recover'].includes(command)) {
    throw new SourceOperationsError('invalid_operator_command', 'operator command is invalid');
  }
  const flags: Record<string, string> = {};
  for (let index = 1; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name.startsWith('--') || !value || value.startsWith('--')) {
      throw new SourceOperationsError('invalid_operator_arguments', 'operator arguments are invalid');
    }
    flags[name.slice(2)] = value;
    index += 1;
  }
  return { command, flags };
}

function required(value: string | undefined, code: string): string {
  if (!value) throw new SourceOperationsError(code, 'required operator configuration is missing');
  return value;
}

function numberEnv(name: string): number {
  const raw = required(process.env[name], 'missing_poll_policy');
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new SourceOperationsError('invalid_poll_policy', 'poll policy is invalid');
  }
  return value;
}

function pollPolicy(): SourcePollPolicy {
  return {
    cadenceMs: SOURCE_POLL_CADENCE_MS,
    requestTimeoutMs: numberEnv('LEOZOPS_POLL_REQUEST_TIMEOUT_MS'),
    maxRetries: numberEnv('LEOZOPS_POLL_MAX_RETRIES'),
    baseDelayMs: numberEnv('LEOZOPS_POLL_BASE_DELAY_MS'),
    maxDelayMs: numberEnv('LEOZOPS_POLL_MAX_DELAY_MS'),
    jitterRatio: numberEnv('LEOZOPS_POLL_JITTER_RATIO'),
    circuitFailureThreshold: numberEnv('LEOZOPS_POLL_CIRCUIT_FAILURE_THRESHOLD'),
    circuitOpenMs: numberEnv('LEOZOPS_POLL_CIRCUIT_OPEN_MS'),
    leaseMs: numberEnv('LEOZOPS_POLL_LEASE_MS'),
  };
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const operatorToken = required(process.env.LEOZOPS_OPERATOR_TOKEN, 'missing_operator_token');
  const access = new OperatorAccessGuard(required(
    process.env.LEOZOPS_OPERATOR_TOKEN_SHA256,
    'missing_operator_fingerprint',
  ));
  const tenantId = required(flags['tenant-id'], 'missing_tenant_id');
  const sourceConnectionId = required(flags['connection-id'], 'missing_source_connection_id');

  const memory = new BusinessMemoryRepository(db);
  const states = new SourcePollStateRepository(db);
  const operations = new SourceOperationsRepository(db);
  const reconciliation = new SourceReconciliationService(
    operations,
    new EgoricBriefService(memory),
    {
      emit: async (alert: SourceOperationsAlert) => {
        console.error(JSON.stringify({ event: 'source_operations_alert', ...alert }));
      },
    },
  );
  const health = new SourceHealthService(
    access,
    operations,
    states,
    numberEnv('LEOZOPS_SOURCE_STALE_AFTER_MS'),
  );
  const operator = new SourceOperatorService(
    access,
    states,
    health,
    reconciliation,
    () => new SourcePollCoordinator(
      states,
      new SnapshotIngestionService(memory),
      memory,
      pollPolicy(),
    ),
  );
  const common = { operatorToken, tenantId, sourceConnectionId };

  if (command === 'health') {
    console.log(JSON.stringify(await operator.health(common), null, 2));
    return;
  }
  if (command === 'poll') {
    const result = await operator.poll({
      ...common,
      bearerToken: required(process.env.LEOZOPS_SOURCE_BEARER_TOKEN, 'missing_source_bearer'),
      engineVersion: required(process.env.LEOZOPS_SOURCE_ENGINE_VERSION, 'missing_engine_version'),
    });
    const safeResult = result.kind === 'skipped'
      ? result
      : result.kind === 'succeeded'
        ? {
            kind: result.kind,
            outcome: result.outcome,
            attempts: result.attempts,
            correlation_id: result.correlation_id,
          }
        : {
            kind: result.kind,
            error_code: result.error_code,
            http_status: result.http_status,
            attempts: result.attempts,
            disabled: result.disabled,
          };
    console.log(JSON.stringify(safeResult, null, 2));
    return;
  }
  if (command === 'reconcile') {
    console.log(JSON.stringify(await operator.reconcile({
      ...common,
      businessDate: required(flags['business-date'], 'missing_business_date'),
      businessTimezone: required(flags.timezone, 'missing_business_timezone'),
    }), null, 2));
    return;
  }
  const state = command === 'disable'
    ? await operator.disable(common)
    : await operator.recover(common);
  console.log(JSON.stringify({
    source_connection_id: state.source_connection_id,
    circuit_state: state.circuit_state,
    consecutive_failures: state.consecutive_failures,
    next_attempt_at: state.next_attempt_at,
    last_failure_code: state.last_error_code,
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    const code = error && typeof error === 'object' && 'code' in error
      ? safeSourceOperationsCode(String(error.code))
      : 'operator_command_failed';
    console.error(JSON.stringify({ ok: false, code }));
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
