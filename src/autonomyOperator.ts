import fs from 'node:fs';
import path from 'node:path';
import { db } from './db/knex';
import { BoundedAutonomyError } from './domain/boundedAutonomy';
import { validateG7Policy } from './domain/g7Policy';
import { buildActionAdapterRegistry } from './integrations/actions/buildActionAdapterRegistry';
import { BoundedAutonomyRepository } from './repositories/boundedAutonomyRepository';
import { BoundedAutonomyService } from './services/boundedAutonomyService';
import { g7RuntimeIdentityIssues } from './g7Preflight';
import { runtimeIdentityIssues as g6RuntimeIdentityIssues } from './g6Preflight';

type Input = Record<string, unknown>;

function readJson(file: string): Input {
  const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BoundedAutonomyError('invalid_operator_input', 'operator input must be a JSON object', 400);
  }
  return value as Input;
}

function exactKeys(input: Input, keys: readonly string[]): void {
  const expected = new Set(keys);
  const extra = Object.keys(input).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in input));
  if (extra.length || missing.length) {
    throw new BoundedAutonomyError(
      'invalid_operator_input',
      `operator input keys mismatch; missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`,
      400,
    );
  }
}

function text(input: Input, key: string): string {
  if (typeof input[key] !== 'string') throw new BoundedAutonomyError('invalid_operator_input', `${key} must be a string`, 400);
  return input[key] as string;
}

function stringArray(input: Input, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new BoundedAutonomyError('invalid_operator_input', `${key} must be an array of strings`, 400);
  }
  return value as string[];
}

function integer(input: Input, key: string): number {
  const value = input[key];
  if (!Number.isInteger(value)) throw new BoundedAutonomyError('invalid_operator_input', `${key} must be an integer`, 400);
  return Number(value);
}

function credential(name: 'LEOZOPS_G7_RELEASE_CREDENTIAL' | 'LEOZOPS_G7_EXECUTOR_CREDENTIAL' | 'LEOZOPS_G7_KILL_SWITCH_CREDENTIAL'): string {
  const value = process.env[name];
  if (!value) throw new BoundedAutonomyError('missing_operator_credential', `${name} is required`, 403);
  return value;
}

async function assertRuntime(repository: BoundedAutonomyRepository, policyId: string): Promise<void> {
  const found = await repository.findPolicy(policyId);
  const issues = [
    ...g7RuntimeIdentityIssues(found.manifest),
    ...g6RuntimeIdentityIssues(found.g6.manifest),
  ];
  if (issues.length) throw new BoundedAutonomyError('autonomy_runtime_mismatch', issues.join('; '), 403);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const inputFile = process.argv[3];
  if (!command || !inputFile) {
    throw new BoundedAutonomyError('missing_operator_command', 'usage: npm run autonomy:operator -- <command> <input.json>', 400);
  }
  const input = readJson(inputFile);
  const repository = new BoundedAutonomyRepository(db);
  const service = new BoundedAutonomyService(repository, buildActionAdapterRegistry());
  let output: unknown;

  switch (command) {
    case 'simulate-policy': {
      exactKeys(input, ['policy_file', 'simulated_by']);
      const policy = readJson(text(input, 'policy_file'));
      const validation = validateG7Policy(policy);
      if (!validation.ok || !validation.value) throw new BoundedAutonomyError('invalid_g7_policy', validation.issues.join('; '), 400);
      output = await service.simulatePolicy(policy, text(input, 'simulated_by'));
      break;
    }
    case 'accept-policy': {
      exactKeys(input, ['policy_file']);
      const policy = readJson(text(input, 'policy_file'));
      const validation = validateG7Policy(policy);
      if (!validation.ok || !validation.value) throw new BoundedAutonomyError('invalid_g7_policy', validation.issues.join('; '), 400);
      const g6 = await repository.findG6Policy(validation.value.g6_policy.policy_id);
      const issues = [
        ...g7RuntimeIdentityIssues(validation.value),
        ...g6RuntimeIdentityIssues(g6.manifest),
      ];
      if (issues.length) throw new BoundedAutonomyError('autonomy_runtime_mismatch', issues.join('; '), 403);
      output = await service.acceptPolicy(policy, credential('LEOZOPS_G7_RELEASE_CREDENTIAL'));
      break;
    }
    case 'release-kill-switch': {
      exactKeys(input, ['policy_id', 'actor', 'reason_code']);
      await assertRuntime(repository, text(input, 'policy_id'));
      output = await service.releaseKillSwitch({
        policyId: text(input, 'policy_id'),
        actor: text(input, 'actor'),
        releaseCredential: credential('LEOZOPS_G7_RELEASE_CREDENTIAL'),
        killSwitchCredential: credential('LEOZOPS_G7_KILL_SWITCH_CREDENTIAL'),
        reasonCode: text(input, 'reason_code'),
      });
      break;
    }
    case 'engage-kill-switch': {
      exactKeys(input, ['policy_id', 'actor', 'reason_code']);
      output = await service.engageKillSwitch({
        policyId: text(input, 'policy_id'),
        actor: text(input, 'actor'),
        killSwitchCredential: credential('LEOZOPS_G7_KILL_SWITCH_CREDENTIAL'),
        reasonCode: text(input, 'reason_code'),
      });
      break;
    }
    case 'resolve-incident': {
      exactKeys(input, ['policy_id', 'incident_id', 'actor', 'reason_code', 'evidence_refs']);
      await assertRuntime(repository, text(input, 'policy_id'));
      output = await service.resolveIncident({
        policyId: text(input, 'policy_id'),
        incidentId: text(input, 'incident_id'),
        actor: text(input, 'actor'),
        releaseCredential: credential('LEOZOPS_G7_RELEASE_CREDENTIAL'),
        killSwitchCredential: credential('LEOZOPS_G7_KILL_SWITCH_CREDENTIAL'),
        reasonCode: text(input, 'reason_code'),
        evidenceRefs: stringArray(input, 'evidence_refs'),
      });
      break;
    }
    case 'run': {
      exactKeys(input, ['policy_id', 'payload', 'reason_code', 'evidence_refs', 'idempotency_key', 'executor']);
      await assertRuntime(repository, text(input, 'policy_id'));
      output = await service.runCandidate({
        policyId: text(input, 'policy_id'),
        payload: input.payload,
        reasonCode: text(input, 'reason_code'),
        evidenceRefs: stringArray(input, 'evidence_refs'),
        idempotencyKey: text(input, 'idempotency_key'),
        executor: text(input, 'executor'),
        executorCredential: credential('LEOZOPS_G7_EXECUTOR_CREDENTIAL'),
      });
      break;
    }
    case 'reconcile': {
      exactKeys(input, ['policy_id', 'evaluation_id', 'actor']);
      await assertRuntime(repository, text(input, 'policy_id'));
      output = await service.reconcileExpiredAttempt({
        policyId: text(input, 'policy_id'),
        evaluationId: text(input, 'evaluation_id'),
        actor: text(input, 'actor'),
        executorCredential: credential('LEOZOPS_G7_EXECUTOR_CREDENTIAL'),
      });
      break;
    }
    case 'preview-recovery': {
      exactKeys(input, ['policy_id', 'subject_attempt_id', 'actor']);
      await assertRuntime(repository, text(input, 'policy_id'));
      output = await service.previewRecovery({
        policyId: text(input, 'policy_id'),
        subjectAttemptId: text(input, 'subject_attempt_id'),
        actor: text(input, 'actor'),
        executorCredential: credential('LEOZOPS_G7_EXECUTOR_CREDENTIAL'),
      });
      break;
    }
    case 'decide-recovery': {
      exactKeys(input, [
        'policy_id', 'subject_attempt_id', 'decision', 'actor', 'reason_code', 'nonce', 'max_cost_minor',
      ]);
      await assertRuntime(repository, text(input, 'policy_id'));
      const decision = text(input, 'decision');
      if (decision !== 'approved' && decision !== 'rejected') {
        throw new BoundedAutonomyError('invalid_operator_input', 'decision must equal approved or rejected', 400);
      }
      output = await service.decideRecovery({
        policyId: text(input, 'policy_id'),
        subjectAttemptId: text(input, 'subject_attempt_id'),
        decision,
        actor: text(input, 'actor'),
        releaseCredential: credential('LEOZOPS_G7_RELEASE_CREDENTIAL'),
        killSwitchCredential: credential('LEOZOPS_G7_KILL_SWITCH_CREDENTIAL'),
        reasonCode: text(input, 'reason_code'),
        nonce: text(input, 'nonce'),
        maxCostMinor: integer(input, 'max_cost_minor'),
      });
      break;
    }
    case 'recover': {
      exactKeys(input, ['policy_id', 'subject_attempt_id', 'actor']);
      await assertRuntime(repository, text(input, 'policy_id'));
      output = await service.recover({
        policyId: text(input, 'policy_id'),
        subjectAttemptId: text(input, 'subject_attempt_id'),
        actor: text(input, 'actor'),
        executorCredential: credential('LEOZOPS_G7_EXECUTOR_CREDENTIAL'),
      });
      break;
    }
    case 'reconcile-recovery': {
      exactKeys(input, ['policy_id', 'subject_attempt_id', 'actor']);
      await assertRuntime(repository, text(input, 'policy_id'));
      output = await service.reconcileExpiredRecovery({
        policyId: text(input, 'policy_id'),
        subjectAttemptId: text(input, 'subject_attempt_id'),
        actor: text(input, 'actor'),
        executorCredential: credential('LEOZOPS_G7_EXECUTOR_CREDENTIAL'),
      });
      break;
    }
    case 'status': {
      exactKeys(input, ['policy_id']);
      output = await service.status(text(input, 'policy_id'));
      break;
    }
    default:
      throw new BoundedAutonomyError('unknown_operator_command', 'operator command is not supported', 400);
  }

  console.log(JSON.stringify({ status: 'ok', command, result: output }, null, 2));
  const attempt = output && typeof output === 'object' && 'attempt' in output
    ? (output as { attempt?: { status?: string } }).attempt
    : output as { status?: string } | undefined;
  if (attempt?.status === 'failed') process.exitCode = 1;
  if (attempt?.status === 'reconciliation_required') process.exitCode = 3;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const code = error instanceof BoundedAutonomyError ? error.code : 'autonomy_operator_failed';
    console.error(JSON.stringify({ status: 'blocked', code }, null, 2));
    process.exitCode = 2;
  }).finally(() => db.destroy());
}
