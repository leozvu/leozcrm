import {
  SOURCE_POLL_CADENCE_MS,
  SourcePollPolicy,
  validateSourcePollPolicy,
} from './pollReliability';

export const P1_DECISION_SCHEMA_VERSION = 'leozops_p1_decision_v1' as const;

type EnvironmentDecision = {
  project_id: string;
  plan: string;
  region: string;
  owner: string;
};

type DatabaseEnvironmentDecision = EnvironmentDecision & {
  database_id: string;
  connection_secret_ref: string;
  backup_enabled: boolean;
  backup_retention_days: number;
};

type EgoricEnvironmentDecision = {
  project_id: string;
  base_url: string;
  tenant_key: string;
  owner: string;
  source_flag: string;
  source_key_secret_ref: string;
};

export interface P1DecisionManifest {
  schema_version: typeof P1_DECISION_SCHEMA_VERSION;
  decision_id: string;
  status: 'approved';
  approved_by: string;
  approved_at: string;
  runtime: {
    provider: string;
    test: EnvironmentDecision;
    production: EnvironmentDecision;
  };
  database: {
    provider: string;
    test: DatabaseEnvironmentDecision;
    production: DatabaseEnvironmentDecision;
  };
  egoric: {
    test: EgoricEnvironmentDecision;
    production: EgoricEnvironmentDecision;
  };
  operations: {
    business_timezone: string;
    business_days: string[];
    business_start_local: string;
    business_end_local: string;
    director_reviewer: string;
    brief_access_method: 'authenticated_read_api' | 'authenticated_dashboard';
    brief_access_test_secret_ref: string;
    brief_access_production_secret_ref: string;
    alert_channel: 'platform_native' | 'email' | 'webhook';
    alert_test_destination_ref: string;
    alert_production_destination_ref: string;
    on_call_owner: string;
  };
  poll_policy: SourcePollPolicy & {
    staleAfterMs: number;
  };
  retention: {
    source_snapshot_days: number;
    reconciliation_days: number;
    access_roles: string[];
  };
  budget: {
    currency: 'USD';
    monthly_limit: number;
    owner: string;
  };
}

export interface P1DecisionValidation {
  ok: boolean;
  issues: string[];
  manifest?: P1DecisionManifest;
}

const WEEKDAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
const PLACEHOLDER = /(?:^|[-_:/])(?:tbd|todo|pending|unknown|null|n\/a|replace(?:_me)?)(?:$|[-_:/])|<.*>/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,127}$/;
const SECRET_REF = /^secret:\/\/[A-Za-z0-9][A-Za-z0-9._/-]{2,191}$/;
const RESOURCE_REF = /^(?:destination|platform|secret):\/\/[A-Za-z0-9][A-Za-z0-9._/-]{2,191}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) issues.push(`${path}.${key} is not allowed`);
  }
  for (const key of allowed) {
    if (!(key in value)) issues.push(`${path}.${key} is required`);
  }
}

function stringAt(
  value: unknown,
  path: string,
  issues: string[],
  pattern?: RegExp,
): string {
  if (
    typeof value !== 'string'
    || value.length < 2
    || value.length > 256
    || value.trim() !== value
    || PLACEHOLDER.test(value)
    || /[\u0000-\u001f\u007f]/.test(value)
    || (pattern && !pattern.test(value))
  ) {
    issues.push(`${path} must be a concrete safe value`);
    return '';
  }
  return value;
}

function integerAt(value: unknown, path: string, issues: string[], min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    issues.push(`${path} must be an integer from ${min} to ${max}`);
    return min;
  }
  return value;
}

function booleanAt(value: unknown, path: string, issues: string[]): boolean {
  if (typeof value !== 'boolean') {
    issues.push(`${path} must be a boolean`);
    return false;
  }
  return value;
}

function secretRefAt(value: unknown, path: string, issues: string[]): string {
  return stringAt(value, path, issues, SECRET_REF);
}

function httpsUrlAt(value: unknown, path: string, issues: string[]): string {
  const raw = stringAt(value, path, issues);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.hash
      || parsed.search
      || ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
    ) {
      throw new Error('unsafe URL');
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    issues.push(`${path} must be a credential-free external HTTPS URL`);
    return '';
  }
}

function environmentAt(value: unknown, path: string, issues: string[]): EnvironmentDecision {
  const item = objectAt(value, path, issues);
  exactKeys(item, ['project_id', 'plan', 'region', 'owner'], path, issues);
  return {
    project_id: stringAt(item.project_id, `${path}.project_id`, issues, SAFE_ID),
    plan: stringAt(item.plan, `${path}.plan`, issues, SAFE_ID),
    region: stringAt(item.region, `${path}.region`, issues, SAFE_ID),
    owner: stringAt(item.owner, `${path}.owner`, issues),
  };
}

function databaseEnvironmentAt(
  value: unknown,
  path: string,
  issues: string[],
): DatabaseEnvironmentDecision {
  const item = objectAt(value, path, issues);
  exactKeys(item, [
    'project_id',
    'database_id',
    'plan',
    'region',
    'owner',
    'connection_secret_ref',
    'backup_enabled',
    'backup_retention_days',
  ], path, issues);
  return {
    project_id: stringAt(item.project_id, `${path}.project_id`, issues, SAFE_ID),
    database_id: stringAt(item.database_id, `${path}.database_id`, issues, SAFE_ID),
    plan: stringAt(item.plan, `${path}.plan`, issues, SAFE_ID),
    region: stringAt(item.region, `${path}.region`, issues, SAFE_ID),
    owner: stringAt(item.owner, `${path}.owner`, issues),
    connection_secret_ref: secretRefAt(item.connection_secret_ref, `${path}.connection_secret_ref`, issues),
    backup_enabled: booleanAt(item.backup_enabled, `${path}.backup_enabled`, issues),
    backup_retention_days: integerAt(item.backup_retention_days, `${path}.backup_retention_days`, issues, 1, 365),
  };
}

function egoricEnvironmentAt(
  value: unknown,
  path: string,
  issues: string[],
): EgoricEnvironmentDecision {
  const item = objectAt(value, path, issues);
  exactKeys(item, [
    'project_id',
    'base_url',
    'tenant_key',
    'owner',
    'source_flag',
    'source_key_secret_ref',
  ], path, issues);
  return {
    project_id: stringAt(item.project_id, `${path}.project_id`, issues, SAFE_ID),
    base_url: httpsUrlAt(item.base_url, `${path}.base_url`, issues),
    tenant_key: stringAt(item.tenant_key, `${path}.tenant_key`, issues, SAFE_ID),
    owner: stringAt(item.owner, `${path}.owner`, issues),
    source_flag: stringAt(item.source_flag, `${path}.source_flag`, issues, SAFE_ID),
    source_key_secret_ref: secretRefAt(item.source_key_secret_ref, `${path}.source_key_secret_ref`, issues),
  };
}

function distinct(left: string, right: string, path: string, issues: string[]): void {
  if (left && right && left === right) issues.push(`${path} must use distinct test and production values`);
}

export function validateP1Decision(value: unknown): P1DecisionValidation {
  const issues: string[] = [];
  const root = objectAt(value, 'manifest', issues);
  exactKeys(root, [
    'schema_version',
    'decision_id',
    'status',
    'approved_by',
    'approved_at',
    'runtime',
    'database',
    'egoric',
    'operations',
    'poll_policy',
    'retention',
    'budget',
  ], 'manifest', issues);

  if (root.schema_version !== P1_DECISION_SCHEMA_VERSION) {
    issues.push(`manifest.schema_version must equal ${P1_DECISION_SCHEMA_VERSION}`);
  }
  const decisionId = stringAt(root.decision_id, 'manifest.decision_id', issues, /^P1-[A-Za-z0-9._-]{4,64}$/);
  if (root.status !== 'approved') issues.push('manifest.status must equal approved');
  const approvedBy = stringAt(root.approved_by, 'manifest.approved_by', issues);
  const approvedAt = stringAt(root.approved_at, 'manifest.approved_at', issues);
  if (
    approvedAt
    && (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(approvedAt)
      || Number.isNaN(Date.parse(approvedAt))
    )
  ) {
    issues.push('manifest.approved_at must be an ISO-8601 timestamp with an explicit timezone');
  }

  const runtimeRoot = objectAt(root.runtime, 'manifest.runtime', issues);
  exactKeys(runtimeRoot, ['provider', 'test', 'production'], 'manifest.runtime', issues);
  const runtime = {
    provider: stringAt(runtimeRoot.provider, 'manifest.runtime.provider', issues, SAFE_ID),
    test: environmentAt(runtimeRoot.test, 'manifest.runtime.test', issues),
    production: environmentAt(runtimeRoot.production, 'manifest.runtime.production', issues),
  };

  const databaseRoot = objectAt(root.database, 'manifest.database', issues);
  exactKeys(databaseRoot, ['provider', 'test', 'production'], 'manifest.database', issues);
  const database = {
    provider: stringAt(databaseRoot.provider, 'manifest.database.provider', issues, SAFE_ID),
    test: databaseEnvironmentAt(databaseRoot.test, 'manifest.database.test', issues),
    production: databaseEnvironmentAt(databaseRoot.production, 'manifest.database.production', issues),
  };

  const egoricRoot = objectAt(root.egoric, 'manifest.egoric', issues);
  exactKeys(egoricRoot, ['test', 'production'], 'manifest.egoric', issues);
  const egoric = {
    test: egoricEnvironmentAt(egoricRoot.test, 'manifest.egoric.test', issues),
    production: egoricEnvironmentAt(egoricRoot.production, 'manifest.egoric.production', issues),
  };

  const operationsRoot = objectAt(root.operations, 'manifest.operations', issues);
  exactKeys(operationsRoot, [
    'business_timezone',
    'business_days',
    'business_start_local',
    'business_end_local',
    'director_reviewer',
    'brief_access_method',
    'brief_access_test_secret_ref',
    'brief_access_production_secret_ref',
    'alert_channel',
    'alert_test_destination_ref',
    'alert_production_destination_ref',
    'on_call_owner',
  ], 'manifest.operations', issues);
  const timezone = stringAt(operationsRoot.business_timezone, 'manifest.operations.business_timezone', issues);
  if (timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
    } catch {
      issues.push('manifest.operations.business_timezone must be an IANA timezone');
    }
  }
  const rawDays = operationsRoot.business_days;
  const businessDays: string[] = [];
  if (!Array.isArray(rawDays) || rawDays.length === 0) {
    issues.push('manifest.operations.business_days must contain at least one weekday');
  } else {
    for (const day of rawDays) {
      if (typeof day !== 'string' || !WEEKDAYS.has(day)) {
        issues.push('manifest.operations.business_days contains an invalid weekday');
      } else if (businessDays.includes(day)) {
        issues.push('manifest.operations.business_days must not contain duplicates');
      } else {
        businessDays.push(day);
      }
    }
  }
  const businessStart = stringAt(
    operationsRoot.business_start_local,
    'manifest.operations.business_start_local',
    issues,
    TIME,
  );
  const businessEnd = stringAt(
    operationsRoot.business_end_local,
    'manifest.operations.business_end_local',
    issues,
    TIME,
  );
  if (businessStart && businessStart === businessEnd) {
    issues.push('manifest.operations business window cannot be zero-length');
  }
  const accessMethod = operationsRoot.brief_access_method;
  if (!['authenticated_read_api', 'authenticated_dashboard'].includes(String(accessMethod))) {
    issues.push('manifest.operations.brief_access_method is unsupported');
  }
  const alertChannel = operationsRoot.alert_channel;
  if (!['platform_native', 'email', 'webhook'].includes(String(alertChannel))) {
    issues.push('manifest.operations.alert_channel is unsupported');
  }
  const operations = {
    business_timezone: timezone,
    business_days: businessDays,
    business_start_local: businessStart,
    business_end_local: businessEnd,
    director_reviewer: stringAt(operationsRoot.director_reviewer, 'manifest.operations.director_reviewer', issues),
    brief_access_method: accessMethod as P1DecisionManifest['operations']['brief_access_method'],
    brief_access_test_secret_ref: secretRefAt(
      operationsRoot.brief_access_test_secret_ref,
      'manifest.operations.brief_access_test_secret_ref',
      issues,
    ),
    brief_access_production_secret_ref: secretRefAt(
      operationsRoot.brief_access_production_secret_ref,
      'manifest.operations.brief_access_production_secret_ref',
      issues,
    ),
    alert_channel: alertChannel as P1DecisionManifest['operations']['alert_channel'],
    alert_test_destination_ref: stringAt(
      operationsRoot.alert_test_destination_ref,
      'manifest.operations.alert_test_destination_ref',
      issues,
      RESOURCE_REF,
    ),
    alert_production_destination_ref: stringAt(
      operationsRoot.alert_production_destination_ref,
      'manifest.operations.alert_production_destination_ref',
      issues,
      RESOURCE_REF,
    ),
    on_call_owner: stringAt(operationsRoot.on_call_owner, 'manifest.operations.on_call_owner', issues),
  };

  const pollRoot = objectAt(root.poll_policy, 'manifest.poll_policy', issues);
  exactKeys(pollRoot, [
    'cadenceMs',
    'requestTimeoutMs',
    'maxRetries',
    'baseDelayMs',
    'maxDelayMs',
    'jitterRatio',
    'circuitFailureThreshold',
    'circuitOpenMs',
    'leaseMs',
    'staleAfterMs',
  ], 'manifest.poll_policy', issues);
  const pollPolicy = {
    cadenceMs: pollRoot.cadenceMs as typeof SOURCE_POLL_CADENCE_MS,
    requestTimeoutMs: pollRoot.requestTimeoutMs as number,
    maxRetries: pollRoot.maxRetries as number,
    baseDelayMs: pollRoot.baseDelayMs as number,
    maxDelayMs: pollRoot.maxDelayMs as number,
    jitterRatio: pollRoot.jitterRatio as number,
    circuitFailureThreshold: pollRoot.circuitFailureThreshold as number,
    circuitOpenMs: pollRoot.circuitOpenMs as number,
    leaseMs: pollRoot.leaseMs as number,
  };
  try {
    validateSourcePollPolicy(pollPolicy);
  } catch (error) {
    issues.push(`manifest.poll_policy is invalid: ${(error as Error).message}`);
  }
  const staleAfterMs = integerAt(
    pollRoot.staleAfterMs,
    'manifest.poll_policy.staleAfterMs',
    issues,
    SOURCE_POLL_CADENCE_MS,
    24 * 60 * 60 * 1_000,
  );
  if (staleAfterMs < SOURCE_POLL_CADENCE_MS * 2) {
    issues.push('manifest.poll_policy.staleAfterMs must allow at least two polling intervals');
  }

  const retentionRoot = objectAt(root.retention, 'manifest.retention', issues);
  exactKeys(
    retentionRoot,
    ['source_snapshot_days', 'reconciliation_days', 'access_roles'],
    'manifest.retention',
    issues,
  );
  const rawRoles = retentionRoot.access_roles;
  const accessRoles: string[] = [];
  if (!Array.isArray(rawRoles) || rawRoles.length === 0) {
    issues.push('manifest.retention.access_roles must contain at least one role');
  } else {
    for (const role of rawRoles) {
      const parsed = stringAt(role, 'manifest.retention.access_roles[]', issues, SAFE_ID);
      if (parsed && ['all', 'any', 'public', '*'].includes(parsed.toLowerCase())) {
        issues.push('manifest.retention.access_roles cannot grant broad/public access');
      } else if (parsed && accessRoles.includes(parsed)) {
        issues.push('manifest.retention.access_roles must not contain duplicates');
      } else if (parsed) {
        accessRoles.push(parsed);
      }
    }
  }
  const retention = {
    source_snapshot_days: integerAt(
      retentionRoot.source_snapshot_days,
      'manifest.retention.source_snapshot_days',
      issues,
      1,
      3650,
    ),
    reconciliation_days: integerAt(
      retentionRoot.reconciliation_days,
      'manifest.retention.reconciliation_days',
      issues,
      1,
      3650,
    ),
    access_roles: accessRoles,
  };
  if (retention.reconciliation_days < retention.source_snapshot_days) {
    issues.push('manifest.retention.reconciliation_days cannot be shorter than source_snapshot_days');
  }

  const budgetRoot = objectAt(root.budget, 'manifest.budget', issues);
  exactKeys(budgetRoot, ['currency', 'monthly_limit', 'owner'], 'manifest.budget', issues);
  if (budgetRoot.currency !== 'USD') issues.push('manifest.budget.currency must equal USD');
  const budget = {
    currency: 'USD' as const,
    monthly_limit: integerAt(budgetRoot.monthly_limit, 'manifest.budget.monthly_limit', issues, 0, 100_000),
    owner: stringAt(budgetRoot.owner, 'manifest.budget.owner', issues),
  };

  distinct(runtime.test.project_id, runtime.production.project_id, 'manifest.runtime.project_id', issues);
  distinct(database.test.project_id, database.production.project_id, 'manifest.database.project_id', issues);
  distinct(database.test.database_id, database.production.database_id, 'manifest.database.database_id', issues);
  distinct(
    database.test.connection_secret_ref,
    database.production.connection_secret_ref,
    'manifest.database.connection_secret_ref',
    issues,
  );
  distinct(egoric.test.project_id, egoric.production.project_id, 'manifest.egoric.project_id', issues);
  distinct(egoric.test.base_url, egoric.production.base_url, 'manifest.egoric.base_url', issues);
  distinct(
    egoric.test.source_key_secret_ref,
    egoric.production.source_key_secret_ref,
    'manifest.egoric.source_key_secret_ref',
    issues,
  );
  distinct(
    operations.brief_access_test_secret_ref,
    operations.brief_access_production_secret_ref,
    'manifest.operations.brief_access_secret_ref',
    issues,
  );
  distinct(
    operations.alert_test_destination_ref,
    operations.alert_production_destination_ref,
    'manifest.operations.alert_destination_ref',
    issues,
  );

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    issues: [],
    manifest: {
      schema_version: P1_DECISION_SCHEMA_VERSION,
      decision_id: decisionId,
      status: 'approved',
      approved_by: approvedBy,
      approved_at: approvedAt,
      runtime,
      database,
      egoric,
      operations,
      poll_policy: { ...pollPolicy, staleAfterMs },
      retention,
      budget,
    },
  };
}

export function p1DecisionSummary(manifest: P1DecisionManifest): Record<string, unknown> {
  return {
    verdict: 'P1_DECISION_APPROVED',
    decision_id: manifest.decision_id,
    approved_by: manifest.approved_by,
    approved_at: manifest.approved_at,
    runtime: {
      provider: manifest.runtime.provider,
      test_region: manifest.runtime.test.region,
      production_region: manifest.runtime.production.region,
    },
    database: {
      provider: manifest.database.provider,
      test_region: manifest.database.test.region,
      production_region: manifest.database.production.region,
    },
    business_timezone: manifest.operations.business_timezone,
    business_window: `${manifest.operations.business_start_local}-${manifest.operations.business_end_local}`,
    poll_cadence_ms: manifest.poll_policy.cadenceMs,
    stale_after_ms: manifest.poll_policy.staleAfterMs,
    source_snapshot_retention_days: manifest.retention.source_snapshot_days,
    reconciliation_retention_days: manifest.retention.reconciliation_days,
    monthly_budget_limit_usd: manifest.budget.monthly_limit,
  };
}
