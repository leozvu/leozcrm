import { createHash } from 'node:crypto';
import { canonicalStringify } from './businessMemory';

export const LIVE_OBSERVER_SCHEMA = 'leozops_phase12_live_observer_v1' as const;

export interface LiveObserverDeployment {
  schema_version: typeof LIVE_OBSERVER_SCHEMA;
  status: 'accepted';
  environment: 'staging' | 'production';
  runtime_profile: 'egoric-readonly';
  target: {
    provider: string;
    project_id: string;
    service_id: string;
    region: string;
    database_id: string;
  };
  source: {
    tenant_id: string;
    tenant_key: string;
    connection_id: string;
    egoric_project_id: string;
    endpoint_url: string;
    method: 'GET';
    request_body_present: false;
  };
  owners: {
    product_owner: string;
    runtime_owner: string;
    incident_owner: string;
  };
  secret_bindings: {
    database_url: string;
    output_auth_secret: string;
    source_bearer_token: string;
    source_operator_token: string;
    proactive_operator_token: string;
    observer_operator_token: string;
  };
  schedule: {
    poll_interval_seconds: number;
    max_freshness_seconds: number;
    observer_timeout_seconds: number;
  };
  monitoring: {
    dashboard_id: string;
    alert_route_id: string;
    observability_credential_sha256: string;
  };
  safety: {
    source_read_only: true;
    action_authority: 'none';
    background_loops_in_http_process: false;
    waivers_allowed: false;
  };
}

export interface LiveObserverValidation {
  ok: boolean;
  issues: string[];
  value?: LiveObserverDeployment;
  fingerprint?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,191}$/;
const ENV_REF = /^env:\/\/[A-Z][A-Z0-9_]{2,127}$/;

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string, issues: string[]): void {
  const allowed = new Set(expected);
  for (const key of Object.keys(value)) if (!allowed.has(key)) issues.push(`${path}.${key} is not allowed`);
  for (const key of expected) if (!(key in value)) issues.push(`${path}.${key} is required`);
}

function safeText(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    issues.push(`${path} must be a non-secret stable identifier`);
    return '';
  }
  return value;
}

function uuid(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    issues.push(`${path} must be a UUID`);
    return '';
  }
  return value;
}

function integer(value: unknown, path: string, min: number, max: number, issues: string[]): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    issues.push(`${path} must be an integer between ${min} and ${max}`);
    return 0;
  }
  return Number(value);
}

function envRef(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== 'string' || !ENV_REF.test(value)) {
    issues.push(`${path} must be an env:// reference; raw secrets are forbidden`);
    return '';
  }
  return value;
}

function sha256(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    issues.push(`${path} must be a lowercase SHA-256 fingerprint`);
    return '';
  }
  return value;
}

export function liveObserverFingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

export function secretEnvironmentName(reference: string): string {
  return reference.startsWith('env://') ? reference.slice('env://'.length) : '';
}

export function validateLiveObserverDeployment(raw: unknown): LiveObserverValidation {
  const issues: string[] = [];
  const root = object(raw);
  if (!root) return { ok: false, issues: ['deployment must be a JSON object'] };
  exactKeys(root, [
    'schema_version', 'status', 'environment', 'runtime_profile', 'target', 'source',
    'owners', 'secret_bindings', 'schedule', 'monitoring', 'safety',
  ], 'deployment', issues);
  if (root.schema_version !== LIVE_OBSERVER_SCHEMA) issues.push(`schema_version must equal ${LIVE_OBSERVER_SCHEMA}`);
  if (root.status !== 'accepted') issues.push('status must equal accepted');
  if (root.environment !== 'staging' && root.environment !== 'production') {
    issues.push('environment must equal staging or production');
  }
  if (root.runtime_profile !== 'egoric-readonly') issues.push('runtime_profile must equal egoric-readonly');

  const target = object(root.target) ?? {};
  exactKeys(target, ['provider', 'project_id', 'service_id', 'region', 'database_id'], 'target', issues);
  const parsedTarget = {
    provider: safeText(target.provider, 'target.provider', issues),
    project_id: safeText(target.project_id, 'target.project_id', issues),
    service_id: safeText(target.service_id, 'target.service_id', issues),
    region: safeText(target.region, 'target.region', issues),
    database_id: safeText(target.database_id, 'target.database_id', issues),
  };

  const source = object(root.source) ?? {};
  exactKeys(source, [
    'tenant_id', 'tenant_key', 'connection_id', 'egoric_project_id', 'endpoint_url',
    'method', 'request_body_present',
  ], 'source', issues);
  let endpoint = '';
  if (typeof source.endpoint_url !== 'string') issues.push('source.endpoint_url must be an HTTPS URL');
  else {
    try {
      const parsed = new URL(source.endpoint_url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
        issues.push('source.endpoint_url must be credential-free HTTPS without query or fragment');
      } else endpoint = parsed.toString();
    } catch {
      issues.push('source.endpoint_url must be an HTTPS URL');
    }
  }
  if (source.method !== 'GET') issues.push('source.method must equal GET');
  if (source.request_body_present !== false) issues.push('source.request_body_present must equal false');
  const parsedSource = {
    tenant_id: uuid(source.tenant_id, 'source.tenant_id', issues),
    tenant_key: safeText(source.tenant_key, 'source.tenant_key', issues),
    connection_id: uuid(source.connection_id, 'source.connection_id', issues),
    egoric_project_id: safeText(source.egoric_project_id, 'source.egoric_project_id', issues),
    endpoint_url: endpoint,
    method: 'GET' as const,
    request_body_present: false as const,
  };

  const owners = object(root.owners) ?? {};
  exactKeys(owners, ['product_owner', 'runtime_owner', 'incident_owner'], 'owners', issues);
  const parsedOwners = {
    product_owner: safeText(owners.product_owner, 'owners.product_owner', issues),
    runtime_owner: safeText(owners.runtime_owner, 'owners.runtime_owner', issues),
    incident_owner: safeText(owners.incident_owner, 'owners.incident_owner', issues),
  };

  const bindings = object(root.secret_bindings) ?? {};
  const bindingKeys = [
    'database_url', 'output_auth_secret', 'source_bearer_token', 'source_operator_token',
    'proactive_operator_token', 'observer_operator_token',
  ] as const;
  exactKeys(bindings, bindingKeys, 'secret_bindings', issues);
  const parsedBindings = Object.fromEntries(bindingKeys.map((key) => [
    key, envRef(bindings[key], `secret_bindings.${key}`, issues),
  ])) as LiveObserverDeployment['secret_bindings'];
  if (new Set(Object.values(parsedBindings)).size !== bindingKeys.length) {
    issues.push('every secret binding must use a distinct environment variable');
  }

  const schedule = object(root.schedule) ?? {};
  exactKeys(schedule, ['poll_interval_seconds', 'max_freshness_seconds', 'observer_timeout_seconds'], 'schedule', issues);
  const parsedSchedule = {
    poll_interval_seconds: integer(schedule.poll_interval_seconds, 'schedule.poll_interval_seconds', 60, 3600, issues),
    max_freshness_seconds: integer(schedule.max_freshness_seconds, 'schedule.max_freshness_seconds', 120, 86400, issues),
    observer_timeout_seconds: integer(schedule.observer_timeout_seconds, 'schedule.observer_timeout_seconds', 30, 1800, issues),
  };
  if (parsedSchedule.max_freshness_seconds < parsedSchedule.poll_interval_seconds * 2) {
    issues.push('schedule.max_freshness_seconds must be at least two poll intervals');
  }

  const monitoring = object(root.monitoring) ?? {};
  exactKeys(monitoring, ['dashboard_id', 'alert_route_id', 'observability_credential_sha256'], 'monitoring', issues);
  const parsedMonitoring = {
    dashboard_id: safeText(monitoring.dashboard_id, 'monitoring.dashboard_id', issues),
    alert_route_id: safeText(monitoring.alert_route_id, 'monitoring.alert_route_id', issues),
    observability_credential_sha256: sha256(
      monitoring.observability_credential_sha256,
      'monitoring.observability_credential_sha256',
      issues,
    ),
  };

  const safety = object(root.safety) ?? {};
  exactKeys(safety, [
    'source_read_only', 'action_authority', 'background_loops_in_http_process', 'waivers_allowed',
  ], 'safety', issues);
  if (safety.source_read_only !== true) issues.push('safety.source_read_only must equal true');
  if (safety.action_authority !== 'none') issues.push('safety.action_authority must equal none');
  if (safety.background_loops_in_http_process !== false) issues.push('safety.background_loops_in_http_process must equal false');
  if (safety.waivers_allowed !== false) issues.push('safety.waivers_allowed must equal false');

  if (issues.length) return { ok: false, issues };
  const value: LiveObserverDeployment = {
    schema_version: LIVE_OBSERVER_SCHEMA,
    status: 'accepted',
    environment: root.environment as LiveObserverDeployment['environment'],
    runtime_profile: 'egoric-readonly',
    target: parsedTarget,
    source: parsedSource,
    owners: parsedOwners,
    secret_bindings: parsedBindings,
    schedule: parsedSchedule,
    monitoring: parsedMonitoring,
    safety: {
      source_read_only: true,
      action_authority: 'none',
      background_loops_in_http_process: false,
      waivers_allowed: false,
    },
  };
  return { ok: true, issues: [], value, fingerprint: liveObserverFingerprint(value) };
}
