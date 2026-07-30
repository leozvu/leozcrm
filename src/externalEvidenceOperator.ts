import fs from 'node:fs';
import path from 'node:path';
import { db } from './db/knex';
import { ExternalEvidenceError } from './domain/externalEvidence';
import { validateExternalEvidencePolicy } from './domain/externalEvidencePolicy';
import { buildActionAdapterRegistry } from './integrations/actions/buildActionAdapterRegistry';
import { ExternalEvidenceRepository } from './repositories/externalEvidenceRepository';
import { ExternalEvidenceService } from './services/externalEvidenceService';
import { phase6RuntimeIdentityIssues } from './phase6Preflight';

type Input = Record<string, unknown>;

function readJson(file: string): Input {
  const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ExternalEvidenceError('invalid_operator_input', 'operator input must be a JSON object', 400);
  }
  return value as Input;
}

function exactKeys(input: Input, keys: readonly string[]): void {
  const expected = new Set(keys);
  const extra = Object.keys(input).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in input));
  if (extra.length || missing.length) {
    throw new ExternalEvidenceError(
      'invalid_operator_input',
      `operator input keys mismatch; missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`,
      400,
    );
  }
}

function text(input: Input, key: string): string {
  if (typeof input[key] !== 'string') {
    throw new ExternalEvidenceError('invalid_operator_input', `${key} must be a string`, 400);
  }
  return input[key] as string;
}

function credential(name: 'LEOZOPS_PHASE6_AUTHORITY_CREDENTIAL' | 'LEOZOPS_PHASE6_ASSESSOR_CREDENTIAL'): string {
  const value = process.env[name];
  if (!value) throw new ExternalEvidenceError('missing_operator_credential', `${name} is required`, 403);
  return value;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const inputFile = process.argv[3];
  if (!command || !inputFile) {
    throw new ExternalEvidenceError('missing_operator_command', 'usage: npm run evidence:operator -- <command> <input.json>', 400);
  }
  const input = readJson(inputFile);
  const repository = new ExternalEvidenceRepository(db);
  const service = new ExternalEvidenceService(repository, buildActionAdapterRegistry());
  let output: unknown;
  switch (command) {
    case 'accept-policy': {
      exactKeys(input, ['policy_file']);
      const policy = readJson(text(input, 'policy_file'));
      const initial = validateExternalEvidencePolicy(policy);
      if (!initial.ok || !initial.value) {
        throw new ExternalEvidenceError('invalid_external_evidence_policy', initial.issues.join('; '), 400);
      }
      const issues = phase6RuntimeIdentityIssues(initial.value);
      if (issues.length) throw new ExternalEvidenceError('external_evidence_runtime_mismatch', issues.join('; '), 403);
      output = await service.acceptPolicy(policy, credential('LEOZOPS_PHASE6_AUTHORITY_CREDENTIAL'));
      break;
    }
    case 'admit': {
      exactKeys(input, ['policy_id', 'envelope_file', 'actor']);
      output = await service.admit({
        policyId: text(input, 'policy_id'),
        envelope: readJson(text(input, 'envelope_file')),
        actor: text(input, 'actor'),
        assessorCredential: credential('LEOZOPS_PHASE6_ASSESSOR_CREDENTIAL'),
      });
      break;
    }
    case 'assess': {
      exactKeys(input, ['policy_id', 'assessment_key', 'actor']);
      output = await service.assess({
        policyId: text(input, 'policy_id'),
        assessmentKey: text(input, 'assessment_key'),
        actor: text(input, 'actor'),
        assessorCredential: credential('LEOZOPS_PHASE6_ASSESSOR_CREDENTIAL'),
      });
      break;
    }
    case 'status': {
      exactKeys(input, ['policy_id']);
      output = await service.status(text(input, 'policy_id'));
      break;
    }
    default:
      throw new ExternalEvidenceError('unknown_operator_command', 'operator command is not supported', 400);
  }
  console.log(JSON.stringify({ status: 'ok', command, result: output }, null, 2));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const code = error instanceof ExternalEvidenceError ? error.code : 'external_evidence_operator_failed';
    console.error(JSON.stringify({ status: 'blocked', code }, null, 2));
    process.exitCode = 2;
  }).finally(() => db.destroy());
}
