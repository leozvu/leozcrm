import { createHash } from 'node:crypto';
import { canonicalStringify } from './businessMemory';
import { evidenceFingerprint } from './phase2Proof';
import type { Phase2ReleaseDecisionRecord } from './shadowTrust';

export const G6_POLICY_SCHEMA_VERSION = 'leozops_g6_action_policy_v1' as const;

export type ActionRiskTier = 'low' | 'medium';

export interface G6ActionPolicyManifest {
  schema_version: typeof G6_POLICY_SCHEMA_VERSION;
  policy_id: string;
  status: 'accepted';
  environment: 'test' | 'production';
  approved_by: string;
  approved_at: string;
  valid_from: string;
  valid_until: string;
  tenant_id: string;
  source_connection_id: string;
  g5_release: {
    decision_id: string;
    evidence_key: string;
    evaluation_fingerprint: string;
    decision: 'go';
  };
  target: {
    system: 'egoric';
    project_id: string;
    tenant_key: string;
    command_endpoint_url: string;
    command_credential_sha256: string;
  };
  command: {
    key: string;
    version: string;
    adapter_id: string;
    risk_tier: ActionRiskTier;
    supports_dry_run: true;
    supports_idempotency: true;
    supports_rollback: true;
    mutation_count_max: 1;
  };
  identities: {
    approver: string;
    approval_credential_sha256: string;
    operator: string;
    operator_credential_sha256: string;
  };
  limits: {
    max_cost_minor: number;
    currency: string;
    max_executions_per_hour: number;
    max_executions_per_day: number;
    approval_ttl_minutes: number;
    execution_lease_seconds: number;
  };
  verdict: 'accepted';
}

export interface G6PolicyValidation {
  ok: boolean;
  issues: string[];
  value?: G6ActionPolicyManifest;
  fingerprint?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,191}$/;
const COMMAND = /^egoric\.[a-z0-9]+(?:[._-][a-z0-9]+)*\.v[1-9][0-9]*$/;
const PLACEHOLDER = /(?:^|[-_:/])(?:tbd|todo|pending|unknown|null|n\/a|replace(?:_me)?)(?:$|[-_:/])|<.*>/i;
const SENSITIVE_KEY = /(?:^|_)(?:address|api_?key|authorization|bank|card|cookie|credential|email|full_?name|mobile|name|password|phone|secret|ssn|tax|token)(?:$|_)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown, path: string, issues: string[]): Record<string, unknown> {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return {};
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  issues: string[],
): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) issues.push(`${path}.${key} is not allowed`);
  }
  for (const key of keys) {
    if (!(key in value)) issues.push(`${path}.${key} is required`);
  }
}

function safeString(
  value: unknown,
  path: string,
  issues: string[],
  pattern: RegExp = SAFE_ID,
): string {
  if (
    typeof value !== 'string'
    || value.length < 2
    || value.length > 256
    || value.trim() !== value
    || PLACEHOLDER.test(value)
    || /[\u0000-\u001f\u007f]/.test(value)
    || !pattern.test(value)
  ) {
    issues.push(`${path} must be a concrete safe value`);
    return '';
  }
  return value;
}

function timestamp(value: unknown, path: string, issues: string[]): string {
  const parsed = safeString(
    value,
    path,
    issues,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  );
  if (parsed && Number.isNaN(Date.parse(parsed))) issues.push(`${path} must be a valid timestamp`);
  return parsed;
}

function boundedInteger(
  value: unknown,
  path: string,
  issues: string[],
  min: number,
  max: number,
): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    issues.push(`${path} must be an integer from ${min} to ${max}`);
    return min;
  }
  return Number(value);
}

function commandEndpoint(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== 'string' || value.length > 512 || value.trim() !== value || PLACEHOLDER.test(value)) {
    issues.push(`${path} must be a concrete HTTPS command URL`);
    return '';
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.search
      || url.hash
      || !/^\/api\/integrations\/leozops\/v1\/commands\/[a-z0-9-]+$/.test(url.pathname)
    ) throw new Error('unsafe endpoint');
    return url.toString();
  } catch {
    issues.push(`${path} must be a credential-free dedicated HTTPS command URL`);
    return '';
  }
}

export function g6PolicyFingerprint(value: G6ActionPolicyManifest): string {
  return evidenceFingerprint(value);
}

export function validateG6ActionPolicy(
  input: unknown,
  g5Decision?: Phase2ReleaseDecisionRecord,
): G6PolicyValidation {
  const issues: string[] = [];
  const root = objectAt(input, 'policy', issues);
  exactKeys(root, [
    'schema_version',
    'policy_id',
    'status',
    'environment',
    'approved_by',
    'approved_at',
    'valid_from',
    'valid_until',
    'tenant_id',
    'source_connection_id',
    'g5_release',
    'target',
    'command',
    'identities',
    'limits',
    'verdict',
  ], 'policy', issues);

  if (root.schema_version !== G6_POLICY_SCHEMA_VERSION) {
    issues.push(`policy.schema_version must equal ${G6_POLICY_SCHEMA_VERSION}`);
  }
  if (root.status !== 'accepted') issues.push('policy.status must equal accepted');
  if (root.verdict !== 'accepted') issues.push('policy.verdict must equal accepted');
  if (root.environment !== 'test' && root.environment !== 'production') {
    issues.push('policy.environment must equal test or production');
  }

  const approvedAt = timestamp(root.approved_at, 'policy.approved_at', issues);
  const validFrom = timestamp(root.valid_from, 'policy.valid_from', issues);
  const validUntil = timestamp(root.valid_until, 'policy.valid_until', issues);
  if (approvedAt && validFrom && Date.parse(approvedAt) > Date.parse(validFrom)) {
    issues.push('policy.approved_at cannot follow valid_from');
  }
  if (validFrom && validUntil && Date.parse(validUntil) <= Date.parse(validFrom)) {
    issues.push('policy.valid_until must follow valid_from');
  }
  if (validFrom && validUntil && Date.parse(validUntil) - Date.parse(validFrom) > 90 * 86_400_000) {
    issues.push('policy validity cannot exceed 90 days');
  }

  const g5Root = objectAt(root.g5_release, 'policy.g5_release', issues);
  exactKeys(g5Root, [
    'decision_id',
    'evidence_key',
    'evaluation_fingerprint',
    'decision',
  ], 'policy.g5_release', issues);
  if (g5Root.decision !== 'go') issues.push('policy.g5_release.decision must equal go');
  const g5Release = {
    decision_id: safeString(g5Root.decision_id, 'policy.g5_release.decision_id', issues, UUID),
    evidence_key: safeString(g5Root.evidence_key, 'policy.g5_release.evidence_key', issues, HASH),
    evaluation_fingerprint: safeString(
      g5Root.evaluation_fingerprint,
      'policy.g5_release.evaluation_fingerprint',
      issues,
      HASH,
    ),
    decision: 'go' as const,
  };

  const targetRoot = objectAt(root.target, 'policy.target', issues);
  exactKeys(
    targetRoot,
    ['system', 'project_id', 'tenant_key', 'command_endpoint_url', 'command_credential_sha256'],
    'policy.target',
    issues,
  );
  if (targetRoot.system !== 'egoric') issues.push('policy.target.system must equal egoric');
  const target = {
    system: 'egoric' as const,
    project_id: safeString(targetRoot.project_id, 'policy.target.project_id', issues),
    tenant_key: safeString(targetRoot.tenant_key, 'policy.target.tenant_key', issues),
    command_endpoint_url: commandEndpoint(
      targetRoot.command_endpoint_url,
      'policy.target.command_endpoint_url',
      issues,
    ),
    command_credential_sha256: safeString(
      targetRoot.command_credential_sha256,
      'policy.target.command_credential_sha256',
      issues,
      HASH,
    ),
  };

  const commandRoot = objectAt(root.command, 'policy.command', issues);
  exactKeys(commandRoot, [
    'key',
    'version',
    'adapter_id',
    'risk_tier',
    'supports_dry_run',
    'supports_idempotency',
    'supports_rollback',
    'mutation_count_max',
  ], 'policy.command', issues);
  if (commandRoot.risk_tier !== 'low' && commandRoot.risk_tier !== 'medium') {
    issues.push('policy.command.risk_tier must equal low or medium');
  }
  for (const capability of ['supports_dry_run', 'supports_idempotency', 'supports_rollback'] as const) {
    if (commandRoot[capability] !== true) issues.push(`policy.command.${capability} must equal true`);
  }
  if (commandRoot.mutation_count_max !== 1) {
    issues.push('policy.command.mutation_count_max must equal 1');
  }
  const command = {
    key: safeString(commandRoot.key, 'policy.command.key', issues, COMMAND),
    version: safeString(commandRoot.version, 'policy.command.version', issues, /^v[1-9][0-9]*$/),
    adapter_id: safeString(commandRoot.adapter_id, 'policy.command.adapter_id', issues),
    risk_tier: commandRoot.risk_tier === 'medium' ? 'medium' as const : 'low' as const,
    supports_dry_run: true as const,
    supports_idempotency: true as const,
    supports_rollback: true as const,
    mutation_count_max: 1 as const,
  };

  const identitiesRoot = objectAt(root.identities, 'policy.identities', issues);
  exactKeys(identitiesRoot, [
    'approver',
    'approval_credential_sha256',
    'operator',
    'operator_credential_sha256',
  ], 'policy.identities', issues);
  const identities = {
    approver: safeString(
      identitiesRoot.approver,
      'policy.identities.approver',
      issues,
      /^[^\u0000-\u001f\u007f]{2,128}$/,
    ),
    approval_credential_sha256: safeString(
      identitiesRoot.approval_credential_sha256,
      'policy.identities.approval_credential_sha256',
      issues,
      HASH,
    ),
    operator: safeString(
      identitiesRoot.operator,
      'policy.identities.operator',
      issues,
      /^[^\u0000-\u001f\u007f]{2,128}$/,
    ),
    operator_credential_sha256: safeString(
      identitiesRoot.operator_credential_sha256,
      'policy.identities.operator_credential_sha256',
      issues,
      HASH,
    ),
  };
  if (
    identities.approval_credential_sha256
    && identities.approval_credential_sha256 === identities.operator_credential_sha256
  ) {
    issues.push('approval and operator credential fingerprints must be different');
  }
  if (
    target.command_credential_sha256
    && [
      identities.approval_credential_sha256,
      identities.operator_credential_sha256,
    ].includes(target.command_credential_sha256)
  ) issues.push('command credential fingerprint must be separate from human credentials');

  const limitsRoot = objectAt(root.limits, 'policy.limits', issues);
  exactKeys(limitsRoot, [
    'max_cost_minor',
    'currency',
    'max_executions_per_hour',
    'max_executions_per_day',
    'approval_ttl_minutes',
    'execution_lease_seconds',
  ], 'policy.limits', issues);
  const limits = {
    max_cost_minor: boundedInteger(limitsRoot.max_cost_minor, 'policy.limits.max_cost_minor', issues, 0, 1_000_000),
    currency: safeString(limitsRoot.currency, 'policy.limits.currency', issues, /^[A-Z]{3}$/),
    max_executions_per_hour: boundedInteger(
      limitsRoot.max_executions_per_hour,
      'policy.limits.max_executions_per_hour',
      issues,
      1,
      60,
    ),
    max_executions_per_day: boundedInteger(
      limitsRoot.max_executions_per_day,
      'policy.limits.max_executions_per_day',
      issues,
      1,
      500,
    ),
    approval_ttl_minutes: boundedInteger(
      limitsRoot.approval_ttl_minutes,
      'policy.limits.approval_ttl_minutes',
      issues,
      5,
      60,
    ),
    execution_lease_seconds: boundedInteger(
      limitsRoot.execution_lease_seconds,
      'policy.limits.execution_lease_seconds',
      issues,
      30,
      300,
    ),
  };
  if (limits.max_executions_per_hour > limits.max_executions_per_day) {
    issues.push('hourly execution limit cannot exceed daily execution limit');
  }

  const tenantId = safeString(root.tenant_id, 'policy.tenant_id', issues, UUID);
  const sourceConnectionId = safeString(
    root.source_connection_id,
    'policy.source_connection_id',
    issues,
    UUID,
  );

  if (g5Decision !== undefined) {
    if (g5Decision.id !== g5Release.decision_id) {
      issues.push('policy G5 decision ID does not match the supplied release evidence');
    }
    if (g5Decision.evidence_key !== g5Release.evidence_key) {
      issues.push('policy G5 evidence key does not match the supplied release evidence');
    }
    if (g5Decision.evaluation_fingerprint !== g5Release.evaluation_fingerprint) {
      issues.push('policy G5 evaluation fingerprint does not match the supplied release evidence');
    }
    if (g5Decision.decision !== 'go') issues.push('supplied G5 release decision is not go');
    if (g5Decision.tenant_id !== tenantId) issues.push('policy tenant does not match G5 evidence');
    if (g5Decision.source_connection_id !== sourceConnectionId) {
      issues.push('policy source connection does not match G5 evidence');
    }
  }

  const value: G6ActionPolicyManifest = {
    schema_version: G6_POLICY_SCHEMA_VERSION,
    policy_id: safeString(root.policy_id, 'policy.policy_id', issues, /^G6-[A-Za-z0-9._-]{4,64}$/),
    status: 'accepted',
    environment: root.environment === 'production' ? 'production' : 'test',
    approved_by: safeString(
      root.approved_by,
      'policy.approved_by',
      issues,
      /^[^\u0000-\u001f\u007f]{2,128}$/,
    ),
    approved_at: approvedAt,
    valid_from: validFrom,
    valid_until: validUntil,
    tenant_id: tenantId,
    source_connection_id: sourceConnectionId,
    g5_release: g5Release,
    target,
    command,
    identities,
    limits,
    verdict: 'accepted',
  };
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    issues: [],
    value,
    fingerprint: g6PolicyFingerprint(value),
  };
}

export function credentialFingerprint(secret: string): string {
  if (typeof secret !== 'string' || secret.length < 16 || secret.length > 4096) {
    throw new Error('credential must contain 16 to 4096 characters');
  }
  return `sha256:${createHash('sha256').update(secret).digest('hex')}`;
}

function validateSafeJsonValue(value: unknown, path: string, depth: number): void {
  if (depth > 5) throw new Error(`${path} exceeds maximum depth`);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer`);
    return;
  }
  if (typeof value === 'string') {
    if (
      value.length < 1
      || value.length > 512
      || /[\u0000-\u001f\u007f]/.test(value)
      || /(?:bearer\s+|-----BEGIN|(?:api|secret|access|refresh)[_-]?token)/i.test(value)
    ) throw new Error(`${path} contains unsafe text`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 50) throw new Error(`${path} exceeds maximum array length`);
    value.forEach((item, index) => validateSafeJsonValue(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!isRecord(value)) throw new Error(`${path} contains an unsupported value`);
  const keys = Object.keys(value);
  if (keys.length > 40) throw new Error(`${path} exceeds maximum field count`);
  for (const key of keys) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) throw new Error(`${path}.${key} has an unsafe key`);
    if (SENSITIVE_KEY.test(key)) throw new Error(`${path}.${key} is a denied sensitive field`);
    validateSafeJsonValue(value[key], `${path}.${key}`, depth + 1);
  }
}

export function canonicalSafeActionPayload(value: unknown): string {
  if (!isRecord(value)) throw new Error('action payload must be an object');
  validateSafeJsonValue(value, 'payload', 0);
  const canonical = canonicalStringify(value);
  if (Buffer.byteLength(canonical, 'utf8') > 8_192) {
    throw new Error('action payload exceeds 8192 bytes');
  }
  return canonical;
}
