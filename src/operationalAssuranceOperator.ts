import fs from 'node:fs';
import path from 'node:path';
import { db } from './db/knex';
import { OperationalAssuranceError } from './domain/operationalAssurance';
import { validateOperationalAssurancePolicy } from './domain/operationalAssurancePolicy';
import { buildActionAdapterRegistry } from './integrations/actions/buildActionAdapterRegistry';
import { OperationalAssuranceRepository } from './repositories/operationalAssuranceRepository';
import { OperationalAssuranceService } from './services/operationalAssuranceService';
import { phase5RuntimeIdentityIssues } from './phase5Preflight';

type Input = Record<string, unknown>;

function readJson(file: string): Input {
  const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OperationalAssuranceError('invalid_operator_input', 'operator input must be a JSON object', 400);
  }
  return value as Input;
}

function exactKeys(input: Input, keys: readonly string[]): void {
  const expected = new Set(keys);
  const extra = Object.keys(input).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in input));
  if (extra.length || missing.length) {
    throw new OperationalAssuranceError(
      'invalid_operator_input',
      `operator input keys mismatch; missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`,
      400,
    );
  }
}

function text(input: Input, key: string): string {
  if (typeof input[key] !== 'string') {
    throw new OperationalAssuranceError('invalid_operator_input', `${key} must be a string`, 400);
  }
  return input[key] as string;
}

function credential(
  name: 'LEOZOPS_PHASE5_AUTHORITY_CREDENTIAL' | 'LEOZOPS_PHASE5_ASSESSOR_CREDENTIAL' | 'LEOZOPS_PHASE5_REVIEWER_CREDENTIAL',
): string {
  const value = process.env[name];
  if (!value) throw new OperationalAssuranceError('missing_operator_credential', `${name} is required`, 403);
  return value;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const inputFile = process.argv[3];
  if (!command || !inputFile) {
    throw new OperationalAssuranceError(
      'missing_operator_command',
      'usage: npm run assurance:operator -- <command> <input.json>',
      400,
    );
  }
  const input = readJson(inputFile);
  const repository = new OperationalAssuranceRepository(db);
  const service = new OperationalAssuranceService(repository, buildActionAdapterRegistry());
  let output: unknown;

  switch (command) {
    case 'accept-policy': {
      exactKeys(input, ['policy_file']);
      const policy = readJson(text(input, 'policy_file'));
      const initial = validateOperationalAssurancePolicy(policy);
      if (!initial.ok || !initial.value) {
        throw new OperationalAssuranceError('invalid_assurance_policy', initial.issues.join('; '), 400);
      }
      const issues = phase5RuntimeIdentityIssues(initial.value);
      if (issues.length) throw new OperationalAssuranceError('assurance_runtime_mismatch', issues.join('; '), 403);
      output = await service.acceptPolicy(policy, credential('LEOZOPS_PHASE5_AUTHORITY_CREDENTIAL'));
      break;
    }
    case 'assess': {
      exactKeys(input, ['policy_id', 'assessment_key', 'actor']);
      output = await service.assess({
        policyId: text(input, 'policy_id'),
        assessmentKey: text(input, 'assessment_key'),
        actor: text(input, 'actor'),
        assessorCredential: credential('LEOZOPS_PHASE5_ASSESSOR_CREDENTIAL'),
      });
      break;
    }
    case 'package': {
      exactKeys(input, ['policy_id', 'assessment_key', 'package_key', 'actor']);
      output = await service.createReleasePackage({
        policyId: text(input, 'policy_id'),
        assessmentKey: text(input, 'assessment_key'),
        packageKey: text(input, 'package_key'),
        actor: text(input, 'actor'),
        reviewerCredential: credential('LEOZOPS_PHASE5_REVIEWER_CREDENTIAL'),
      });
      break;
    }
    case 'status': {
      exactKeys(input, ['policy_id']);
      output = await service.status(text(input, 'policy_id'));
      break;
    }
    default:
      throw new OperationalAssuranceError('unknown_operator_command', 'operator command is not supported', 400);
  }
  console.log(JSON.stringify({ status: 'ok', command, result: output }, null, 2));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const code = error instanceof OperationalAssuranceError ? error.code : 'assurance_operator_failed';
    console.error(JSON.stringify({ status: 'blocked', code }, null, 2));
    process.exitCode = 2;
  }).finally(() => db.destroy());
}
