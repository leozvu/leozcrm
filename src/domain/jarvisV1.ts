import { createHash } from 'node:crypto';
import { canonicalStringify } from './businessMemory';

export const JARVIS_EVALUATION_SCHEMA = 'leozops_jarvis_evaluation_v1' as const;
export const JARVIS_EXPORT_SCHEMA = 'leozops_jarvis_sanitized_export_v1' as const;
export const JARVIS_DATA_REQUEST_SCHEMA = 'leozops_jarvis_data_request_v1' as const;
export const JARVIS_RETENTION_POLICY_VERSION = 'jarvis_retention_policy_candidate_v1' as const;
export const JARVIS_V1_TABLES = { dataRequests: 'jarvis_data_governance_requests' } as const;

export const JARVIS_RETENTION_POLICY = Object.freeze({
  version: JARVIS_RETENTION_POLICY_VERSION,
  source_snapshot_days: 90,
  audit_evidence_days: 365,
  automatic_deletion_enabled: false,
  raw_source_payload_exported: false,
  command_payload_exported: false,
  deletion_boundary: 'blocked_until_accepted_policy_and_operator_review' as const,
});

export type JarvisDataRequestKind = 'export' | 'delete';
export type JarvisDataRequestStatus = 'ready_for_export' | 'blocked_pending_retention_policy';

export interface JarvisDataRequestRecord {
  id: string;
  tenant_id: string;
  schema_version: typeof JARVIS_DATA_REQUEST_SCHEMA;
  kind: JarvisDataRequestKind;
  scope: 'tenant_leozops_data';
  idempotency_key: string;
  request_hash: string;
  confirmation_hash: string;
  status: JarvisDataRequestStatus;
  requested_by: 'founder';
  requested_at: string;
  request_fingerprint: string;
  created_at: string;
}

export class JarvisV1Error extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 404 | 409 | 500 = 400,
  ) {
    super(message);
    this.name = 'JarvisV1Error';
  }
}

export function jarvisV1Hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

export function validateJarvisDataRequest(raw: unknown, tenantKey: string): {
  kind: JarvisDataRequestKind;
  scope: 'tenant_leozops_data';
  confirmationHash: string;
} {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new JarvisV1Error('invalid_data_request', 'data request must be an object');
  }
  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  if (keys.length !== 3 || keys[0] !== 'confirmation' || keys[1] !== 'kind' || keys[2] !== 'scope') {
    throw new JarvisV1Error('invalid_data_request', 'data request has missing or unsupported fields');
  }
  if (input.kind !== 'export' && input.kind !== 'delete') {
    throw new JarvisV1Error('invalid_data_request', 'data request kind is unsupported');
  }
  if (input.scope !== 'tenant_leozops_data') {
    throw new JarvisV1Error('invalid_data_request', 'data request scope is unsupported');
  }
  const expected = `${String(input.kind).toUpperCase()} ${tenantKey}`;
  if (input.confirmation !== expected) {
    throw new JarvisV1Error('invalid_data_request_confirmation', `confirmation must equal ${String(input.kind).toUpperCase()} <tenant-key>`);
  }
  return {
    kind: input.kind,
    scope: 'tenant_leozops_data',
    confirmationHash: jarvisV1Hash({ confirmation: expected }),
  };
}
