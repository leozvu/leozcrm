import fs from 'node:fs';
import path from 'node:path';
import { db } from './db/knex';
import { ActivationCeremonyError } from './domain/activationCeremony';
import { validateActivationCeremonyPolicy } from './domain/activationCeremonyPolicy';
import { buildActionAdapterRegistry } from './integrations/actions/buildActionAdapterRegistry';
import { ActivationCeremonyRepository } from './repositories/activationCeremonyRepository';
import { ExternalEvidenceRepository } from './repositories/externalEvidenceRepository';
import { ActivationCeremonyService } from './services/activationCeremonyService';
import { ExternalEvidenceService } from './services/externalEvidenceService';
import { phase7RuntimeIdentityIssues } from './phase7Preflight';

type Input = Record<string, unknown>;
type CredentialName =
  | 'LEOZOPS_PHASE7_AUTHORITY_CREDENTIAL'
  | 'LEOZOPS_PHASE7_VERIFIER_CREDENTIAL'
  | 'LEOZOPS_PHASE7_OPERATOR_CREDENTIAL';

function readJson(file: string): Input {
  const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ActivationCeremonyError('invalid_operator_input', 'operator input must be a JSON object', 400);
  }
  return value as Input;
}

function exactKeys(input: Input, keys: readonly string[]): void {
  const expected = new Set(keys);
  const extra = Object.keys(input).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in input));
  if (extra.length || missing.length) {
    throw new ActivationCeremonyError(
      'invalid_operator_input',
      `operator input keys mismatch; missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`,
      400,
    );
  }
}

function text(input: Input, key: string): string {
  if (typeof input[key] !== 'string') {
    throw new ActivationCeremonyError('invalid_operator_input', `${key} must be a string`, 400);
  }
  return input[key] as string;
}

function decision(input: Input): 'approved' | 'rejected' {
  const value = text(input, 'decision');
  if (value !== 'approved' && value !== 'rejected') {
    throw new ActivationCeremonyError('invalid_operator_input', 'decision must be approved or rejected', 400);
  }
  return value;
}

function credential(name: CredentialName): string {
  const value = process.env[name];
  if (!value) throw new ActivationCeremonyError('missing_operator_credential', `${name} is required`, 403);
  return value;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const inputFile = process.argv[3];
  if (!command || !inputFile) {
    throw new ActivationCeremonyError('missing_operator_command', 'usage: npm run ceremony:operator -- <command> <input.json>', 400);
  }
  const input = readJson(inputFile);
  const registry = buildActionAdapterRegistry();
  const repository = new ActivationCeremonyRepository(db);
  const external = new ExternalEvidenceService(new ExternalEvidenceRepository(db), registry);
  const service = new ActivationCeremonyService(repository, external, registry);
  let output: unknown;
  switch (command) {
    case 'accept-policy': {
      exactKeys(input, ['policy_file']);
      const policy = readJson(text(input, 'policy_file'));
      const initial = validateActivationCeremonyPolicy(policy);
      if (!initial.ok || !initial.value) {
        throw new ActivationCeremonyError('invalid_activation_policy', initial.issues.join('; '), 400);
      }
      const issues = phase7RuntimeIdentityIssues(initial.value);
      if (issues.length) throw new ActivationCeremonyError('activation_runtime_mismatch', issues.join('; '), 403);
      output = await service.acceptPolicy(policy, credential('LEOZOPS_PHASE7_AUTHORITY_CREDENTIAL'));
      break;
    }
    case 'create-dossier':
      exactKeys(input, ['policy_id', 'dossier_key', 'actor']);
      output = await service.createDossier({
        policyId: text(input, 'policy_id'),
        dossierKey: text(input, 'dossier_key'),
        actor: text(input, 'actor'),
        authorityCredential: credential('LEOZOPS_PHASE7_AUTHORITY_CREDENTIAL'),
      });
      break;
    case 'verify-dossier':
      exactKeys(input, ['policy_id', 'dossier_key', 'verification_key', 'decision', 'reason_code', 'actor']);
      output = await service.verifyDossier({
        policyId: text(input, 'policy_id'),
        dossierKey: text(input, 'dossier_key'),
        verificationKey: text(input, 'verification_key'),
        decision: decision(input),
        reasonCode: text(input, 'reason_code'),
        actor: text(input, 'actor'),
        verifierCredential: credential('LEOZOPS_PHASE7_VERIFIER_CREDENTIAL'),
      });
      break;
    case 'seal-handoff':
      exactKeys(input, ['policy_id', 'dossier_key', 'handoff_key', 'actor']);
      output = await service.sealHandoff({
        policyId: text(input, 'policy_id'),
        dossierKey: text(input, 'dossier_key'),
        handoffKey: text(input, 'handoff_key'),
        actor: text(input, 'actor'),
        operatorCredential: credential('LEOZOPS_PHASE7_OPERATOR_CREDENTIAL'),
      });
      break;
    case 'recall-handoff':
      exactKeys(input, [
        'policy_id', 'recall_key', 'reason_code', 'evidence_fingerprint',
        'authority_actor', 'verifier_actor',
      ]);
      output = await service.recallHandoff({
        policyId: text(input, 'policy_id'),
        recallKey: text(input, 'recall_key'),
        reasonCode: text(input, 'reason_code'),
        evidenceFingerprint: text(input, 'evidence_fingerprint'),
        authorityActor: text(input, 'authority_actor'),
        authorityCredential: credential('LEOZOPS_PHASE7_AUTHORITY_CREDENTIAL'),
        verifierActor: text(input, 'verifier_actor'),
        verifierCredential: credential('LEOZOPS_PHASE7_VERIFIER_CREDENTIAL'),
      });
      break;
    case 'status':
      exactKeys(input, ['policy_id']);
      output = await service.status(text(input, 'policy_id'));
      break;
    default:
      throw new ActivationCeremonyError('unknown_operator_command', 'operator command is not supported', 400);
  }
  console.log(JSON.stringify({ status: 'ok', command, result: output }, null, 2));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const code = error instanceof ActivationCeremonyError ? error.code : 'activation_ceremony_operator_failed';
    console.error(JSON.stringify({ status: 'blocked', code }, null, 2));
    process.exitCode = 2;
  }).finally(() => db.destroy());
}
