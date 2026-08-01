import fs from 'node:fs';
import path from 'node:path';
import { db } from './db/knex';
import { ActivationExecutionError } from './domain/activationExecution';
import { validateActivationExecutionPolicy } from './domain/activationExecutionPolicy';
import { buildActionAdapterRegistry } from './integrations/actions/buildActionAdapterRegistry';
import { buildActivationExecutionAdapterRegistry } from './integrations/actions/activationExecutionAdapterRegistry';
import { ActivationCeremonyRepository } from './repositories/activationCeremonyRepository';
import { ActivationExecutionRepository } from './repositories/activationExecutionRepository';
import { ExternalEvidenceRepository } from './repositories/externalEvidenceRepository';
import { ActivationCeremonyService } from './services/activationCeremonyService';
import { ActivationExecutionService } from './services/activationExecutionService';
import { ExternalEvidenceService } from './services/externalEvidenceService';
import { phase8RuntimeIdentityIssues } from './phase8Preflight';

type Input = Record<string, unknown>;
type CredentialName =
  | 'LEOZOPS_PHASE8_RELEASE_CREDENTIAL'
  | 'LEOZOPS_PHASE8_EXECUTOR_CREDENTIAL'
  | 'LEOZOPS_PHASE8_OBSERVER_CREDENTIAL'
  | 'LEOZOPS_PHASE8_ROLLBACK_CREDENTIAL';

function readJson(file: string): Input {
  const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ActivationExecutionError('invalid_operator_input', 'operator input must be a JSON object', 400);
  }
  return value as Input;
}

function exactKeys(input: Input, keys: readonly string[]): void {
  const expected = new Set(keys);
  const extra = Object.keys(input).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in input));
  if (extra.length || missing.length) {
    throw new ActivationExecutionError(
      'invalid_operator_input',
      `operator input keys mismatch; missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`,
      400,
    );
  }
}

function text(input: Input, key: string): string {
  if (typeof input[key] !== 'string') {
    throw new ActivationExecutionError('invalid_operator_input', `${key} must be a string`, 400);
  }
  return input[key] as string;
}

function credential(name: CredentialName): string {
  const value = process.env[name];
  if (!value) throw new ActivationExecutionError('missing_operator_credential', `${name} is required`, 403);
  return value;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const inputFile = process.argv[3];
  if (!command || !inputFile) {
    throw new ActivationExecutionError(
      'missing_operator_command',
      'usage: npm run activation:operator -- <command> <input.json>',
      400,
    );
  }
  const input = readJson(inputFile);
  const actionRegistry = buildActionAdapterRegistry();
  const activationRegistry = buildActivationExecutionAdapterRegistry();
  const repository = new ActivationExecutionRepository(db);
  const ceremonyRepository = new ActivationCeremonyRepository(db);
  const external = new ExternalEvidenceService(new ExternalEvidenceRepository(db), actionRegistry);
  const ceremony = new ActivationCeremonyService(ceremonyRepository, external, actionRegistry);
  const service = new ActivationExecutionService(repository, ceremony, activationRegistry);
  let output: unknown;
  switch (command) {
    case 'accept-policy': {
      exactKeys(input, ['policy_file']);
      const policy = readJson(text(input, 'policy_file'));
      const initial = validateActivationExecutionPolicy(policy);
      if (!initial.ok || !initial.value) {
        throw new ActivationExecutionError('invalid_activation_execution_policy', initial.issues.join('; '), 400);
      }
      const issues = phase8RuntimeIdentityIssues(initial.value);
      if (issues.length) throw new ActivationExecutionError('activation_execution_runtime_mismatch', issues.join('; '), 403);
      output = await service.acceptPolicy(policy, credential('LEOZOPS_PHASE8_RELEASE_CREDENTIAL'));
      break;
    }
    case 'preview':
      exactKeys(input, ['policy_id', 'preview_key', 'actor']);
      output = await service.preview({
        policyId: text(input, 'policy_id'),
        previewKey: text(input, 'preview_key'),
        actor: text(input, 'actor'),
        executorCredential: credential('LEOZOPS_PHASE8_EXECUTOR_CREDENTIAL'),
      });
      break;
    case 'release':
      exactKeys(input, ['policy_id', 'release_key', 'reason_code', 'release_actor', 'observer_actor']);
      output = await service.release({
        policyId: text(input, 'policy_id'),
        releaseKey: text(input, 'release_key'),
        reasonCode: text(input, 'reason_code'),
        releaseActor: text(input, 'release_actor'),
        releaseCredential: credential('LEOZOPS_PHASE8_RELEASE_CREDENTIAL'),
        observerActor: text(input, 'observer_actor'),
        observerCredential: credential('LEOZOPS_PHASE8_OBSERVER_CREDENTIAL'),
      });
      break;
    case 'activate':
      exactKeys(input, ['policy_id', 'activation_key', 'actor']);
      output = await service.activate({
        policyId: text(input, 'policy_id'),
        activationKey: text(input, 'activation_key'),
        actor: text(input, 'actor'),
        executorCredential: credential('LEOZOPS_PHASE8_EXECUTOR_CREDENTIAL'),
      });
      break;
    case 'reconcile-expired-claim':
      exactKeys(input, ['policy_id', 'actor']);
      output = await service.reconcileExpiredClaim({
        policyId: text(input, 'policy_id'),
        actor: text(input, 'actor'),
        observerCredential: credential('LEOZOPS_PHASE8_OBSERVER_CREDENTIAL'),
      });
      break;
    case 'observe':
      exactKeys(input, ['policy_id', 'observation_key', 'actor']);
      output = await service.observe({
        policyId: text(input, 'policy_id'),
        observationKey: text(input, 'observation_key'),
        actor: text(input, 'actor'),
        observerCredential: credential('LEOZOPS_PHASE8_OBSERVER_CREDENTIAL'),
      });
      break;
    case 'rollback':
      exactKeys(input, [
        'policy_id', 'rollback_key', 'reason_code', 'authority_actor', 'rollback_actor',
      ]);
      output = await service.rollback({
        policyId: text(input, 'policy_id'),
        rollbackKey: text(input, 'rollback_key'),
        reasonCode: text(input, 'reason_code'),
        authorityActor: text(input, 'authority_actor'),
        authorityCredential: credential('LEOZOPS_PHASE8_RELEASE_CREDENTIAL'),
        rollbackActor: text(input, 'rollback_actor'),
        rollbackCredential: credential('LEOZOPS_PHASE8_ROLLBACK_CREDENTIAL'),
      });
      break;
    case 'readiness':
      exactKeys(input, ['policy_id']);
      output = await service.readiness(text(input, 'policy_id'));
      break;
    case 'status':
      exactKeys(input, ['policy_id']);
      output = await service.status(text(input, 'policy_id'));
      break;
    default:
      throw new ActivationExecutionError('unknown_operator_command', 'operator command is not supported', 400);
  }
  console.log(JSON.stringify({ status: 'ok', command, result: output }, null, 2));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const code = error instanceof ActivationExecutionError ? error.code : 'activation_execution_operator_failed';
    console.error(JSON.stringify({ status: 'blocked', code }, null, 2));
    process.exitCode = 2;
  }).finally(() => db.destroy());
}
