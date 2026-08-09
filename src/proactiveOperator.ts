import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { db } from './db/knex';
import { ProactiveAlertError } from './domain/proactiveAlerts';
import { OperatorAccessGuard } from './domain/sourceOperations';
import { buildNotificationDeliveryRegistry } from './integrations/notifications/notificationDeliveryRegistry';
import { BusinessMemoryRepository } from './repositories/businessMemoryRepository';
import { ProactiveAlertRepository } from './repositories/proactiveAlertRepository';
import { EgoricBriefService } from './services/egoricBriefService';
import { ProactiveAlertService } from './services/proactiveAlertService';

dotenv.config();

type Input = Record<string, unknown>;

function readJson(file: string): Input {
  const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProactiveAlertError('invalid_operator_input', 'operator input must be a JSON object', 400);
  }
  return value as Input;
}

function exactKeys(input: Input, keys: readonly string[]): void {
  const expected = new Set(keys);
  const extra = Object.keys(input).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in input));
  if (extra.length || missing.length) {
    throw new ProactiveAlertError(
      'invalid_operator_input',
      `operator input keys mismatch; missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`,
      400,
    );
  }
}

function text(input: Input, name: string): string {
  if (typeof input[name] !== 'string') throw new ProactiveAlertError('invalid_operator_input', `${name} must be a string`, 400);
  return input[name] as string;
}

function nullableText(input: Input, name: string): string | undefined {
  if (input[name] === null) return undefined;
  return text(input, name);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const file = process.argv[3];
  if (!command || !file) {
    throw new ProactiveAlertError(
      'missing_operator_command',
      'usage: npm run proactive:operator -- <evaluate|daily-brief|deliver|status|shadow-status> <input.json>',
      400,
    );
  }
  const token = process.env.LEOZOPS_PROACTIVE_OPERATOR_TOKEN;
  const fingerprint = process.env.LEOZOPS_PROACTIVE_OPERATOR_TOKEN_SHA256;
  if (!token || !fingerprint) throw new ProactiveAlertError('missing_operator_credential', 'proactive operator credential is required', 403);
  new OperatorAccessGuard(fingerprint).assertAuthorized(token);

  const input = readJson(file);
  const memory = new BusinessMemoryRepository(db);
  const repository = new ProactiveAlertRepository(db);
  const service = new ProactiveAlertService(
    repository,
    memory,
    new EgoricBriefService(memory),
    buildNotificationDeliveryRegistry(),
  );
  let output: unknown;
  switch (command) {
    case 'evaluate':
    case 'daily-brief':
      exactKeys(input, ['tenant_key', 'idempotency_key', 'as_of']);
      output = await service.runCycle(text(input, 'tenant_key'), {
        mode: command === 'evaluate' ? 'evaluate' : 'daily_brief',
        idempotencyKey: text(input, 'idempotency_key'),
        asOf: nullableText(input, 'as_of'),
      });
      break;
    case 'deliver':
      exactKeys(input, ['tenant_key', 'outbox_id', 'attempt_key']);
      output = await service.deliver(text(input, 'tenant_key'), {
        outboxId: text(input, 'outbox_id'),
        attemptKey: text(input, 'attempt_key'),
      });
      break;
    case 'status':
      exactKeys(input, ['tenant_key']);
      output = {
        alerts: await service.listAlerts(text(input, 'tenant_key')),
        deliveries: await service.listDeliveries(text(input, 'tenant_key')),
      };
      break;
    case 'shadow-status':
      exactKeys(input, ['tenant_key', 'from', 'to']);
      output = await service.shadowBaseline(text(input, 'tenant_key'), {
        from: text(input, 'from'),
        to: text(input, 'to'),
      });
      break;
    default:
      throw new ProactiveAlertError('unknown_operator_command', 'operator command is not supported', 400);
  }
  console.log(JSON.stringify({ status: 'ok', command, result: output }, null, 2));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const code = error instanceof ProactiveAlertError ? error.code : 'proactive_operator_failed';
    console.error(JSON.stringify({ status: 'blocked', code }));
    process.exitCode = 2;
  }).finally(() => db.destroy());
}
