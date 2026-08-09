import { createHash, timingSafeEqual } from 'node:crypto';
import {
  ActionExecutionEvidence,
  ActionPreviewEvidence,
  ActionRecoverySubject,
  SupervisedActionAdapter,
  SupervisedActionAttempt,
  SupervisedActionError,
  SupervisedActionPreview,
  SupervisedActionProposal,
  actionFingerprint,
} from '../../domain/supervisedAction';
import { canonicalSafeActionPayload, credentialFingerprint } from '../../domain/g6Policy';
import {
  RepositoryRealmsTaskCreatePayload,
  validateRepositoryRealmsTaskCreatePayload,
} from '../../domain/supervisedHand';

export const REPOSITORYREALMS_TASK_COMMAND_ADAPTER_ID = 'repositoryrealms-task-command-v1' as const;
export const REPOSITORYREALMS_TASK_COMMAND_ADAPTER_VERSION = 'repositoryrealms_task_command_adapter_v1' as const;
export const REPOSITORYREALMS_TASK_COMMAND_CONTRACT = 'repositoryrealms.leozops.task-command' as const;
export const REPOSITORYREALMS_TASK_COMMAND_RECEIPT_CONTRACT = 'repositoryrealms.leozops.task-command-receipt' as const;
export const REPOSITORYREALMS_TASK_APPROVAL_RECEIPT_CONTRACT = 'repositoryrealms.leozops.task-approval-receipt' as const;
export const REPOSITORYREALMS_TASK_COMMAND_KEY = 'egoric.task.create.v1' as const;
export const REPOSITORYREALMS_TASK_COMMAND_VERSION = 1 as const;
export const REPOSITORYREALMS_TASK_COMMAND_PATH = '/api/integrations/leozops/v1/commands/create-task' as const;
export const REPOSITORYREALMS_TASK_RECEIPT_PATH = `${REPOSITORYREALMS_TASK_COMMAND_PATH}/receipts` as const;

type SourceOperation =
  | 'preview'
  | 'approve_execute'
  | 'execute'
  | 'preview_rollback'
  | 'approve_rollback'
  | 'rollback';

type MutationOperation = 'execute' | 'rollback';

export interface RepositoryRealmsTaskCommandHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Readonly<Record<string, string>>;
  body?: string;
  signal: AbortSignal;
}

export interface RepositoryRealmsTaskCommandHttpResponse {
  status: number;
  body: string;
  contentType?: string | null;
}

export type RepositoryRealmsTaskCommandTransport = (
  request: RepositoryRealmsTaskCommandHttpRequest,
) => Promise<RepositoryRealmsTaskCommandHttpResponse>;

export interface RepositoryRealmsTaskCommandCredentialSet {
  preview: string;
  approve_execute: string;
  execute: string;
  preview_rollback: string;
  approve_rollback: string;
  rollback: string;
  receipts_read: string;
}

export interface RepositoryRealmsTaskCommandSubjects {
  preview: string;
  approve_execute: string;
  execute: string;
  preview_rollback: string;
  approve_rollback: string;
  rollback: string;
}

export interface RepositoryRealmsTaskCommandAdapterOptions {
  environment: 'test' | 'production';
  endpointUrl: string;
  targetEntityId: string;
  expectedProjectId: string;
  expectedTenantKey: string;
  credentials: RepositoryRealmsTaskCommandCredentialSet;
  subjects: RepositoryRealmsTaskCommandSubjects;
  transport?: RepositoryRealmsTaskCommandTransport;
  timeoutMs?: number;
  currency?: 'VND';
}

export interface RepositoryRealmsTaskCommandReceipt {
  id: string;
  commandId: string;
  commandKey: typeof REPOSITORYREALMS_TASK_COMMAND_KEY;
  operation: MutationOperation;
  targetEntityId: string;
  actorSubject: string;
  correlationId: string;
  resource: 'tasks';
  recordId: string;
  requestFingerprint: string;
  resultFingerprint: string;
  resultCode: 'task_created' | 'task_create_rolled_back';
  externalMutationCount: 1;
  committedAt: string;
  replayed: boolean;
}

interface SourcePreview {
  kind: 'execute' | 'rollback';
  requestFingerprint: string;
  targetFingerprint: string;
  effectFingerprint: string;
  previewFingerprint: string;
  summaryCode: 'create_unassigned_task' | 'delete_exact_unchanged_command_task';
  rollbackStrategyCode: 'delete_exact_unchanged_command_task' | 'not_applicable';
  estimatedCostMinor: 0;
  currency: 'VND';
  externalMutationCount: 0;
  previewedAt: string;
  expiresAt: string;
}

interface SourceApproval {
  id: string;
  kind: 'execute' | 'rollback';
  targetEntityId: string;
  approvedBySubject: string;
  requestFingerprint: string;
  previewFingerprint: string;
  subjectCommandId: string | null;
  approvedAt: string;
  expiresAt: string;
  consumed: boolean;
  replayed: boolean;
}

class RepositoryRealmsProviderError extends SupervisedActionError {
  constructor(
    code: string,
    message: string,
    readonly definitive: boolean,
    readonly status: number | null,
    readonly operation: SourceOperation | 'receipt',
  ) {
    super(code, message);
    this.name = 'RepositoryRealmsProviderError';
  }
}

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 12 * 1024;
const HASH = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{1,191}$/;
const SAFE_SUBJECT = /^[A-Za-z0-9][A-Za-z0-9:_-]{2,159}$/;
const SOURCE_ERROR = /^[a-z][a-z0-9_]{2,95}$/;

function fail(code: string, message: string): never {
  throw new SupervisedActionError(code, message);
}

function exactObject(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', `${path} must be an object`, false, null, 'receipt');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', `${path} keys are invalid`, false, null, 'receipt');
  }
  return record;
}

function safeString(value: unknown, path: string, pattern = SAFE_ID): string {
  if (
    typeof value !== 'string'
    || value.length < 2
    || value.length > 192
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
    || !pattern.test(value)
  ) throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', `${path} is invalid`, false, null, 'receipt');
  return value;
}

function hash(value: unknown, path: string): string {
  if (typeof value !== 'string' || !HASH.test(value)) {
    throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', `${path} is invalid`, false, null, 'receipt');
  }
  return value;
}

function iso(value: unknown, path: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', `${path} is invalid`, false, null, 'receipt');
  }
  return new Date(value).toISOString();
}

function safeSecret(value: string, path: string): string {
  if (
    typeof value !== 'string'
    || value.length < 16
    || value.length > 2_048
    || /[\u0000-\u0020\u007f]/.test(value)
  ) fail('repositoryrealms_adapter_config_invalid', `${path} is malformed`);
  return value;
}

function safeSubject(value: string, path: string): string {
  if (typeof value !== 'string' || !SAFE_SUBJECT.test(value)) {
    fail('repositoryrealms_adapter_config_invalid', `${path} is malformed`);
  }
  return value;
}

function safeConfigId(value: string, path: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value) || value.length > 192) {
    fail('repositoryrealms_adapter_config_invalid', `${path} is malformed`);
  }
  return value;
}

function normalizedEndpoint(value: string, environment: 'test' | 'production'): string {
  try {
    const url = new URL(value);
    if (
      (environment === 'production' && url.protocol !== 'https:')
      || (environment === 'test' && !['http:', 'https:'].includes(url.protocol))
      || url.username
      || url.password
      || url.search
      || url.hash
      || url.pathname !== REPOSITORYREALMS_TASK_COMMAND_PATH
    ) throw new Error('unsafe endpoint');
    return url.toString();
  } catch {
    return fail('repositoryrealms_adapter_config_invalid', 'endpointUrl must be the exact credential-free task command URL');
  }
}

function normalizedTimeout(value: number | undefined): number {
  const timeout = value ?? 8_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 15_000) {
    fail('repositoryrealms_adapter_config_invalid', 'timeoutMs must be between 1000 and 15000');
  }
  return timeout;
}

function exactCredentialSet(input: RepositoryRealmsTaskCommandCredentialSet): RepositoryRealmsTaskCommandCredentialSet {
  const keys: Array<keyof RepositoryRealmsTaskCommandCredentialSet> = [
    'preview', 'approve_execute', 'execute', 'preview_rollback', 'approve_rollback', 'rollback', 'receipts_read',
  ];
  const result = Object.fromEntries(keys.map((key) => [key, safeSecret(input[key], `credentials.${key}`)])) as unknown as RepositoryRealmsTaskCommandCredentialSet;
  if (new Set(Object.values(result)).size !== keys.length) {
    fail('repositoryrealms_adapter_config_invalid', 'every source scope requires a distinct credential');
  }
  return result;
}

function exactSubjects(input: RepositoryRealmsTaskCommandSubjects): RepositoryRealmsTaskCommandSubjects {
  const keys: Array<keyof RepositoryRealmsTaskCommandSubjects> = [
    'preview', 'approve_execute', 'execute', 'preview_rollback', 'approve_rollback', 'rollback',
  ];
  const result = Object.fromEntries(keys.map((key) => [key, safeSubject(input[key], `subjects.${key}`)])) as unknown as RepositoryRealmsTaskCommandSubjects;
  if (result.approve_execute === result.execute || result.approve_rollback === result.rollback) {
    fail('repositoryrealms_adapter_config_invalid', 'source approver and operator subjects must be separate');
  }
  return result;
}

async function fetchTransport(request: RepositoryRealmsTaskCommandHttpRequest): Promise<RepositoryRealmsTaskCommandHttpResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    redirect: 'error',
  });
  const advertisedLength = response.headers.get('content-length');
  if (advertisedLength && /^\d+$/.test(advertisedLength) && Number(advertisedLength) > MAX_RESPONSE_BYTES) {
    throw new RepositoryRealmsProviderError('repositoryrealms_response_too_large', 'RepositoryRealms response exceeded the transport budget', false, response.status, 'receipt');
  }
  let body = '';
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new RepositoryRealmsProviderError('repositoryrealms_response_too_large', 'RepositoryRealms response exceeded the transport budget', false, response.status, 'receipt');
      }
      chunks.push(chunk.value);
    }
    body = Buffer.concat(chunks, total).toString('utf8');
  }
  return { status: response.status, body, contentType: response.headers.get('content-type') };
}

function parseJson(body: string): unknown {
  if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new RepositoryRealmsProviderError('repositoryrealms_response_too_large', 'RepositoryRealms response exceeded the transport budget', false, null, 'receipt');
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', 'RepositoryRealms returned invalid JSON', false, null, 'receipt');
  }
}

function sourceKey(operation: SourceOperation | 'receipt', seed: string): string {
  const digest = createHash('sha256').update(`${operation}\0${seed}`).digest('hex');
  return `leozops:${operation}:${digest}`;
}

function secureEqual(left: string, right: string): boolean {
  return left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function sourcePayload(input: unknown): {
  internal: RepositoryRealmsTaskCreatePayload;
  provider: { title: string; note: string | null; dueDate: string | null; priority: 'low' | 'medium' | 'high' | 'urgent'; estHours: number };
} {
  const internal = validateRepositoryRealmsTaskCreatePayload(input);
  return {
    internal,
    provider: {
      title: internal.title,
      note: internal.note ?? null,
      dueDate: internal.due_date ?? null,
      priority: internal.priority ?? 'medium',
      estHours: internal.estimated_hours ?? 0,
    },
  };
}

function sourcePreviewFingerprint(preview: Pick<SourcePreview, 'kind' | 'requestFingerprint' | 'targetFingerprint' | 'effectFingerprint' | 'rollbackStrategyCode'>): string {
  return actionFingerprint({
    kind: preview.kind,
    requestFingerprint: preview.requestFingerprint,
    targetFingerprint: preview.targetFingerprint,
    effectFingerprint: preview.effectFingerprint,
    rollbackStrategyCode: preview.rollbackStrategyCode,
  });
}

function validateRepositoryEvidence(value: unknown, preview: boolean): void {
  const root = exactObject(value, ['name', 'receiptId', 'invariants'], 'repository');
  if (root.name !== 'RepositoryRealms') {
    throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', 'repository name is invalid', false, null, 'receipt');
  }
  safeString(root.receiptId, 'repository.receiptId');
  const invariants = exactObject(root.invariants, [
    'authorization', 'businessRules', 'receipt', 'audit', 'previewBusinessMutationCount', 'approvalSeparation',
  ], 'repository.invariants');
  if (
    invariants.authorization !== 'enforced'
    || invariants.businessRules !== 'enforced'
    || invariants.approvalSeparation !== 'credential_and_subject'
    || invariants.previewBusinessMutationCount !== 0
    || invariants.receipt !== (preview ? 'not_persisted_by_design' : 'verified')
    || invariants.audit !== (preview ? 'not_written_by_design' : 'atomic')
  ) throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', 'repository invariant evidence is invalid', false, null, 'receipt');
}

function validateSourcePreview(
  value: unknown,
  operation: 'preview' | 'preview_rollback',
  targetEntityId: string,
  commandId?: string,
  payload?: ReturnType<typeof sourcePayload>['provider'],
): SourcePreview {
  const expectedRoot = operation === 'preview'
    ? ['contract', 'version', 'operation', 'commandKey', 'preview', 'repository']
    : ['contract', 'version', 'operation', 'commandKey', 'preview', 'subject', 'repository'];
  const root = exactObject(value, expectedRoot, 'response');
  if (
    root.contract !== REPOSITORYREALMS_TASK_COMMAND_CONTRACT
    || root.version !== REPOSITORYREALMS_TASK_COMMAND_VERSION
    || root.operation !== operation
    || root.commandKey !== REPOSITORYREALMS_TASK_COMMAND_KEY
  ) throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', 'preview contract binding is invalid', false, null, operation);
  const row = exactObject(root.preview, [
    'kind', 'requestFingerprint', 'targetFingerprint', 'effectFingerprint', 'previewFingerprint',
    'summaryCode', 'rollbackStrategyCode', 'estimatedCostMinor', 'currency',
    'externalMutationCount', 'previewedAt', 'expiresAt',
  ], 'response.preview');
  const preview: SourcePreview = {
    kind: row.kind === 'execute' ? 'execute' : row.kind === 'rollback' ? 'rollback' : failProviderPreview(),
    requestFingerprint: hash(row.requestFingerprint, 'response.preview.requestFingerprint'),
    targetFingerprint: hash(row.targetFingerprint, 'response.preview.targetFingerprint'),
    effectFingerprint: hash(row.effectFingerprint, 'response.preview.effectFingerprint'),
    previewFingerprint: hash(row.previewFingerprint, 'response.preview.previewFingerprint'),
    summaryCode: row.summaryCode === 'create_unassigned_task'
      ? 'create_unassigned_task'
      : row.summaryCode === 'delete_exact_unchanged_command_task'
        ? 'delete_exact_unchanged_command_task'
        : failProviderPreview(),
    rollbackStrategyCode: row.rollbackStrategyCode === 'delete_exact_unchanged_command_task'
      ? 'delete_exact_unchanged_command_task'
      : row.rollbackStrategyCode === 'not_applicable'
        ? 'not_applicable'
        : failProviderPreview(),
    estimatedCostMinor: row.estimatedCostMinor === 0 ? 0 : failProviderPreview(),
    currency: row.currency === 'VND' ? 'VND' : failProviderPreview(),
    externalMutationCount: row.externalMutationCount === 0 ? 0 : failProviderPreview(),
    previewedAt: iso(row.previewedAt, 'response.preview.previewedAt'),
    expiresAt: iso(row.expiresAt, 'response.preview.expiresAt'),
  };
  if (
    preview.kind !== (operation === 'preview' ? 'execute' : 'rollback')
    || preview.summaryCode !== (operation === 'preview' ? 'create_unassigned_task' : 'delete_exact_unchanged_command_task')
    || preview.rollbackStrategyCode !== (operation === 'preview' ? 'delete_exact_unchanged_command_task' : 'not_applicable')
    || preview.previewFingerprint !== sourcePreviewFingerprint(preview)
    || Date.parse(preview.expiresAt) <= Date.parse(preview.previewedAt)
    || Date.parse(preview.expiresAt) - Date.parse(preview.previewedAt) > 10 * 60_000
  ) throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', 'preview evidence binding is invalid', false, null, operation);
  const expectedTarget = actionFingerprint({
    system: 'egoric',
    targetEntityId,
    endpointPath: REPOSITORYREALMS_TASK_COMMAND_PATH,
    commandKey: REPOSITORYREALMS_TASK_COMMAND_KEY,
  });
  const expectedRequest = actionFingerprint(operation === 'preview'
    ? { commandKey: REPOSITORYREALMS_TASK_COMMAND_KEY, targetEntityId, payload }
    : { commandKey: REPOSITORYREALMS_TASK_COMMAND_KEY, targetEntityId, commandId, operation: 'rollback' });
  if (preview.targetFingerprint !== expectedTarget || preview.requestFingerprint !== expectedRequest) {
    throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', 'preview request or target fingerprint is invalid', false, null, operation);
  }
  if (operation === 'preview') {
    const expectedEffect = actionFingerprint({ effect: 'create_unassigned_task', payload });
    if (preview.effectFingerprint !== expectedEffect) {
      throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', 'preview effect fingerprint is invalid', false, null, operation);
    }
  } else {
    const subject = exactObject(root.subject, ['commandId', 'executionResultFingerprint'], 'response.subject');
    if (safeString(subject.commandId, 'response.subject.commandId') !== commandId) {
      throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', 'rollback subject is invalid', false, null, operation);
    }
    hash(subject.executionResultFingerprint, 'response.subject.executionResultFingerprint');
  }
  validateRepositoryEvidence(root.repository, true);
  return preview;
}

function failProviderPreview(): never {
  throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', 'preview field is invalid', false, null, 'receipt');
}

function validateSourceApproval(
  value: unknown,
  kind: 'execute' | 'rollback',
  targetEntityId: string,
  actorSubject: string,
  preview: SourcePreview,
  commandId?: string,
): SourceApproval {
  const root = exactObject(value, ['contract', 'version', 'approval', 'repository'], 'response');
  if (root.contract !== REPOSITORYREALMS_TASK_APPROVAL_RECEIPT_CONTRACT || root.version !== 1) {
    throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', 'approval contract is invalid', false, null, kind === 'execute' ? 'approve_execute' : 'approve_rollback');
  }
  const row = exactObject(root.approval, [
    'id', 'kind', 'targetEntityId', 'approvedBySubject', 'requestFingerprint', 'previewFingerprint',
    'subjectCommandId', 'approvedAt', 'expiresAt', 'consumed', 'replayed',
  ], 'response.approval');
  const approval: SourceApproval = {
    id: safeString(row.id, 'response.approval.id'),
    kind: row.kind === 'execute' ? 'execute' : row.kind === 'rollback' ? 'rollback' : failProviderApproval(),
    targetEntityId: safeString(row.targetEntityId, 'response.approval.targetEntityId'),
    approvedBySubject: safeString(row.approvedBySubject, 'response.approval.approvedBySubject', SAFE_SUBJECT),
    requestFingerprint: hash(row.requestFingerprint, 'response.approval.requestFingerprint'),
    previewFingerprint: hash(row.previewFingerprint, 'response.approval.previewFingerprint'),
    subjectCommandId: row.subjectCommandId === null ? null : safeString(row.subjectCommandId, 'response.approval.subjectCommandId'),
    approvedAt: iso(row.approvedAt, 'response.approval.approvedAt'),
    expiresAt: iso(row.expiresAt, 'response.approval.expiresAt'),
    consumed: typeof row.consumed === 'boolean' ? row.consumed : failProviderApproval(),
    replayed: typeof row.replayed === 'boolean' ? row.replayed : failProviderApproval(),
  };
  if (
    approval.kind !== kind
    || approval.targetEntityId !== targetEntityId
    || approval.approvedBySubject !== actorSubject
    || approval.requestFingerprint !== preview.requestFingerprint
    || approval.previewFingerprint !== preview.previewFingerprint
    || approval.subjectCommandId !== (commandId ?? null)
    || approval.consumed
    || Date.parse(approval.expiresAt) <= Date.parse(approval.approvedAt)
    || Date.parse(approval.expiresAt) - Date.parse(approval.approvedAt) > 15 * 60_000
  ) throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', 'approval binding is invalid', false, null, kind === 'execute' ? 'approve_execute' : 'approve_rollback');
  validateRepositoryEvidence(root.repository, false);
  return approval;
}

function failProviderApproval(): never {
  throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', 'approval field is invalid', false, null, 'receipt');
}

function validateSourceReceipt(
  value: unknown,
  operation: MutationOperation,
  targetEntityId: string,
  actorSubject: string | null,
  correlationId: string,
): RepositoryRealmsTaskCommandReceipt {
  const root = exactObject(value, ['contract', 'version', 'receipt', 'state', 'repository'], 'response');
  if (root.contract !== REPOSITORYREALMS_TASK_COMMAND_RECEIPT_CONTRACT || root.version !== 1) {
    throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', 'receipt contract is invalid', false, null, operation);
  }
  const row = exactObject(root.receipt, [
    'id', 'commandId', 'commandKey', 'operation', 'targetEntityId', 'actorSubject', 'correlationId',
    'resource', 'recordId', 'requestFingerprint', 'resultFingerprint', 'resultCode',
    'externalMutationCount', 'committedAt', 'replayed',
  ], 'response.receipt');
  const resultCode = operation === 'execute' ? 'task_created' : 'task_create_rolled_back';
  const receipt: RepositoryRealmsTaskCommandReceipt = {
    id: safeString(row.id, 'response.receipt.id'),
    commandId: safeString(row.commandId, 'response.receipt.commandId'),
    commandKey: row.commandKey === REPOSITORYREALMS_TASK_COMMAND_KEY ? REPOSITORYREALMS_TASK_COMMAND_KEY : failProviderReceipt(),
    operation: row.operation === operation ? operation : failProviderReceipt(),
    targetEntityId: safeString(row.targetEntityId, 'response.receipt.targetEntityId'),
    actorSubject: safeString(row.actorSubject, 'response.receipt.actorSubject', SAFE_SUBJECT),
    correlationId: safeString(row.correlationId, 'response.receipt.correlationId'),
    resource: row.resource === 'tasks' ? 'tasks' : failProviderReceipt(),
    recordId: safeString(row.recordId, 'response.receipt.recordId'),
    requestFingerprint: hash(row.requestFingerprint, 'response.receipt.requestFingerprint'),
    resultFingerprint: hash(row.resultFingerprint, 'response.receipt.resultFingerprint'),
    resultCode: row.resultCode === resultCode ? resultCode : failProviderReceipt(),
    externalMutationCount: row.externalMutationCount === 1 ? 1 : failProviderReceipt(),
    committedAt: iso(row.committedAt, 'response.receipt.committedAt'),
    replayed: typeof row.replayed === 'boolean' ? row.replayed : failProviderReceipt(),
  };
  if (
    receipt.targetEntityId !== targetEntityId
    || receipt.correlationId !== correlationId
    || (actorSubject !== null && receipt.actorSubject !== actorSubject)
    || root.state !== (operation === 'execute' ? 'active' : 'rolled_back')
  ) throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', 'receipt binding is invalid', false, null, operation);
  validateRepositoryEvidence(root.repository, false);
  return receipt;
}

function failProviderReceipt(): never {
  throw new RepositoryRealmsProviderError('repositoryrealms_response_invalid', 'receipt field is invalid', false, null, 'receipt');
}

function internalRequestFingerprint(input: {
  payload: unknown;
  targetProjectId: string;
  targetTenantKey: string;
  targetEndpointUrl: string;
  targetCredentialFingerprint: string;
  idempotencyKey: string;
}): string {
  return actionFingerprint({
    kind: 'execute',
    command_key: REPOSITORYREALMS_TASK_COMMAND_KEY,
    command_version: 'v1',
    target_project_id: input.targetProjectId,
    target_tenant_key: input.targetTenantKey,
    command_endpoint_url: input.targetEndpointUrl,
    command_credential_sha256: input.targetCredentialFingerprint,
    payload: JSON.parse(canonicalSafeActionPayload(input.payload)),
    idempotency_key: input.idempotencyKey,
  });
}

function internalRollbackRequestFingerprint(input: {
  proposal: SupervisedActionProposal;
  execution: SupervisedActionAttempt;
  targetProjectId: string;
  targetTenantKey: string;
  targetEndpointUrl: string;
  targetCredentialFingerprint: string;
  idempotencyKey: string;
}): string {
  return actionFingerprint({
    kind: 'rollback',
    command_key: REPOSITORYREALMS_TASK_COMMAND_KEY,
    command_version: 'v1',
    target_project_id: input.targetProjectId,
    target_tenant_key: input.targetTenantKey,
    command_endpoint_url: input.targetEndpointUrl,
    command_credential_sha256: input.targetCredentialFingerprint,
    proposal_fingerprint: input.proposal.proposal_fingerprint,
    execution_result_fingerprint: input.execution.result_fingerprint,
    idempotency_key: input.idempotencyKey,
  });
}

function internalTargetFingerprint(input: {
  targetProjectId: string;
  targetTenantKey: string;
  targetEndpointUrl: string;
  targetCredentialFingerprint: string;
}): string {
  return actionFingerprint({
    system: 'egoric',
    project_id: input.targetProjectId,
    tenant_key: input.targetTenantKey,
    command_endpoint_url: input.targetEndpointUrl,
    command_credential_sha256: input.targetCredentialFingerprint,
  });
}

function internalRecoveryRequestFingerprint(input: {
  subject: ActionRecoverySubject;
  targetProjectId: string;
  targetTenantKey: string;
  targetEndpointUrl: string;
  targetCredentialFingerprint: string;
  idempotencyKey: string;
}): string {
  return actionFingerprint({
    kind: 'human_recovery',
    command_key: REPOSITORYREALMS_TASK_COMMAND_KEY,
    command_version: 'v1',
    target_project_id: input.targetProjectId,
    target_tenant_key: input.targetTenantKey,
    command_endpoint_url: input.targetEndpointUrl,
    command_credential_sha256: input.targetCredentialFingerprint,
    original_request_fingerprint: input.subject.original_request_fingerprint,
    original_result_fingerprint: input.subject.original_result_fingerprint,
    original_external_request_id: input.subject.original_external_request_id,
    original_idempotency_key: input.subject.original_idempotency_key,
    recovery_idempotency_key: input.idempotencyKey,
  });
}

export class RepositoryRealmsTaskCommandAdapter implements SupervisedActionAdapter {
  readonly descriptor;
  private readonly endpointUrl: string;
  private readonly receiptUrl: string;
  private readonly targetEntityId: string;
  private readonly expectedProjectId: string;
  private readonly expectedTenantKey: string;
  private readonly credentials: RepositoryRealmsTaskCommandCredentialSet;
  private readonly subjects: RepositoryRealmsTaskCommandSubjects;
  private readonly transport: RepositoryRealmsTaskCommandTransport;
  private readonly timeoutMs: number;
  private readonly executionCredentialFingerprint: string;

  constructor(options: RepositoryRealmsTaskCommandAdapterOptions) {
    this.endpointUrl = normalizedEndpoint(options.endpointUrl, options.environment);
    const url = new URL(this.endpointUrl);
    url.pathname = REPOSITORYREALMS_TASK_RECEIPT_PATH;
    this.receiptUrl = url.toString();
    this.targetEntityId = safeConfigId(options.targetEntityId, 'targetEntityId');
    this.expectedProjectId = safeConfigId(options.expectedProjectId, 'expectedProjectId');
    this.expectedTenantKey = safeConfigId(options.expectedTenantKey, 'expectedTenantKey');
    this.credentials = exactCredentialSet(options.credentials);
    this.subjects = exactSubjects(options.subjects);
    this.transport = options.transport ?? fetchTransport;
    this.timeoutMs = normalizedTimeout(options.timeoutMs);
    this.executionCredentialFingerprint = credentialFingerprint(this.credentials.execute);
    if ((options.currency ?? 'VND') !== 'VND') {
      fail('repositoryrealms_adapter_config_invalid', 'task command currency must be VND');
    }
    this.descriptor = Object.freeze({
      adapter_id: REPOSITORYREALMS_TASK_COMMAND_ADAPTER_ID,
      adapter_version: REPOSITORYREALMS_TASK_COMMAND_ADAPTER_VERSION,
      command_key: REPOSITORYREALMS_TASK_COMMAND_KEY,
      command_version: 'v1',
      environment: options.environment,
      target_endpoint_url: this.endpointUrl,
      supports_dry_run: true as const,
      supports_idempotency: true as const,
      supports_rollback: true as const,
    });
  }

  validatePayload(payload: unknown): void {
    sourcePayload(payload);
  }

  async preview(input: Parameters<SupervisedActionAdapter['preview']>[0]): Promise<ActionPreviewEvidence> {
    this.assertTarget(input);
    const payload = sourcePayload(input.payload);
    const preview = await this.sourcePreview(payload.provider, input.idempotencyKey);
    return {
      summary_code: preview.summaryCode,
      request_fingerprint: internalRequestFingerprint(input),
      target_fingerprint: internalTargetFingerprint(input),
      effect_fingerprint: preview.effectFingerprint,
      rollback_strategy_code: preview.rollbackStrategyCode,
      estimated_cost_minor: 0,
      currency: 'VND',
      external_mutation_count: 0,
    };
  }

  async execute(input: Parameters<SupervisedActionAdapter['execute']>[0]): Promise<ActionExecutionEvidence> {
    this.assertTarget(input);
    const payload = sourcePayload(input.payload);
    try {
      const preview = await this.sourcePreview(payload.provider, input.idempotencyKey);
      if (preview.effectFingerprint !== input.preview.effect_fingerprint) {
        throw new RepositoryRealmsProviderError('repositoryrealms_preview_drift', 'RepositoryRealms preview changed before execution', true, 409, 'execute');
      }
      const approval = await this.sourceApproval('execute', preview, input.idempotencyKey, payload.provider);
      const receipt = await this.sourceMutation('execute', input.idempotencyKey, {
        payload: payload.provider,
        approvalId: approval.id,
      });
      return this.executionEvidence(receipt);
    } catch (error) {
      return this.definitiveFailureOrThrow(error, 'execute', input.idempotencyKey);
    }
  }

  async previewRollback(input: Parameters<SupervisedActionAdapter['previewRollback']>[0]): Promise<ActionPreviewEvidence> {
    this.assertTarget(input);
    const commandId = this.executionCommandId(input.execution);
    const preview = await this.sourceRollbackPreview(commandId, input.idempotencyKey);
    return {
      summary_code: preview.summaryCode,
      request_fingerprint: internalRollbackRequestFingerprint(input),
      target_fingerprint: internalTargetFingerprint(input),
      effect_fingerprint: preview.effectFingerprint,
      rollback_strategy_code: preview.rollbackStrategyCode,
      estimated_cost_minor: 0,
      currency: 'VND',
      external_mutation_count: 0,
    };
  }

  async rollback(input: Parameters<SupervisedActionAdapter['rollback']>[0]): Promise<ActionExecutionEvidence> {
    this.assertTarget(input);
    const commandId = this.executionCommandId(input.execution);
    try {
      const preview = await this.sourceRollbackPreview(commandId, input.idempotencyKey);
      if (preview.effectFingerprint !== input.preview.effect_fingerprint) {
        throw new RepositoryRealmsProviderError('repositoryrealms_rollback_preview_drift', 'RepositoryRealms rollback preview changed before execution', true, 409, 'rollback');
      }
      const approval = await this.sourceApproval('rollback', preview, input.idempotencyKey, undefined, commandId);
      const receipt = await this.sourceMutation('rollback', input.idempotencyKey, {
        commandId,
        approvalId: approval.id,
      });
      return this.executionEvidence(receipt);
    } catch (error) {
      return this.definitiveFailureOrThrow(error, 'rollback', input.idempotencyKey);
    }
  }

  async previewRecovery(input: Parameters<NonNullable<SupervisedActionAdapter['previewRecovery']>>[0]): Promise<ActionPreviewEvidence> {
    this.assertTarget(input);
    const commandId = this.recoveryCommandId(input.subject);
    const preview = await this.sourceRollbackPreview(commandId, input.idempotencyKey);
    return {
      summary_code: preview.summaryCode,
      request_fingerprint: internalRecoveryRequestFingerprint(input),
      target_fingerprint: internalTargetFingerprint(input),
      effect_fingerprint: preview.effectFingerprint,
      rollback_strategy_code: preview.rollbackStrategyCode,
      estimated_cost_minor: 0,
      currency: 'VND',
      external_mutation_count: 0,
    };
  }

  async recover(input: Parameters<NonNullable<SupervisedActionAdapter['recover']>>[0]): Promise<ActionExecutionEvidence> {
    this.assertTarget(input);
    const commandId = this.recoveryCommandId(input.subject);
    try {
      const preview = await this.sourceRollbackPreview(commandId, input.idempotencyKey);
      if (preview.effectFingerprint !== input.preview.effect_fingerprint) {
        throw new RepositoryRealmsProviderError('repositoryrealms_recovery_preview_drift', 'RepositoryRealms recovery preview changed before execution', true, 409, 'rollback');
      }
      const approval = await this.sourceApproval('rollback', preview, input.idempotencyKey, undefined, commandId);
      const receipt = await this.sourceMutation('rollback', input.idempotencyKey, { commandId, approvalId: approval.id });
      return this.executionEvidence(receipt);
    } catch (error) {
      return this.definitiveFailureOrThrow(error, 'rollback', input.idempotencyKey);
    }
  }

  async observeReceipt(input: { operation: MutationOperation; idempotencyKey: string }): Promise<RepositoryRealmsTaskCommandReceipt> {
    const correlationId = sourceKey(input.operation, input.idempotencyKey);
    const url = new URL(this.receiptUrl);
    url.searchParams.set('correlationId', correlationId);
    const response = await this.send({
      url: url.toString(),
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.credentials.receipts_read}`,
        'X-CEO-Entity-ID': this.targetEntityId,
      },
    }, 'receipt');
    return validateSourceReceipt(parseJson(response.body), input.operation, this.targetEntityId, null, correlationId);
  }

  private assertTarget(input: {
    targetProjectId: string;
    targetTenantKey: string;
    targetEndpointUrl: string;
    targetCredentialFingerprint: string;
  }): void {
    if (
      input.targetProjectId !== this.expectedProjectId
      || input.targetTenantKey !== this.expectedTenantKey
      || input.targetEndpointUrl !== this.endpointUrl
      || !secureEqual(input.targetCredentialFingerprint, this.executionCredentialFingerprint)
    ) fail('repositoryrealms_adapter_target_mismatch', 'adapter input does not match its exact released target');
  }

  private executionCommandId(execution: SupervisedActionAttempt): string {
    if (execution.status !== 'succeeded' || !execution.external_request_id || !SAFE_ID.test(execution.external_request_id)) {
      fail('repositoryrealms_execution_subject_invalid', 'rollback requires an exact successful source command id');
    }
    return execution.external_request_id;
  }

  private recoveryCommandId(subject: ActionRecoverySubject): string {
    if (
      !HASH.test(subject.original_request_fingerprint)
      || !HASH.test(subject.original_result_fingerprint)
      || !SAFE_ID.test(subject.original_external_request_id)
      || !SAFE_ID.test(subject.original_idempotency_key)
    ) fail('repositoryrealms_recovery_subject_invalid', 'recovery requires an exact successful source command subject');
    return subject.original_external_request_id;
  }

  private baseEnvelope(operation: SourceOperation, actorSubject: string, seed: string) {
    return {
      contract: REPOSITORYREALMS_TASK_COMMAND_CONTRACT,
      version: REPOSITORYREALMS_TASK_COMMAND_VERSION,
      operation,
      targetEntityId: this.targetEntityId,
      actorSubject,
      idempotencyKey: sourceKey(operation, seed),
      correlationId: sourceKey(operation, seed),
    };
  }

  private async sourcePreview(payload: ReturnType<typeof sourcePayload>['provider'], seed: string): Promise<SourcePreview> {
    const operation = 'preview' as const;
    const body = { ...this.baseEnvelope(operation, this.subjects.preview, seed), payload };
    const response = await this.post(operation, body, this.credentials.preview);
    return validateSourcePreview(parseJson(response.body), operation, this.targetEntityId, undefined, payload);
  }

  private async sourceRollbackPreview(commandId: string, seed: string): Promise<SourcePreview> {
    const operation = 'preview_rollback' as const;
    const body = { ...this.baseEnvelope(operation, this.subjects.preview_rollback, seed), commandId };
    const response = await this.post(operation, body, this.credentials.preview_rollback);
    return validateSourcePreview(parseJson(response.body), operation, this.targetEntityId, commandId);
  }

  private async sourceApproval(
    kind: 'execute' | 'rollback',
    preview: SourcePreview,
    seed: string,
    payload?: ReturnType<typeof sourcePayload>['provider'],
    commandId?: string,
  ): Promise<SourceApproval> {
    const operation = kind === 'execute' ? 'approve_execute' as const : 'approve_rollback' as const;
    const subject = this.subjects[operation];
    const body = kind === 'execute'
      ? { ...this.baseEnvelope(operation, subject, seed), payload, previewFingerprint: preview.previewFingerprint }
      : { ...this.baseEnvelope(operation, subject, seed), commandId, previewFingerprint: preview.previewFingerprint };
    const response = await this.post(operation, body, this.credentials[operation]);
    return validateSourceApproval(parseJson(response.body), kind, this.targetEntityId, subject, preview, commandId);
  }

  private async sourceMutation(
    operation: MutationOperation,
    seed: string,
    input: { payload?: ReturnType<typeof sourcePayload>['provider']; commandId?: string; approvalId: string },
  ): Promise<RepositoryRealmsTaskCommandReceipt> {
    const subject = this.subjects[operation];
    const body = operation === 'execute'
      ? { ...this.baseEnvelope(operation, subject, seed), payload: input.payload, approvalId: input.approvalId }
      : { ...this.baseEnvelope(operation, subject, seed), commandId: input.commandId, approvalId: input.approvalId };
    const response = await this.post(operation, body, this.credentials[operation]);
    return validateSourceReceipt(
      parseJson(response.body),
      operation,
      this.targetEntityId,
      subject,
      sourceKey(operation, seed),
    );
  }

  private async post(operation: SourceOperation, body: unknown, credential: string): Promise<RepositoryRealmsTaskCommandHttpResponse> {
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST_BYTES) {
      throw new RepositoryRealmsProviderError('repositoryrealms_request_too_large', 'RepositoryRealms request exceeded the transport budget', true, null, operation);
    }
    const envelope = body as Record<string, unknown>;
    return this.send({
      url: this.endpointUrl,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
        'X-CEO-Entity-ID': this.targetEntityId,
        'X-LeozOps-Operation': String(envelope.operation),
        'X-LeozOps-Actor-Subject': String(envelope.actorSubject),
        'Idempotency-Key': String(envelope.idempotencyKey),
        'X-Correlation-ID': String(envelope.correlationId),
      },
      body: serialized,
    }, operation);
  }

  private async send(
    request: Omit<RepositoryRealmsTaskCommandHttpRequest, 'signal'>,
    operation: SourceOperation | 'receipt',
  ): Promise<RepositoryRealmsTaskCommandHttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport({ ...request, signal: controller.signal });
      if (
        !Number.isInteger(response.status)
        || response.status < 100
        || response.status > 599
        || typeof response.body !== 'string'
      ) throw new RepositoryRealmsProviderError('repositoryrealms_transport_invalid', 'RepositoryRealms transport returned invalid metadata', false, null, operation);
      if (response.status >= 200 && response.status < 300) {
        if (response.contentType && !/^application\/json(?:\s*;.*)?$/i.test(response.contentType)) {
          throw new RepositoryRealmsProviderError('repositoryrealms_content_type_invalid', 'RepositoryRealms response was not JSON', false, response.status, operation);
        }
        return response;
      }
      const parsed = parseJson(response.body);
      const root = exactObject(parsed, ['error', 'code'], 'error');
      const code = typeof root.code === 'string' && SOURCE_ERROR.test(root.code)
        ? root.code
        : 'repositoryrealms_request_failed';
      const definitive = response.status >= 400 && response.status < 500 && response.status !== 409;
      throw new RepositoryRealmsProviderError(code, 'RepositoryRealms rejected the bounded command', definitive, response.status, operation);
    } catch (error) {
      if (error instanceof RepositoryRealmsProviderError) throw error;
      throw new RepositoryRealmsProviderError('repositoryrealms_outcome_unknown', 'RepositoryRealms outcome is unknown', false, null, operation);
    } finally {
      clearTimeout(timeout);
    }
  }

  private executionEvidence(receipt: RepositoryRealmsTaskCommandReceipt): ActionExecutionEvidence {
    return {
      outcome: 'succeeded',
      external_request_id: receipt.operation === 'execute' ? receipt.commandId : receipt.id,
      result_fingerprint: receipt.resultFingerprint,
      result_code: receipt.resultCode,
      actual_cost_minor: 0,
      currency: 'VND',
      external_mutation_count: 1,
    };
  }

  private definitiveFailureOrThrow(
    error: unknown,
    operation: MutationOperation,
    idempotencyKey: string,
  ): ActionExecutionEvidence {
    if (!(error instanceof RepositoryRealmsProviderError) || !error.definitive) throw error;
    const safeCode = SOURCE_ERROR.test(error.code) ? error.code : 'repositoryrealms_request_failed';
    return {
      outcome: 'failed',
      external_request_id: `rr_error_${createHash('sha256').update(`${operation}\0${idempotencyKey}\0${safeCode}`).digest('hex').slice(0, 24)}`,
      result_fingerprint: actionFingerprint({ operation, status: error.status, code: safeCode }),
      result_code: safeCode,
      actual_cost_minor: 0,
      currency: 'VND',
      external_mutation_count: 0,
    };
  }
}
