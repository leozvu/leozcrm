import { createHash } from 'node:crypto';
import { canonicalStringify } from './businessMemory';
import {
  P1DecisionManifest,
  validateP1Decision,
} from './p1Decision';

export const CHECKPOINT_B_SCHEMA_VERSION = 'leozops_checkpoint_b_v1' as const;
export const P2_DECISION_SCHEMA_VERSION = 'leozops_p2_decision_v1' as const;

export type EvidenceCheck = {
  status: 'pass';
  evidence_ref: string;
};

export interface CheckpointBEvidence {
  schema_version: typeof CHECKPOINT_B_SCHEMA_VERSION;
  evidence_id: string;
  environment: 'test';
  recorded_by: string;
  started_at: string;
  completed_at: string;
  p1_decision_id: string;
  p1_decision_fingerprint: string;
  deployment: {
    runtime_project_id: string;
    database_id: string;
    egoric_project_id: string;
    revision: string;
    config_fingerprint: string;
  };
  checks: {
    source_disabled_boot: EvidenceCheck;
    public_health: EvidenceCheck;
    output_auth_denial: EvidenceCheck;
    migrations_current: EvidenceCheck;
    postgres_rollback: EvidenceCheck;
    network_200: EvidenceCheck;
    network_304: EvidenceCheck;
    exact_reconciliation: EvidenceCheck;
    pii_scan: EvidenceCheck;
    cross_instance_denial: EvidenceCheck;
    malformed_method_denial: EvidenceCheck;
    latency_error_comparison: EvidenceCheck;
    key_rotation: EvidenceCheck;
    source_flag_shutdown: EvidenceCheck;
    deployment_rollback: EvidenceCheck;
    secret_scan: EvidenceCheck;
  };
  source_request_methods: ['GET'];
  source_request_bodies: 0;
  source_mutation_count: 0;
  secret_findings: 0;
  pii_findings: 0;
  rollback_required_source_restore: false;
  verdict: 'pass';
}

export interface P2DecisionManifest {
  schema_version: typeof P2_DECISION_SCHEMA_VERSION;
  decision_id: string;
  status: 'approved';
  approved_by: string;
  approved_at: string;
  p1_decision_id: string;
  p1_decision_fingerprint: string;
  checkpoint_b_evidence_id: string;
  checkpoint_b_fingerprint: string;
  production: {
    runtime_project_id: string;
    database_id: string;
    egoric_project_id: string;
    source_tenant_key: string;
  };
  scope: 'company_ceo_brief_readonly';
  poll_schedule_minutes: 15;
  shadow_business_days: 10;
  verdict: 'approved';
}

export interface Phase2Validation<T> {
  ok: boolean;
  issues: string[];
  value?: T;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,191}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const PLACEHOLDER = /(?:^|[-_:/])(?:tbd|todo|pending|unknown|null|n\/a|replace(?:_me)?)(?:$|[-_:/])|<.*>/i;
const CHECK_NAMES = [
  'source_disabled_boot',
  'public_health',
  'output_auth_denial',
  'migrations_current',
  'postgres_rollback',
  'network_200',
  'network_304',
  'exact_reconciliation',
  'pii_scan',
  'cross_instance_denial',
  'malformed_method_denial',
  'latency_error_comparison',
  'key_rotation',
  'source_flag_shutdown',
  'deployment_rollback',
  'secret_scan',
] as const;

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
  allowed: readonly string[],
  path: string,
  issues: string[],
): void {
  const expected = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) issues.push(`${path}.${key} is not allowed`);
  }
  for (const key of allowed) {
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

function hash(value: unknown, path: string, issues: string[]): string {
  return safeString(value, path, issues, HASH);
}

function zero(value: unknown, path: string, issues: string[]): 0 {
  if (value !== 0) issues.push(`${path} must equal zero`);
  return 0;
}

function falseValue(value: unknown, path: string, issues: string[]): false {
  if (value !== false) issues.push(`${path} must equal false`);
  return false;
}

function evidenceCheck(value: unknown, path: string, issues: string[]): EvidenceCheck {
  const item = objectAt(value, path, issues);
  exactKeys(item, ['status', 'evidence_ref'], path, issues);
  if (item.status !== 'pass') issues.push(`${path}.status must equal pass`);
  return {
    status: 'pass',
    evidence_ref: safeString(item.evidence_ref, `${path}.evidence_ref`, issues),
  };
}

export function evidenceFingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

export function p1DecisionFingerprint(value: P1DecisionManifest): string {
  return evidenceFingerprint(value);
}

export function validateCheckpointBEvidence(
  input: unknown,
  p1Input?: unknown,
): Phase2Validation<CheckpointBEvidence> {
  const issues: string[] = [];
  const root = objectAt(input, 'evidence', issues);
  exactKeys(root, [
    'schema_version',
    'evidence_id',
    'environment',
    'recorded_by',
    'started_at',
    'completed_at',
    'p1_decision_id',
    'p1_decision_fingerprint',
    'deployment',
    'checks',
    'source_request_methods',
    'source_request_bodies',
    'source_mutation_count',
    'secret_findings',
    'pii_findings',
    'rollback_required_source_restore',
    'verdict',
  ], 'evidence', issues);

  if (root.schema_version !== CHECKPOINT_B_SCHEMA_VERSION) {
    issues.push(`evidence.schema_version must equal ${CHECKPOINT_B_SCHEMA_VERSION}`);
  }
  if (root.environment !== 'test') issues.push('evidence.environment must equal test');
  if (root.verdict !== 'pass') issues.push('evidence.verdict must equal pass');
  const startedAt = timestamp(root.started_at, 'evidence.started_at', issues);
  const completedAt = timestamp(root.completed_at, 'evidence.completed_at', issues);
  if (startedAt && completedAt && Date.parse(completedAt) < Date.parse(startedAt)) {
    issues.push('evidence.completed_at cannot precede started_at');
  }

  const deploymentRoot = objectAt(root.deployment, 'evidence.deployment', issues);
  exactKeys(deploymentRoot, [
    'runtime_project_id',
    'database_id',
    'egoric_project_id',
    'revision',
    'config_fingerprint',
  ], 'evidence.deployment', issues);
  const deployment = {
    runtime_project_id: safeString(
      deploymentRoot.runtime_project_id,
      'evidence.deployment.runtime_project_id',
      issues,
    ),
    database_id: safeString(deploymentRoot.database_id, 'evidence.deployment.database_id', issues),
    egoric_project_id: safeString(
      deploymentRoot.egoric_project_id,
      'evidence.deployment.egoric_project_id',
      issues,
    ),
    revision: safeString(deploymentRoot.revision, 'evidence.deployment.revision', issues),
    config_fingerprint: hash(
      deploymentRoot.config_fingerprint,
      'evidence.deployment.config_fingerprint',
      issues,
    ),
  };

  const checksRoot = objectAt(root.checks, 'evidence.checks', issues);
  exactKeys(checksRoot, CHECK_NAMES, 'evidence.checks', issues);
  const checks = Object.fromEntries(CHECK_NAMES.map((name) => [
    name,
    evidenceCheck(checksRoot[name], `evidence.checks.${name}`, issues),
  ])) as unknown as CheckpointBEvidence['checks'];

  if (
    !Array.isArray(root.source_request_methods)
    || root.source_request_methods.length !== 1
    || root.source_request_methods[0] !== 'GET'
  ) {
    issues.push('evidence.source_request_methods must equal ["GET"]');
  }

  const p1DecisionId = safeString(root.p1_decision_id, 'evidence.p1_decision_id', issues);
  const p1Fingerprint = hash(
    root.p1_decision_fingerprint,
    'evidence.p1_decision_fingerprint',
    issues,
  );

  if (p1Input !== undefined) {
    const p1 = validateP1Decision(p1Input);
    if (!p1.ok || !p1.manifest) {
      issues.push(...p1.issues.map((issue) => `p1: ${issue}`));
    } else {
      if (p1.manifest.decision_id !== p1DecisionId) {
        issues.push('evidence.p1_decision_id does not match the validated P1 decision');
      }
      if (p1DecisionFingerprint(p1.manifest) !== p1Fingerprint) {
        issues.push('evidence.p1_decision_fingerprint does not match the validated P1 decision');
      }
      if (p1.manifest.runtime.test.project_id !== deployment.runtime_project_id) {
        issues.push('evidence deployment runtime does not match the P1 test runtime');
      }
      if (p1.manifest.database.test.database_id !== deployment.database_id) {
        issues.push('evidence deployment database does not match the P1 test database');
      }
      if (p1.manifest.egoric.test.project_id !== deployment.egoric_project_id) {
        issues.push('evidence Egoric project does not match the P1 test project');
      }
    }
  }

  const value: CheckpointBEvidence = {
    schema_version: CHECKPOINT_B_SCHEMA_VERSION,
    evidence_id: safeString(root.evidence_id, 'evidence.evidence_id', issues),
    environment: 'test',
    recorded_by: safeString(root.recorded_by, 'evidence.recorded_by', issues, /^[^\u0000-\u001f\u007f]{2,128}$/),
    started_at: startedAt,
    completed_at: completedAt,
    p1_decision_id: p1DecisionId,
    p1_decision_fingerprint: p1Fingerprint,
    deployment,
    checks,
    source_request_methods: ['GET'],
    source_request_bodies: zero(root.source_request_bodies, 'evidence.source_request_bodies', issues),
    source_mutation_count: zero(root.source_mutation_count, 'evidence.source_mutation_count', issues),
    secret_findings: zero(root.secret_findings, 'evidence.secret_findings', issues),
    pii_findings: zero(root.pii_findings, 'evidence.pii_findings', issues),
    rollback_required_source_restore: falseValue(
      root.rollback_required_source_restore,
      'evidence.rollback_required_source_restore',
      issues,
    ),
    verdict: 'pass',
  };
  return issues.length > 0 ? { ok: false, issues } : { ok: true, issues: [], value };
}

export function validateP2Decision(
  input: unknown,
  p1Input?: unknown,
  checkpointBInput?: unknown,
): Phase2Validation<P2DecisionManifest> {
  const issues: string[] = [];
  const root = objectAt(input, 'decision', issues);
  exactKeys(root, [
    'schema_version',
    'decision_id',
    'status',
    'approved_by',
    'approved_at',
    'p1_decision_id',
    'p1_decision_fingerprint',
    'checkpoint_b_evidence_id',
    'checkpoint_b_fingerprint',
    'production',
    'scope',
    'poll_schedule_minutes',
    'shadow_business_days',
    'verdict',
  ], 'decision', issues);
  if (root.schema_version !== P2_DECISION_SCHEMA_VERSION) {
    issues.push(`decision.schema_version must equal ${P2_DECISION_SCHEMA_VERSION}`);
  }
  if (root.status !== 'approved') issues.push('decision.status must equal approved');
  if (root.verdict !== 'approved') issues.push('decision.verdict must equal approved');
  if (root.scope !== 'company_ceo_brief_readonly') {
    issues.push('decision.scope must equal company_ceo_brief_readonly');
  }
  if (root.poll_schedule_minutes !== 15) {
    issues.push('decision.poll_schedule_minutes must equal 15');
  }
  if (root.shadow_business_days !== 10) {
    issues.push('decision.shadow_business_days must equal 10');
  }

  const productionRoot = objectAt(root.production, 'decision.production', issues);
  exactKeys(productionRoot, [
    'runtime_project_id',
    'database_id',
    'egoric_project_id',
    'source_tenant_key',
  ], 'decision.production', issues);
  const production = {
    runtime_project_id: safeString(
      productionRoot.runtime_project_id,
      'decision.production.runtime_project_id',
      issues,
    ),
    database_id: safeString(productionRoot.database_id, 'decision.production.database_id', issues),
    egoric_project_id: safeString(
      productionRoot.egoric_project_id,
      'decision.production.egoric_project_id',
      issues,
    ),
    source_tenant_key: safeString(
      productionRoot.source_tenant_key,
      'decision.production.source_tenant_key',
      issues,
    ),
  };

  const p1DecisionId = safeString(root.p1_decision_id, 'decision.p1_decision_id', issues);
  const p1Fingerprint = hash(
    root.p1_decision_fingerprint,
    'decision.p1_decision_fingerprint',
    issues,
  );
  const checkpointId = safeString(
    root.checkpoint_b_evidence_id,
    'decision.checkpoint_b_evidence_id',
    issues,
  );
  const checkpointFingerprint = hash(
    root.checkpoint_b_fingerprint,
    'decision.checkpoint_b_fingerprint',
    issues,
  );

  let p1Manifest: P1DecisionManifest | undefined;
  if (p1Input !== undefined) {
    const p1 = validateP1Decision(p1Input);
    if (!p1.ok || !p1.manifest) {
      issues.push(...p1.issues.map((issue) => `p1: ${issue}`));
    } else {
      p1Manifest = p1.manifest;
      if (p1.manifest.decision_id !== p1DecisionId) {
        issues.push('decision.p1_decision_id does not match the validated P1 decision');
      }
      if (p1DecisionFingerprint(p1.manifest) !== p1Fingerprint) {
        issues.push('decision.p1_decision_fingerprint does not match the validated P1 decision');
      }
      if (p1.manifest.runtime.production.project_id !== production.runtime_project_id) {
        issues.push('decision production runtime does not match P1');
      }
      if (p1.manifest.database.production.database_id !== production.database_id) {
        issues.push('decision production database does not match P1');
      }
      if (p1.manifest.egoric.production.project_id !== production.egoric_project_id) {
        issues.push('decision production Egoric project does not match P1');
      }
      if (p1.manifest.egoric.production.tenant_key !== production.source_tenant_key) {
        issues.push('decision production tenant does not match P1');
      }
    }
  }

  if (checkpointBInput !== undefined) {
    const checkpoint = validateCheckpointBEvidence(checkpointBInput, p1Input);
    if (!checkpoint.ok || !checkpoint.value) {
      issues.push(...checkpoint.issues.map((issue) => `checkpoint_b: ${issue}`));
    } else {
      if (checkpoint.value.evidence_id !== checkpointId) {
        issues.push('decision.checkpoint_b_evidence_id does not match Checkpoint B');
      }
      if (evidenceFingerprint(checkpoint.value) !== checkpointFingerprint) {
        issues.push('decision.checkpoint_b_fingerprint does not match Checkpoint B');
      }
      if (p1Manifest && checkpoint.value.p1_decision_id !== p1Manifest.decision_id) {
        issues.push('Checkpoint B and P2 do not share the same P1 decision');
      }
    }
  }

  const value: P2DecisionManifest = {
    schema_version: P2_DECISION_SCHEMA_VERSION,
    decision_id: safeString(root.decision_id, 'decision.decision_id', issues, /^P2-[A-Za-z0-9._-]{4,64}$/),
    status: 'approved',
    approved_by: safeString(root.approved_by, 'decision.approved_by', issues, /^[^\u0000-\u001f\u007f]{2,128}$/),
    approved_at: timestamp(root.approved_at, 'decision.approved_at', issues),
    p1_decision_id: p1DecisionId,
    p1_decision_fingerprint: p1Fingerprint,
    checkpoint_b_evidence_id: checkpointId,
    checkpoint_b_fingerprint: checkpointFingerprint,
    production,
    scope: 'company_ceo_brief_readonly',
    poll_schedule_minutes: 15,
    shadow_business_days: 10,
    verdict: 'approved',
  };
  return issues.length > 0 ? { ok: false, issues } : { ok: true, issues: [], value };
}

export function validatePhase2Authorization(input: {
  environment: 'test' | 'production';
  p1: unknown;
  checkpointB?: unknown;
  p2?: unknown;
}): Phase2Validation<{ environment: 'test' | 'production'; authorization_id: string }> {
  const p1 = validateP1Decision(input.p1);
  if (!p1.ok || !p1.manifest) return { ok: false, issues: p1.issues.map((issue) => `p1: ${issue}`) };
  if (input.environment === 'test') {
    return {
      ok: true,
      issues: [],
      value: { environment: 'test', authorization_id: p1.manifest.decision_id },
    };
  }
  if (input.checkpointB === undefined || input.p2 === undefined) {
    return { ok: false, issues: ['production requires Checkpoint B evidence and a P2 decision'] };
  }
  const p2 = validateP2Decision(input.p2, input.p1, input.checkpointB);
  if (!p2.ok || !p2.value) return { ok: false, issues: p2.issues };
  return {
    ok: true,
    issues: [],
    value: { environment: 'production', authorization_id: p2.value.decision_id },
  };
}
