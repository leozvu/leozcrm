import { evidenceFingerprint } from './phase2Proof';
import {
  G6ActionPolicyManifest,
  credentialFingerprint,
  g6PolicyFingerprint,
  validateG6ActionPolicy,
} from './g6Policy';
import {
  SupervisedHandQualification,
  supervisedHandBlockers,
  validateSupervisedHandQualification,
} from './supervisedHand';
import {
  REPOSITORYREALMS_TASK_COMMAND_ADAPTER_ID,
  REPOSITORYREALMS_TASK_COMMAND_ADAPTER_VERSION,
  REPOSITORYREALMS_TASK_COMMAND_CONTRACT,
  REPOSITORYREALMS_TASK_COMMAND_KEY,
  REPOSITORYREALMS_TASK_COMMAND_PATH,
  REPOSITORYREALMS_TASK_COMMAND_RECEIPT_CONTRACT,
  REPOSITORYREALMS_TASK_COMMAND_VERSION,
  REPOSITORYREALMS_TASK_RECEIPT_PATH,
  RepositoryRealmsTaskCommandCredentialSet,
  RepositoryRealmsTaskCommandSubjects,
} from '../integrations/actions/repositoryRealmsTaskCommandAdapter';

export const REPOSITORYREALMS_ACTION_RELEASE_SCHEMA = 'leozops_repositoryrealms_task_action_release_v1' as const;

export interface RepositoryRealmsActionReleaseManifest {
  schema_version: typeof REPOSITORYREALMS_ACTION_RELEASE_SCHEMA;
  release_id: string;
  status: 'accepted';
  environment: 'test' | 'production';
  approved_by: string;
  approved_at: string;
  valid_from: string;
  valid_until: string;
  source: {
    repository: 'leozvu/repositoryrealms';
    source_ref: 'main';
    source_commit: string;
    qualification_fingerprint: string;
    source_patch_fingerprint: string;
    contract: typeof REPOSITORYREALMS_TASK_COMMAND_CONTRACT;
    receipt_contract: typeof REPOSITORYREALMS_TASK_COMMAND_RECEIPT_CONTRACT;
    version: typeof REPOSITORYREALMS_TASK_COMMAND_VERSION;
    command_key: typeof REPOSITORYREALMS_TASK_COMMAND_KEY;
    endpoint_path: typeof REPOSITORYREALMS_TASK_COMMAND_PATH;
    receipt_path: typeof REPOSITORYREALMS_TASK_RECEIPT_PATH;
  };
  gates: {
    g5_decision_id: string;
    g5_evidence_key: string;
    g6_policy_id: string;
    g6_policy_fingerprint: string;
    registration_decision_id: string;
    registration_evidence_fingerprint: string;
  };
  target: {
    entity_id: string;
    project_id: string;
    tenant_key: string;
    endpoint_url: string;
  };
  adapter: {
    adapter_id: typeof REPOSITORYREALMS_TASK_COMMAND_ADAPTER_ID;
    adapter_version: typeof REPOSITORYREALMS_TASK_COMMAND_ADAPTER_VERSION;
    artifact_digest: string;
    configuration_digest: string;
  };
  credential_references: Record<keyof RepositoryRealmsTaskCommandCredentialSet, string>;
  subjects: RepositoryRealmsTaskCommandSubjects;
  safety: {
    explicit_invocation_only: true;
    automatic_retry: false;
    automatic_rollback: false;
    generic_tool_access: false;
    production_registry_default_empty: true;
    r4_human_approval_required: true;
  };
  verdict: 'accepted';
}

export interface RepositoryRealmsActionReleaseValidation {
  value: RepositoryRealmsActionReleaseManifest;
  fingerprint: string;
  qualification: SupervisedHandQualification;
  g6_policy: G6ActionPolicyManifest;
}

export class RepositoryRealmsActionReleaseError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'RepositoryRealmsActionReleaseError';
  }
}

const ROOT_KEYS = [
  'schema_version', 'release_id', 'status', 'environment', 'approved_by', 'approved_at',
  'valid_from', 'valid_until', 'source', 'gates', 'target', 'adapter',
  'credential_references', 'subjects', 'safety', 'verdict',
] as const;
const SOURCE_KEYS = [
  'repository', 'source_ref', 'source_commit', 'qualification_fingerprint', 'source_patch_fingerprint',
  'contract', 'receipt_contract', 'version', 'command_key', 'endpoint_path', 'receipt_path',
] as const;
const GATE_KEYS = [
  'g5_decision_id', 'g5_evidence_key', 'g6_policy_id', 'g6_policy_fingerprint',
  'registration_decision_id', 'registration_evidence_fingerprint',
] as const;
const TARGET_KEYS = ['entity_id', 'project_id', 'tenant_key', 'endpoint_url'] as const;
const ADAPTER_KEYS = ['adapter_id', 'adapter_version', 'artifact_digest', 'configuration_digest'] as const;
const CREDENTIAL_KEYS: Array<keyof RepositoryRealmsTaskCommandCredentialSet> = [
  'preview', 'approve_execute', 'execute', 'preview_rollback', 'approve_rollback', 'rollback', 'receipts_read',
];
const SUBJECT_KEYS: Array<keyof RepositoryRealmsTaskCommandSubjects> = [
  'preview', 'approve_execute', 'execute', 'preview_rollback', 'approve_rollback', 'rollback',
];
const SAFETY_KEYS = [
  'explicit_invocation_only', 'automatic_retry', 'automatic_rollback', 'generic_tool_access',
  'production_registry_default_empty', 'r4_human_approval_required',
] as const;
const HASH = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,191}$/;
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9:_-]{2,159}$/;

function error(message: string): never {
  throw new RepositoryRealmsActionReleaseError('invalid_repositoryrealms_action_release', message);
}

function object(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) error(`${path} must be an object`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join('\0') !== [...keys].sort().join('\0')) error(`${path} keys are invalid`);
  return record;
}

function literal<T extends string | number | boolean>(value: unknown, expected: T, path: string): T {
  if (value !== expected) error(`${path} must equal ${String(expected)}`);
  return expected;
}

function safe(value: unknown, path: string, pattern = SAFE): string {
  if (
    typeof value !== 'string'
    || value.length < 2
    || value.length > 256
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
    || !pattern.test(value)
  ) error(`${path} is invalid`);
  return value;
}

function hash(value: unknown, path: string): string {
  return safe(value, path, HASH);
}

function time(value: unknown, path: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) error(`${path} is invalid`);
  return new Date(value).toISOString();
}

function endpoint(value: unknown, environment: 'test' | 'production'): string {
  if (typeof value !== 'string') error('release.target.endpoint_url is invalid');
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
    ) throw new Error('invalid endpoint');
    return url.toString();
  } catch {
    return error('release.target.endpoint_url must be the exact credential-free task command URL');
  }
}

function credentialReferences(input: unknown): Record<keyof RepositoryRealmsTaskCommandCredentialSet, string> {
  const root = object(input, CREDENTIAL_KEYS, 'release.credential_references');
  const result = Object.fromEntries(CREDENTIAL_KEYS.map((key) => [
    key,
    hash(root[key], `release.credential_references.${key}`),
  ])) as unknown as Record<keyof RepositoryRealmsTaskCommandCredentialSet, string>;
  if (new Set(Object.values(result)).size !== CREDENTIAL_KEYS.length) {
    error('release credential references must be distinct');
  }
  return result;
}

function subjects(input: unknown): RepositoryRealmsTaskCommandSubjects {
  const root = object(input, SUBJECT_KEYS, 'release.subjects');
  const result = Object.fromEntries(SUBJECT_KEYS.map((key) => [
    key,
    safe(root[key], `release.subjects.${key}`, SUBJECT),
  ])) as unknown as RepositoryRealmsTaskCommandSubjects;
  if (result.approve_execute === result.execute || result.approve_rollback === result.rollback) {
    error('source approver and operator subjects must be separate');
  }
  return result;
}

export function repositoryRealmsReleaseConfigurationDigest(
  value: Pick<RepositoryRealmsActionReleaseManifest,
  'environment' | 'source' | 'gates' | 'target' | 'credential_references' | 'subjects' | 'safety'> & {
    adapter: Omit<RepositoryRealmsActionReleaseManifest['adapter'], 'configuration_digest'>;
  },
): string {
  return evidenceFingerprint(value);
}

export function validateRepositoryRealmsActionRelease(
  input: unknown,
  context: { qualification: unknown; g6Policy: unknown },
): RepositoryRealmsActionReleaseValidation {
  const qualification = validateSupervisedHandQualification(context.qualification);
  if (
    qualification.value.source_state !== 'merged_main'
    || qualification.value.source_ref !== 'main'
    || qualification.value.verdict !== 'qualified'
    || supervisedHandBlockers(qualification.value, 1).length !== 0
  ) error('source qualification is not an immutable canonical release');
  const g6 = validateG6ActionPolicy(context.g6Policy);
  if (!g6.ok || !g6.value || !g6.fingerprint) error(`G6 policy is invalid: ${g6.issues.join('; ')}`);

  const root = object(input, ROOT_KEYS, 'release');
  const environment = root.environment === 'test'
    ? 'test' as const
    : root.environment === 'production'
      ? 'production' as const
      : error('release.environment is invalid');
  const sourceRoot = object(root.source, SOURCE_KEYS, 'release.source');
  const gateRoot = object(root.gates, GATE_KEYS, 'release.gates');
  const targetRoot = object(root.target, TARGET_KEYS, 'release.target');
  const adapterRoot = object(root.adapter, ADAPTER_KEYS, 'release.adapter');
  const safetyRoot = object(root.safety, SAFETY_KEYS, 'release.safety');
  const approvedAt = time(root.approved_at, 'release.approved_at');
  const validFrom = time(root.valid_from, 'release.valid_from');
  const validUntil = time(root.valid_until, 'release.valid_until');
  if (
    Date.parse(approvedAt) > Date.parse(validFrom)
    || Date.parse(validFrom) >= Date.parse(validUntil)
    || Date.parse(validUntil) - Date.parse(validFrom) > 24 * 60 * 60_000
    || Date.parse(validFrom) < Date.parse(g6.value.valid_from)
    || Date.parse(validUntil) > Date.parse(g6.value.valid_until)
  ) error('release validity must be a bounded subset of the G6 policy');
  const targetEndpoint = endpoint(targetRoot.endpoint_url, environment);
  const credentialRefs = credentialReferences(root.credential_references);
  const sourceSubjects = subjects(root.subjects);
  const value: RepositoryRealmsActionReleaseManifest = {
    schema_version: literal(root.schema_version, REPOSITORYREALMS_ACTION_RELEASE_SCHEMA, 'release.schema_version'),
    release_id: safe(root.release_id, 'release.release_id'),
    status: literal(root.status, 'accepted', 'release.status'),
    environment,
    approved_by: safe(root.approved_by, 'release.approved_by'),
    approved_at: approvedAt,
    valid_from: validFrom,
    valid_until: validUntil,
    source: {
      repository: literal(sourceRoot.repository, 'leozvu/repositoryrealms', 'release.source.repository'),
      source_ref: literal(sourceRoot.source_ref, 'main', 'release.source.source_ref'),
      source_commit: safe(sourceRoot.source_commit, 'release.source.source_commit', COMMIT),
      qualification_fingerprint: hash(sourceRoot.qualification_fingerprint, 'release.source.qualification_fingerprint'),
      source_patch_fingerprint: hash(sourceRoot.source_patch_fingerprint, 'release.source.source_patch_fingerprint'),
      contract: literal(sourceRoot.contract, REPOSITORYREALMS_TASK_COMMAND_CONTRACT, 'release.source.contract'),
      receipt_contract: literal(sourceRoot.receipt_contract, REPOSITORYREALMS_TASK_COMMAND_RECEIPT_CONTRACT, 'release.source.receipt_contract'),
      version: literal(sourceRoot.version, REPOSITORYREALMS_TASK_COMMAND_VERSION, 'release.source.version'),
      command_key: literal(sourceRoot.command_key, REPOSITORYREALMS_TASK_COMMAND_KEY, 'release.source.command_key'),
      endpoint_path: literal(sourceRoot.endpoint_path, REPOSITORYREALMS_TASK_COMMAND_PATH, 'release.source.endpoint_path'),
      receipt_path: literal(sourceRoot.receipt_path, REPOSITORYREALMS_TASK_RECEIPT_PATH, 'release.source.receipt_path'),
    },
    gates: {
      g5_decision_id: safe(gateRoot.g5_decision_id, 'release.gates.g5_decision_id'),
      g5_evidence_key: hash(gateRoot.g5_evidence_key, 'release.gates.g5_evidence_key'),
      g6_policy_id: safe(gateRoot.g6_policy_id, 'release.gates.g6_policy_id'),
      g6_policy_fingerprint: hash(gateRoot.g6_policy_fingerprint, 'release.gates.g6_policy_fingerprint'),
      registration_decision_id: safe(gateRoot.registration_decision_id, 'release.gates.registration_decision_id'),
      registration_evidence_fingerprint: hash(gateRoot.registration_evidence_fingerprint, 'release.gates.registration_evidence_fingerprint'),
    },
    target: {
      entity_id: safe(targetRoot.entity_id, 'release.target.entity_id'),
      project_id: safe(targetRoot.project_id, 'release.target.project_id'),
      tenant_key: safe(targetRoot.tenant_key, 'release.target.tenant_key'),
      endpoint_url: targetEndpoint,
    },
    adapter: {
      adapter_id: literal(adapterRoot.adapter_id, REPOSITORYREALMS_TASK_COMMAND_ADAPTER_ID, 'release.adapter.adapter_id'),
      adapter_version: literal(adapterRoot.adapter_version, REPOSITORYREALMS_TASK_COMMAND_ADAPTER_VERSION, 'release.adapter.adapter_version'),
      artifact_digest: hash(adapterRoot.artifact_digest, 'release.adapter.artifact_digest'),
      configuration_digest: hash(adapterRoot.configuration_digest, 'release.adapter.configuration_digest'),
    },
    credential_references: credentialRefs,
    subjects: sourceSubjects,
    safety: {
      explicit_invocation_only: literal(safetyRoot.explicit_invocation_only, true, 'release.safety.explicit_invocation_only'),
      automatic_retry: literal(safetyRoot.automatic_retry, false, 'release.safety.automatic_retry'),
      automatic_rollback: literal(safetyRoot.automatic_rollback, false, 'release.safety.automatic_rollback'),
      generic_tool_access: literal(safetyRoot.generic_tool_access, false, 'release.safety.generic_tool_access'),
      production_registry_default_empty: literal(safetyRoot.production_registry_default_empty, true, 'release.safety.production_registry_default_empty'),
      r4_human_approval_required: literal(safetyRoot.r4_human_approval_required, true, 'release.safety.r4_human_approval_required'),
    },
    verdict: literal(root.verdict, 'accepted', 'release.verdict'),
  };

  if (
    value.environment !== g6.value.environment
    || value.source.source_commit !== qualification.value.source_commit
    || value.source.qualification_fingerprint !== qualification.fingerprint
    || value.source.source_patch_fingerprint !== qualification.value.source_patch_fingerprint
    || value.gates.g5_decision_id !== g6.value.g5_release.decision_id
    || value.gates.g5_evidence_key !== g6.value.g5_release.evidence_key
    || value.gates.g6_policy_id !== g6.value.policy_id
    || value.gates.g6_policy_fingerprint !== g6PolicyFingerprint(g6.value)
    || value.target.project_id !== g6.value.target.project_id
    || value.target.tenant_key !== g6.value.target.tenant_key
    || value.target.endpoint_url !== g6.value.target.command_endpoint_url
    || value.adapter.adapter_id !== g6.value.command.adapter_id
    || g6.value.command.key !== REPOSITORYREALMS_TASK_COMMAND_KEY
    || g6.value.command.version !== 'v1'
    || g6.value.command.risk_tier !== 'low'
    || g6.value.limits.currency !== 'VND'
    || value.credential_references.execute !== g6.value.target.command_credential_sha256
  ) error('release does not exactly bind source qualification and G6 policy');

  const expectedConfigurationDigest = repositoryRealmsReleaseConfigurationDigest({
    environment: value.environment,
    source: value.source,
    gates: value.gates,
    target: value.target,
    adapter: {
      adapter_id: value.adapter.adapter_id,
      adapter_version: value.adapter.adapter_version,
      artifact_digest: value.adapter.artifact_digest,
    },
    credential_references: value.credential_references,
    subjects: value.subjects,
    safety: value.safety,
  });
  if (value.adapter.configuration_digest !== expectedConfigurationDigest) {
    error('release adapter configuration digest is invalid');
  }
  return { value, fingerprint: evidenceFingerprint(value), qualification: qualification.value, g6_policy: g6.value };
}

export function verifyRepositoryRealmsReleaseCredentials(
  release: RepositoryRealmsActionReleaseManifest,
  credentials: RepositoryRealmsTaskCommandCredentialSet,
): void {
  const values = CREDENTIAL_KEYS.map((key) => credentials[key]);
  if (new Set(values).size !== CREDENTIAL_KEYS.length) {
    error('runtime credentials are not separated');
  }
  for (const key of CREDENTIAL_KEYS) {
    let actual: string;
    try { actual = credentialFingerprint(credentials[key]); }
    catch { return error(`runtime credential ${key} is invalid`); }
    if (actual !== release.credential_references[key]) {
      error(`runtime credential ${key} does not match its release reference`);
    }
  }
}
