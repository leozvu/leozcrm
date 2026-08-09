import { createHash } from 'node:crypto';
import { evidenceFingerprint } from './phase2Proof';
import { SupervisedActionError, actionIso } from './supervisedAction';

export const SUPERVISED_HAND_QUALIFICATION_SCHEMA = 'leozops_supervised_hand_qualification_v2' as const;
export const REPOSITORYREALMS_TASK_CREATE_COMMAND = 'egoric.task.create.v1' as const;

export interface SupervisedHandSourceFile {
  path: string;
  git_blob_sha: string;
}

export interface SupervisedHandQualification {
  schema_version: typeof SUPERVISED_HAND_QUALIFICATION_SCHEMA;
  audited_at: string;
  repository: 'leozvu/repositoryrealms';
  source_ref: string;
  source_commit: string;
  source_state: 'working_tree' | 'committed_branch' | 'merged_main';
  source_patch_fingerprint: string;
  command_key: typeof REPOSITORYREALMS_TASK_CREATE_COMMAND;
  source_contract: 'repositoryrealms.leozops.task-command';
  source_contract_version: 1;
  endpoint_path: '/api/integrations/leozops/v1/commands/create-task';
  receipt_path: '/api/integrations/leozops/v1/commands/create-task/receipts';
  action: 'task.create';
  scope: 'leozops.task.create.execute';
  capability: 'delivery';
  payload_profile: 'unassigned_task_only';
  source_files: SupervisedHandSourceFile[];
  capabilities: {
    exact_payload_schema: boolean;
    provider_idempotency: boolean;
    atomic_receipt: boolean;
    receipt_observation: boolean;
    least_privilege_dispatch_scope: boolean;
    dedicated_leozops_command_endpoint: boolean;
    zero_mutation_preview: boolean;
    separately_approved_rollback: boolean;
    immutable_revision: boolean;
    canonical_main_release: boolean;
  };
  verdict: 'qualified' | 'blocked';
}

export interface RepositoryRealmsTaskCreatePayload {
  title: string;
  note?: string;
  due_date?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  estimated_hours?: number;
}

export interface RepositoryRealmsTaskCreateEnvelope {
  contract: 'repositoryrealms.leozops.task-command';
  version: 1;
  operation: 'preview';
  targetEntityId: string;
  actorSubject: string;
  idempotencyKey: string;
  correlationId: string;
  payload: {
    title: string;
    note: string | null;
    dueDate: string | null;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    estHours: number;
  };
}

const SOURCE_CAPABILITY_KEYS = [
  'exact_payload_schema',
  'provider_idempotency',
  'atomic_receipt',
  'receipt_observation',
  'least_privilege_dispatch_scope',
  'dedicated_leozops_command_endpoint',
  'zero_mutation_preview',
  'separately_approved_rollback',
  'immutable_revision',
  'canonical_main_release',
] as const;

const SOURCE_FILE_PATHS = [
  'app/api/integrations/leozops/v1/commands/create-task/receipts/route.js',
  'app/api/integrations/leozops/v1/commands/create-task/route.js',
  'lib/ceo-service-auth.js',
  'lib/leozops-task-command-admin.js',
  'lib/leozops-task-command.js',
  'prisma/migrations/20260808010000_add_leozops_task_command_contract/migration.sql',
  'prisma/schema.prisma',
] as const;

const REQUIRED_TRUE: readonly (keyof SupervisedHandQualification['capabilities'])[] = [
  ...SOURCE_CAPABILITY_KEYS,
];

const ROOT_KEYS = [
  'schema_version', 'audited_at', 'repository', 'source_ref', 'source_commit',
  'source_state', 'source_patch_fingerprint',
  'command_key', 'source_contract', 'source_contract_version', 'endpoint_path',
  'receipt_path', 'action', 'scope', 'capability', 'payload_profile', 'source_files',
  'capabilities', 'verdict',
] as const;

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,191}$/;
const SOURCE_COMMIT = /^[0-9a-f]{40}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const SOURCE_REF = /^(?:main|codex\/[a-z0-9][a-z0-9._/-]{2,127})$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?:^|[^A-Za-z0-9])\+?\d(?:[\s().-]*\d){7,}(?:[^A-Za-z0-9]|$)/;
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SupervisedActionError('invalid_hand_qualification', `${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = [...keys].sort().join('\0');
  if (Object.keys(value).sort().join('\0') !== expected) {
    throw new SupervisedActionError('invalid_hand_qualification', `${path} keys are invalid`);
  }
}

function text(value: unknown, path: string, min: number, max: number): string {
  if (
    typeof value !== 'string'
    || value.length < min
    || value.length > max
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) throw new SupervisedActionError('invalid_hand_qualification', `${path} is invalid`);
  return value;
}

function exactLiteral<T extends string | number>(value: unknown, expected: T, path: string): T {
  if (value !== expected) {
    throw new SupervisedActionError('invalid_hand_qualification', `${path} must equal ${expected}`);
  }
  return expected;
}

export function supervisedHandBlockers(
  qualification: Pick<SupervisedHandQualification, 'capabilities'>,
  registrySize = 0,
): string[] {
  const blockers = REQUIRED_TRUE
    .filter((key) => qualification.capabilities[key] !== true)
    .map((key) => `source_${key}_missing`);
  if (registrySize === 0) blockers.push('production_adapter_registry_empty');
  return blockers;
}

export function validateSupervisedHandQualification(input: unknown): {
  value: SupervisedHandQualification;
  fingerprint: string;
  blockers: string[];
} {
  const root = record(input, 'qualification');
  exactKeys(root, ROOT_KEYS, 'qualification');
  const capabilityRoot = record(root.capabilities, 'qualification.capabilities');
  exactKeys(capabilityRoot, SOURCE_CAPABILITY_KEYS, 'qualification.capabilities');
  const capabilities = Object.fromEntries(SOURCE_CAPABILITY_KEYS.map((key) => {
    if (typeof capabilityRoot[key] !== 'boolean') {
      throw new SupervisedActionError('invalid_hand_qualification', `qualification.capabilities.${key} must be boolean`);
    }
    return [key, capabilityRoot[key]];
  })) as unknown as SupervisedHandQualification['capabilities'];

  if (!Array.isArray(root.source_files) || root.source_files.length !== 7) {
    throw new SupervisedActionError('invalid_hand_qualification', 'qualification.source_files must contain seven pinned files');
  }
  const sourceFiles = root.source_files.map((item, index) => {
    const file = record(item, `qualification.source_files[${index}]`);
    exactKeys(file, ['path', 'git_blob_sha'], `qualification.source_files[${index}]`);
    const path = text(file.path, `qualification.source_files[${index}].path`, 3, 256);
    const gitBlobSha = text(file.git_blob_sha, `qualification.source_files[${index}].git_blob_sha`, 40, 40);
    if (!SOURCE_COMMIT.test(gitBlobSha)) {
      throw new SupervisedActionError('invalid_hand_qualification', 'source file SHA is invalid');
    }
    return { path, git_blob_sha: gitBlobSha };
  });
  if (new Set(sourceFiles.map((item) => item.path)).size !== sourceFiles.length) {
    throw new SupervisedActionError('invalid_hand_qualification', 'source file paths must be unique');
  }
  if (
    sourceFiles.map((item) => item.path).sort().join('\0')
    !== [...SOURCE_FILE_PATHS].sort().join('\0')
  ) {
    throw new SupervisedActionError('invalid_hand_qualification', 'qualification.source_files do not match the exact contract surface');
  }

  const sourceCommit = text(root.source_commit, 'qualification.source_commit', 40, 40);
  if (!SOURCE_COMMIT.test(sourceCommit)) {
    throw new SupervisedActionError('invalid_hand_qualification', 'qualification.source_commit is invalid');
  }
  const sourceRef = text(root.source_ref, 'qualification.source_ref', 3, 128);
  if (!SOURCE_REF.test(sourceRef)) {
    throw new SupervisedActionError('invalid_hand_qualification', 'qualification.source_ref is invalid');
  }
  const sourcePatchFingerprint = text(
    root.source_patch_fingerprint,
    'qualification.source_patch_fingerprint',
    71,
    71,
  );
  if (!HASH.test(sourcePatchFingerprint)) {
    throw new SupervisedActionError('invalid_hand_qualification', 'qualification.source_patch_fingerprint is invalid');
  }
  const computedPatchFingerprint = `sha256:${createHash('sha256')
    .update(sourceFiles
      .slice()
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((item) => `${item.path}:${item.git_blob_sha}`)
      .join('\n'))
    .digest('hex')}`;
  if (sourcePatchFingerprint !== computedPatchFingerprint) {
    throw new SupervisedActionError('invalid_hand_qualification', 'qualification.source_patch_fingerprint does not bind source files');
  }
  const sourceState = root.source_state === 'working_tree'
    ? 'working_tree' as const
    : root.source_state === 'committed_branch'
      ? 'committed_branch' as const
      : exactLiteral(root.source_state, 'merged_main', 'qualification.source_state');
  if (capabilities.immutable_revision !== (sourceState !== 'working_tree')) {
    throw new SupervisedActionError('invalid_hand_qualification', 'immutable revision capability contradicts source state');
  }
  if (capabilities.canonical_main_release !== (sourceState === 'merged_main')) {
    throw new SupervisedActionError('invalid_hand_qualification', 'canonical main capability contradicts source state');
  }
  if ((sourceState === 'merged_main') !== (sourceRef === 'main')) {
    throw new SupervisedActionError('invalid_hand_qualification', 'source ref contradicts source state');
  }
  const value: SupervisedHandQualification = {
    schema_version: exactLiteral(root.schema_version, SUPERVISED_HAND_QUALIFICATION_SCHEMA, 'qualification.schema_version'),
    audited_at: actionIso(root.audited_at, 'invalid_hand_qualification'),
    repository: exactLiteral(root.repository, 'leozvu/repositoryrealms', 'qualification.repository'),
    source_ref: sourceRef,
    source_commit: sourceCommit,
    source_state: sourceState,
    source_patch_fingerprint: sourcePatchFingerprint,
    command_key: exactLiteral(root.command_key, REPOSITORYREALMS_TASK_CREATE_COMMAND, 'qualification.command_key'),
    source_contract: exactLiteral(root.source_contract, 'repositoryrealms.leozops.task-command', 'qualification.source_contract'),
    source_contract_version: exactLiteral(root.source_contract_version, 1, 'qualification.source_contract_version'),
    endpoint_path: exactLiteral(root.endpoint_path, '/api/integrations/leozops/v1/commands/create-task', 'qualification.endpoint_path'),
    receipt_path: exactLiteral(root.receipt_path, '/api/integrations/leozops/v1/commands/create-task/receipts', 'qualification.receipt_path'),
    action: exactLiteral(root.action, 'task.create', 'qualification.action'),
    scope: exactLiteral(root.scope, 'leozops.task.create.execute', 'qualification.scope'),
    capability: exactLiteral(root.capability, 'delivery', 'qualification.capability'),
    payload_profile: exactLiteral(root.payload_profile, 'unassigned_task_only', 'qualification.payload_profile'),
    source_files: sourceFiles.sort((left, right) => left.path.localeCompare(right.path)),
    capabilities,
    verdict: root.verdict === 'qualified' ? 'qualified' : exactLiteral(root.verdict, 'blocked', 'qualification.verdict'),
  };
  const sourceBlockers = supervisedHandBlockers(value, 1);
  if ((sourceBlockers.length === 0) !== (value.verdict === 'qualified')) {
    throw new SupervisedActionError('invalid_hand_qualification', 'qualification verdict does not match source capabilities');
  }
  return {
    value,
    fingerprint: evidenceFingerprint(value),
    blockers: supervisedHandBlockers(value),
  };
}

function taskPayloadRecord(input: unknown): Record<string, unknown> {
  const value = record(input, 'payload');
  const allowed = new Set(['title', 'note', 'due_date', 'priority', 'estimated_hours']);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0 || !Object.hasOwn(value, 'title')) {
    throw new SupervisedActionError('invalid_task_create_payload', 'task payload keys are invalid');
  }
  return value;
}

function minimizedOperatingText(value: unknown, path: string, min: number, max: number): string {
  const normalized = text(value, path, min, max);
  if (EMAIL.test(normalized) || PHONE.test(normalized)) {
    throw new SupervisedActionError('invalid_task_create_payload', `${path} contains prohibited contact data`);
  }
  return normalized;
}

export function validateRepositoryRealmsTaskCreatePayload(input: unknown): RepositoryRealmsTaskCreatePayload {
  const value = taskPayloadRecord(input);
  const title = minimizedOperatingText(value.title, 'payload.title', 3, 160);
  const result: RepositoryRealmsTaskCreatePayload = { title };
  if (value.note !== undefined) result.note = minimizedOperatingText(value.note, 'payload.note', 1, 1_000);
  if (value.due_date !== undefined) {
    const dueDate = text(value.due_date, 'payload.due_date', 10, 10);
    if (!ISO_DAY.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T00:00:00.000Z`))) {
      throw new SupervisedActionError('invalid_task_create_payload', 'payload.due_date is invalid');
    }
    result.due_date = dueDate;
  }
  if (value.priority !== undefined) {
    if (typeof value.priority !== 'string' || !PRIORITIES.has(value.priority)) {
      throw new SupervisedActionError('invalid_task_create_payload', 'payload.priority is invalid');
    }
    result.priority = value.priority as RepositoryRealmsTaskCreatePayload['priority'];
  }
  if (value.estimated_hours !== undefined) {
    if (!Number.isInteger(value.estimated_hours) || Number(value.estimated_hours) < 0 || Number(value.estimated_hours) > 1_000) {
      throw new SupervisedActionError('invalid_task_create_payload', 'payload.estimated_hours is invalid');
    }
    result.estimated_hours = Number(value.estimated_hours);
  }
  return result;
}

function safeToken(value: unknown, path: string): string {
  const normalized = text(value, path, 3, 160);
  if (!SAFE_TOKEN.test(normalized)) {
    throw new SupervisedActionError('invalid_task_create_envelope', `${path} is invalid`);
  }
  return normalized;
}

export function buildRepositoryRealmsTaskCreateEnvelope(input: {
  payload: unknown;
  targetEntityId: string;
  actorSubject: string;
  idempotencyKey: string;
  correlationId: string;
}): RepositoryRealmsTaskCreateEnvelope {
  const payload = validateRepositoryRealmsTaskCreatePayload(input.payload);
  return {
    contract: 'repositoryrealms.leozops.task-command',
    version: 1,
    operation: 'preview',
    targetEntityId: safeToken(input.targetEntityId, 'targetEntityId'),
    actorSubject: safeToken(input.actorSubject, 'actorSubject'),
    idempotencyKey: safeToken(input.idempotencyKey, 'idempotencyKey'),
    correlationId: safeToken(input.correlationId, 'correlationId'),
    payload: {
      title: payload.title,
      note: payload.note ?? null,
      dueDate: payload.due_date ?? null,
      priority: payload.priority ?? 'medium',
      estHours: payload.estimated_hours ?? 0,
    },
  };
}

export function supervisedHandEnvelopeFingerprint(envelope: RepositoryRealmsTaskCreateEnvelope): string {
  return evidenceFingerprint(envelope);
}
