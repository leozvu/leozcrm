import { createHash, timingSafeEqual } from 'node:crypto';
import type { PollCircuitState } from './pollReliability';

export const SOURCE_RECONCILIATION_TABLE = 'source_reconciliations' as const;

export type SourceReconciliationStatus = 'passed' | 'failed';

export interface SourceReconciliation {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  business_date: string;
  business_timezone: string;
  checked_at: string;
  status: SourceReconciliationStatus;
  evidence_key: string;
  source_snapshot_row_id: string | null;
  snapshot_id: string | null;
  intelligence_run_id: string | null;
  formula_version: string;
  source_total: number | null;
  snapshot_total: number | null;
  brief_total: number | null;
  snapshot_facts_hash: string | null;
  brief_facts_hash: string | null;
  failure_code: string | null;
  created_at: string;
}

export interface SourceHealth {
  tenant_id: string;
  source_connection_id: string;
  connection_status: 'active' | 'disabled';
  last_success_at: string | null;
  source_generated_at: string | null;
  source_age_seconds: number | null;
  freshness_status: 'uninitialized' | 'fresh' | 'stale' | 'future_source_timestamp';
  etag_fingerprint: string | null;
  circuit_state: PollCircuitState | 'uninitialized';
  consecutive_failures: number;
  next_attempt_at: string | null;
  last_failure_code: string | null;
  last_http_status: number | null;
  reconciliation: null | {
    id: string;
    business_date: string;
    checked_at: string;
    status: SourceReconciliationStatus;
    failure_code: string | null;
  };
}

export interface SourceOperationsAlert {
  code: string;
  tenant_id: string;
  source_connection_id: string;
  business_date: string;
  reconciliation_id: string;
}

export interface SourceOperationsAlertSink {
  emit(alert: SourceOperationsAlert): Promise<void>;
}

export class SourceOperationsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SourceOperationsError';
  }
}

export function sha256Fingerprint(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function safeSourceOperationsCode(value: string): string {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : 'unclassified_error';
}

export function validateBusinessDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new SourceOperationsError('invalid_business_date', 'business date must use YYYY-MM-DD');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new SourceOperationsError('invalid_business_date', 'business date is invalid');
  }
  return value;
}

export function validateBusinessTimezone(value: string): string {
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(value)) {
    throw new SourceOperationsError('invalid_business_timezone', 'business timezone is invalid');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
  } catch {
    throw new SourceOperationsError('invalid_business_timezone', 'business timezone is invalid');
  }
  return value;
}

/**
 * Authenticates an operator token against a configured SHA-256 fingerprint.
 * The raw token is never retained or returned by this object.
 */
export class OperatorAccessGuard {
  private readonly expected: Buffer;

  constructor(expectedFingerprint: string) {
    if (!/^sha256:[0-9a-f]{64}$/.test(expectedFingerprint)) {
      throw new SourceOperationsError(
        'invalid_operator_configuration',
        'operator credential fingerprint is invalid',
      );
    }
    this.expected = Buffer.from(expectedFingerprint.slice('sha256:'.length), 'hex');
  }

  assertAuthorized(token: string): void {
    if (typeof token !== 'string' || token.length === 0 || token.length > 4_096) {
      throw new SourceOperationsError('operator_unauthorized', 'operator authentication failed');
    }
    const actual = createHash('sha256').update(token).digest();
    if (!timingSafeEqual(actual, this.expected)) {
      throw new SourceOperationsError('operator_unauthorized', 'operator authentication failed');
    }
  }
}
