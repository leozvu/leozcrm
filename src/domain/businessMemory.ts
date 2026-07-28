import { createHash } from 'node:crypto';

export const BUSINESS_MEMORY_TABLES = {
  tenants: 'tenants',
  sourceConnections: 'source_connections',
  sourceSnapshots: 'source_snapshots',
  intelligenceRuns: 'intelligence_runs',
} as const;

export interface Tenant {
  id: string;
  tenant_key: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export type SourceConnectionStatus = 'active' | 'disabled';

export interface SourceConnection {
  id: string;
  tenant_id: string;
  source_system: string;
  source_tenant_key: string;
  schema_version: string;
  endpoint_url: string;
  status: SourceConnectionStatus;
  last_etag: string | null;
  last_success_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceSnapshot {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  source_system: string;
  source_tenant_key: string;
  schema_version: string;
  snapshot_id: string;
  generated_at: string;
  received_at: string;
  payload_json: string;
  record_count: number;
  created_at: string;
}

export interface IntelligenceRun {
  id: string;
  tenant_id: string;
  source_snapshot_id: string;
  snapshot_id: string;
  engine_version: string;
  as_of: string;
  status: 'accepted';
  created_at: string;
}

export const EGORIC_SCHEMA_VERSION = '1.0' as const;
export const EGORIC_FUNNEL_ID = 'egoric_sales_v1' as const;
export const EGORIC_SNAPSHOT_PATH = '/api/integrations/leozops/v1/lead-snapshot' as const;
export const EGORIC_ACTIVE_STAGES = ['new', 'contacted', 'proposal', 'negotiation'] as const;
export const EGORIC_TERMINAL_OUTCOMES = ['won', 'lost'] as const;
export const EGORIC_STAGES = [...EGORIC_ACTIVE_STAGES, ...EGORIC_TERMINAL_OUTCOMES] as const;

export type EgoricLeadStage = (typeof EGORIC_STAGES)[number];

export interface EgoricSalesLead {
  external_id: string;
  stage: EgoricLeadStage;
  source: string | null;
  estimated_value: number | null;
  created_at: string | null;
  expected_close_at: string | null;
  owner_assigned: boolean;
}

export interface EgoricSalesV1Snapshot {
  schema_version: typeof EGORIC_SCHEMA_VERSION;
  source: {
    system: 'egoric';
    tenant_key: string;
  };
  snapshot_id: string;
  generated_at: string;
  funnel_definition: {
    id: typeof EGORIC_FUNNEL_ID;
    active_stages: [...typeof EGORIC_ACTIVE_STAGES];
    terminal_outcomes: [...typeof EGORIC_TERMINAL_OUTCOMES];
    historical_transitions_available: false;
  };
  leads: EgoricSalesLead[];
  quality: {
    records: number;
    missing_source: number;
    missing_created_at: number;
    client_attribution: 'unavailable';
  };
}

export class SnapshotContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SnapshotContractError';
  }
}

/** Validate and canonicalize the only endpoint the G2 adapter may persist/use. */
export function validateEgoricSnapshotEndpoint(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail('invalid_endpoint', 'source endpoint is not a valid URL');
  }
  const localHttp = url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) {
    fail('invalid_endpoint', 'source endpoint must use HTTPS');
  }
  if (
    url.username
    || url.password
    || url.hash
    || url.search
    || url.pathname !== EGORIC_SNAPSHOT_PATH
  ) {
    fail('invalid_endpoint', 'source endpoint must be the dedicated credential-free snapshot route');
  }
  return url.toString();
}

function fail(code: string, message: string): never {
  throw new SnapshotContractError(code, message);
}

function recordOf(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid_schema', `${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) {
    fail('invalid_schema', `${path} has unsupported or missing fields`);
  }
}

function nonEmptyString(value: unknown, path: string, max = 500): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    fail('invalid_schema', `${path} must be a non-empty string`);
  }
  return value;
}

function nullableString(value: unknown, path: string, max = 2_000): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) {
    fail('invalid_schema', `${path} must be a string or null`);
  }
  return value;
}

function nullableTimestamp(value: unknown, path: string): string | null {
  const timestamp = nullableString(value, path, 100);
  if (timestamp !== null && (timestamp.length === 0 || Number.isNaN(Date.parse(timestamp)))) {
    fail('invalid_schema', `${path} must be a valid date-time or null`);
  }
  return timestamp;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail('invalid_schema', `${path} must be a non-negative integer`);
  }
  return value;
}

function exactStringArray(
  value: unknown,
  expected: readonly string[],
  path: string,
): void {
  if (
    !Array.isArray(value)
    || value.length !== expected.length
    || value.some((item, i) => item !== expected[i])
  ) {
    fail('unsupported_funnel', `${path} does not match ${EGORIC_FUNNEL_ID}`);
  }
}

/** Deterministic JSON with object keys sorted at every depth. */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalStringify(row[key])}`,
  ).join(',')}}`;
}

export function computeEgoricSnapshotId(
  facts: Omit<EgoricSalesV1Snapshot, 'snapshot_id' | 'generated_at'>,
): string {
  const digest = createHash('sha256').update(canonicalStringify(facts)).digest('hex');
  return `sha256:${digest}`;
}

/**
 * Validate the complete `egoric_sales_v1` contract and its content hash.
 * Unknown versions/fields/stages fail closed. Error messages name only the
 * contract location and never include source values, so malformed PII cannot
 * leak through logs that capture the exception.
 */
export function validateEgoricSalesV1Snapshot(
  input: unknown,
  expectedTenantKey?: string,
): EgoricSalesV1Snapshot {
  const root = recordOf(input, 'snapshot');
  exactKeys(root, [
    'schema_version',
    'source',
    'snapshot_id',
    'generated_at',
    'funnel_definition',
    'leads',
    'quality',
  ], 'snapshot');

  if (root.schema_version !== EGORIC_SCHEMA_VERSION) {
    fail('unsupported_schema_version', 'unsupported snapshot schema_version');
  }

  const source = recordOf(root.source, 'snapshot.source');
  exactKeys(source, ['system', 'tenant_key'], 'snapshot.source');
  if (source.system !== 'egoric') fail('unsupported_source', 'unsupported source system');
  const sourceTenantKey = nonEmptyString(source.tenant_key, 'snapshot.source.tenant_key', 64);
  if (expectedTenantKey !== undefined && sourceTenantKey !== expectedTenantKey) {
    fail('source_tenant_mismatch', 'snapshot source tenant does not match the connection');
  }

  const snapshotId = nonEmptyString(root.snapshot_id, 'snapshot.snapshot_id', 80);
  if (!/^sha256:[0-9a-f]{64}$/.test(snapshotId)) {
    fail('invalid_snapshot_id', 'snapshot_id must be a lowercase sha256 identifier');
  }

  const generatedAt = nonEmptyString(root.generated_at, 'snapshot.generated_at', 100);
  if (Number.isNaN(Date.parse(generatedAt))) {
    fail('invalid_generated_at', 'generated_at must be a valid date-time');
  }

  const funnel = recordOf(root.funnel_definition, 'snapshot.funnel_definition');
  exactKeys(funnel, [
    'id',
    'active_stages',
    'terminal_outcomes',
    'historical_transitions_available',
  ], 'snapshot.funnel_definition');
  if (funnel.id !== EGORIC_FUNNEL_ID || funnel.historical_transitions_available !== false) {
    fail('unsupported_funnel', `funnel must be ${EGORIC_FUNNEL_ID} without history`);
  }
  exactStringArray(funnel.active_stages, EGORIC_ACTIVE_STAGES, 'active_stages');
  exactStringArray(funnel.terminal_outcomes, EGORIC_TERMINAL_OUTCOMES, 'terminal_outcomes');

  if (!Array.isArray(root.leads)) fail('invalid_schema', 'snapshot.leads must be an array');
  const seenIds = new Set<string>();
  const leads = root.leads.map((item, index): EgoricSalesLead => {
    const lead = recordOf(item, `snapshot.leads[${index}]`);
    exactKeys(lead, [
      'external_id',
      'stage',
      'source',
      'estimated_value',
      'created_at',
      'expected_close_at',
      'owner_assigned',
    ], `snapshot.leads[${index}]`);

    const externalId = nonEmptyString(lead.external_id, `snapshot.leads[${index}].external_id`, 500);
    if (seenIds.has(externalId)) fail('duplicate_external_id', 'snapshot contains duplicate lead ids');
    seenIds.add(externalId);
    if (typeof lead.stage !== 'string' || !(EGORIC_STAGES as readonly string[]).includes(lead.stage)) {
      fail('unsupported_stage', 'snapshot contains an unsupported lead stage');
    }
    if (
      lead.estimated_value !== null
      && (
        typeof lead.estimated_value !== 'number'
        || !Number.isFinite(lead.estimated_value)
        || lead.estimated_value < 0
      )
    ) {
      fail('invalid_schema', `snapshot.leads[${index}].estimated_value must be non-negative or null`);
    }
    if (typeof lead.owner_assigned !== 'boolean') {
      fail('invalid_schema', `snapshot.leads[${index}].owner_assigned must be boolean`);
    }

    return {
      external_id: externalId,
      stage: lead.stage as EgoricLeadStage,
      source: nullableString(lead.source, `snapshot.leads[${index}].source`),
      estimated_value: lead.estimated_value as number | null,
      created_at: nullableTimestamp(lead.created_at, `snapshot.leads[${index}].created_at`),
      expected_close_at: nullableTimestamp(
        lead.expected_close_at,
        `snapshot.leads[${index}].expected_close_at`,
      ),
      owner_assigned: lead.owner_assigned,
    };
  });

  const quality = recordOf(root.quality, 'snapshot.quality');
  exactKeys(quality, [
    'records',
    'missing_source',
    'missing_created_at',
    'client_attribution',
  ], 'snapshot.quality');
  const records = nonNegativeInteger(quality.records, 'snapshot.quality.records');
  const missingSource = nonNegativeInteger(quality.missing_source, 'snapshot.quality.missing_source');
  const missingCreatedAt = nonNegativeInteger(
    quality.missing_created_at,
    'snapshot.quality.missing_created_at',
  );
  if (quality.client_attribution !== 'unavailable') {
    fail('unsupported_attribution', 'client attribution must remain unavailable');
  }
  if (
    records !== leads.length
    || missingSource !== leads.filter((lead) => !lead.source).length
    || missingCreatedAt !== leads.filter((lead) => !lead.created_at).length
  ) {
    fail('quality_mismatch', 'snapshot quality counts do not reconcile');
  }

  const validated: EgoricSalesV1Snapshot = {
    schema_version: EGORIC_SCHEMA_VERSION,
    source: { system: 'egoric', tenant_key: sourceTenantKey },
    snapshot_id: snapshotId,
    generated_at: generatedAt,
    funnel_definition: {
      id: EGORIC_FUNNEL_ID,
      active_stages: [...EGORIC_ACTIVE_STAGES],
      terminal_outcomes: [...EGORIC_TERMINAL_OUTCOMES],
      historical_transitions_available: false,
    },
    leads,
    quality: {
      records,
      missing_source: missingSource,
      missing_created_at: missingCreatedAt,
      client_attribution: 'unavailable',
    },
  };

  const expectedId = computeEgoricSnapshotId({
    schema_version: validated.schema_version,
    source: validated.source,
    funnel_definition: validated.funnel_definition,
    leads: validated.leads,
    quality: validated.quality,
  });
  if (expectedId !== validated.snapshot_id) {
    fail('snapshot_hash_mismatch', 'snapshot_id does not match canonical source facts');
  }

  return validated;
}
