import fs from 'node:fs';
import path from 'node:path';
import { db } from './db/knex';
import { G6ActionPolicyManifest, validateG6ActionPolicy } from './domain/g6Policy';
import { SupervisedActionError } from './domain/supervisedAction';
import { buildActionAdapterRegistry } from './integrations/actions/buildActionAdapterRegistry';
import { SupervisedActionRepository } from './repositories/supervisedActionRepository';
import { SupervisedActionService } from './services/supervisedActionService';
import { runtimeIdentityIssues } from './g6Preflight';

type Input = Record<string, unknown>;

function readJson(file: string): Input {
  const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SupervisedActionError('invalid_operator_input', 'operator input must be a JSON object');
  }
  return value as Input;
}

function exactKeys(input: Input, keys: readonly string[]): void {
  const expected = new Set(keys);
  const extras = Object.keys(input).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in input));
  if (extras.length > 0 || missing.length > 0) {
    throw new SupervisedActionError(
      'invalid_operator_input',
      `operator input keys mismatch; missing=${missing.join(',') || 'none'} extra=${extras.join(',') || 'none'}`,
    );
  }
}

function text(input: Input, key: string): string {
  const value = input[key];
  if (typeof value !== 'string') {
    throw new SupervisedActionError('invalid_operator_input', `${key} must be a string`);
  }
  return value;
}

function integer(input: Input, key: string): number {
  const value = input[key];
  if (!Number.isInteger(value)) {
    throw new SupervisedActionError('invalid_operator_input', `${key} must be an integer`);
  }
  return Number(value);
}

function stringArray(input: Input, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new SupervisedActionError('invalid_operator_input', `${key} must be an array of strings`);
  }
  return value;
}

function credential(name: 'LEOZOPS_ACTION_APPROVAL_CREDENTIAL' | 'LEOZOPS_ACTION_OPERATOR_CREDENTIAL'): string {
  const value = process.env[name];
  if (!value) throw new SupervisedActionError('missing_operator_credential', `${name} is required`);
  return value;
}

function assertRuntime(policy: G6ActionPolicyManifest): void {
  const issues = runtimeIdentityIssues(policy);
  if (issues.length > 0) {
    throw new SupervisedActionError('action_runtime_mismatch', issues.join('; '));
  }
}

async function policyForProposal(repository: SupervisedActionRepository, proposalId: string) {
  const proposal = await repository.findProposal(proposalId);
  const policy = await repository.findPolicyByPolicyId(proposal.policy_id);
  assertRuntime(policy.manifest);
  return { proposal, ...policy };
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const inputFile = process.argv[3];
  if (!command || !inputFile) {
    throw new SupervisedActionError(
      'missing_operator_command',
      'usage: npm run action:operator -- <command> <input.json>',
    );
  }
  const input = readJson(inputFile);
  const repository = new SupervisedActionRepository(db);
  const service = new SupervisedActionService(repository, buildActionAdapterRegistry());
  let output: unknown;

  switch (command) {
    case 'accept-policy': {
      exactKeys(input, ['policy_file']);
      const policy = readJson(text(input, 'policy_file'));
      const validation = validateG6ActionPolicy(policy);
      if (!validation.ok || !validation.value) {
        throw new SupervisedActionError('invalid_action_policy', validation.issues.join('; '));
      }
      assertRuntime(validation.value);
      output = await service.acceptPolicy(policy);
      break;
    }
    case 'propose': {
      exactKeys(input, [
        'policy_id',
        'payload',
        'reason_code',
        'expected_impact_code',
        'evidence_refs',
        'estimated_cost_minor',
        'currency',
        'idempotency_key',
        'requested_by',
        'expires_at',
      ]);
      const policy = await repository.findPolicyByPolicyId(text(input, 'policy_id'));
      assertRuntime(policy.manifest);
      output = await service.propose({
        policyId: text(input, 'policy_id'),
        payload: input.payload,
        reasonCode: text(input, 'reason_code'),
        expectedImpactCode: text(input, 'expected_impact_code'),
        evidenceRefs: stringArray(input, 'evidence_refs'),
        estimatedCostMinor: integer(input, 'estimated_cost_minor'),
        currency: text(input, 'currency'),
        idempotencyKey: text(input, 'idempotency_key'),
        requestedBy: text(input, 'requested_by'),
        expiresAt: text(input, 'expires_at'),
      });
      break;
    }
    case 'preview':
    case 'preview-rollback': {
      exactKeys(input, ['proposal_id', 'operator']);
      await policyForProposal(repository, text(input, 'proposal_id'));
      const args = {
        proposalId: text(input, 'proposal_id'),
        operator: text(input, 'operator'),
        operatorCredential: credential('LEOZOPS_ACTION_OPERATOR_CREDENTIAL'),
      };
      output = command === 'preview' ? await service.preview(args) : await service.previewRollback(args);
      break;
    }
    case 'decide': {
      exactKeys(input, [
        'proposal_id',
        'kind',
        'decision',
        'approver',
        'reason_code',
        'nonce',
        'max_cost_minor',
      ]);
      await policyForProposal(repository, text(input, 'proposal_id'));
      const kind = text(input, 'kind');
      const decision = text(input, 'decision');
      if (kind !== 'execute' && kind !== 'rollback') {
        throw new SupervisedActionError('invalid_operator_input', 'kind must equal execute or rollback');
      }
      if (decision !== 'approved' && decision !== 'rejected') {
        throw new SupervisedActionError('invalid_operator_input', 'decision must equal approved or rejected');
      }
      output = await service.decide({
        proposalId: text(input, 'proposal_id'),
        kind,
        decision,
        approver: text(input, 'approver'),
        approvalCredential: credential('LEOZOPS_ACTION_APPROVAL_CREDENTIAL'),
        reasonCode: text(input, 'reason_code'),
        nonce: text(input, 'nonce'),
        maxCostMinor: integer(input, 'max_cost_minor'),
      });
      break;
    }
    case 'execute':
    case 'rollback': {
      exactKeys(input, ['proposal_id', 'operator']);
      await policyForProposal(repository, text(input, 'proposal_id'));
      const args = {
        proposalId: text(input, 'proposal_id'),
        operator: text(input, 'operator'),
        operatorCredential: credential('LEOZOPS_ACTION_OPERATOR_CREDENTIAL'),
      };
      output = command === 'execute' ? await service.execute(args) : await service.rollback(args);
      break;
    }
    case 'reconcile': {
      exactKeys(input, ['proposal_id', 'kind', 'operator']);
      const proposal = await repository.findProposal(text(input, 'proposal_id'));
      const policy = await repository.findPolicyByPolicyId(proposal.policy_id);
      assertRuntime(policy.manifest);
      const kind = text(input, 'kind');
      if (kind !== 'execute' && kind !== 'rollback') {
        throw new SupervisedActionError('invalid_operator_input', 'kind must equal execute or rollback');
      }
      output = await service.reconcileExpiredAttempt({
        proposalId: proposal.id,
        kind,
        operator: text(input, 'operator'),
        operatorCredential: credential('LEOZOPS_ACTION_OPERATOR_CREDENTIAL'),
      });
      break;
    }
    case 'status': {
      exactKeys(input, ['proposal_id']);
      output = await service.status(text(input, 'proposal_id'));
      break;
    }
    default:
      throw new SupervisedActionError('unknown_operator_command', 'operator command is not supported');
  }

  console.log(JSON.stringify({ status: 'ok', command, result: output }, null, 2));
  const attempt = output && typeof output === 'object'
    ? ('attempt' in output
      ? (output as { attempt?: { status?: string } }).attempt
      : ('status' in output ? output as { status?: string } : undefined))
    : undefined;
  if (attempt?.status === 'failed') process.exitCode = 1;
  if (attempt?.status === 'reconciliation_required') process.exitCode = 3;
}

if (require.main === module) {
  main()
    .catch((error: unknown) => {
      const code = error instanceof SupervisedActionError ? error.code : 'operator_failed';
      console.error(JSON.stringify({ status: 'blocked', code }, null, 2));
      process.exitCode = 2;
    })
    .finally(() => db.destroy());
}
