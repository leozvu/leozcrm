import { canonicalStringify } from './businessMemory';
import { evidenceFingerprint } from './phase2Proof';
import { validateBusinessDate, validateBusinessTimezone } from './sourceOperations';

export const PHASE2_TABLES = {
  pollRuns: 'source_poll_runs',
  dailyEvidence: 'shadow_daily_evidence',
  releaseDecisions: 'phase2_release_decisions',
} as const;

export type Phase2Environment = 'test' | 'production';
export type PollRunOutcome = 'accepted' | 'not_modified' | 'failed' | 'skipped';
export type ShadowReleaseDecision = 'go' | 'extend' | 'revoke';

export interface SourcePollRun {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  environment: Phase2Environment;
  authorization_id: string;
  correlation_id: string;
  started_at: string;
  finished_at: string;
  latency_ms: number;
  outcome: PollRunOutcome;
  attempt_count: number;
  http_status: number | null;
  error_code: string | null;
  request_method: 'GET' | null;
  request_body_present: false;
  snapshot_id: string | null;
  intelligence_run_id: string | null;
  record_count: number | null;
  source_generated_at: string | null;
  confirmed_fresh_at: string | null;
  source_mutation_count: 0;
  created_at: string;
}

export interface ShadowDailyEvidence {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  environment: 'production';
  authorization_id: string;
  business_date: string;
  business_timezone: string;
  evidence_key: string;
  expected_syncs: number;
  scheduled_syncs: number;
  successful_syncs: number;
  not_modified_syncs: number;
  failed_syncs: number;
  skipped_invocations: number;
  latest_confirmation_age_seconds: number | null;
  stale_after_seconds: number;
  reconciliation_id: string;
  reconciliation_status: 'passed' | 'failed';
  source_total: number | null;
  snapshot_total: number | null;
  brief_total: number | null;
  native_stage_delta_count: number | null;
  safe_source_delta_count: number | null;
  source_mutation_count: number;
  employee_workflow_regression: boolean;
  source_latency_regression: boolean;
  source_error_regression: boolean;
  formula_version: string;
  snapshot_id: string | null;
  intelligence_run_id: string | null;
  reviewer: string;
  reviewer_score: number;
  material_false_claim: boolean;
  incident_count: number;
  rollback_event_count: number;
  status: 'passed' | 'failed';
  failure_codes_json: string;
  reviewed_at: string;
  created_at: string;
}

export interface Phase2ReleaseDecisionRecord {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  authorization_id: string;
  decision: ShadowReleaseDecision;
  decided_by: string;
  decided_at: string;
  evaluation_fingerprint: string;
  reason_code: string;
  extend_until_business_date: string | null;
  evidence_key: string;
  created_at: string;
}

export interface ShadowWindowEvaluation {
  verdict: 'pass' | 'blocked';
  required_business_days: 10;
  qualifying_business_dates: string[];
  consecutive_business_days: number;
  scheduled_syncs: number;
  successful_syncs: number;
  success_rate: number;
  average_reviewer_score: number;
  failure_codes: string[];
  evidence_fingerprint: string;
}

export class ShadowTrustError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ShadowTrustError';
  }
}

export function businessDateAt(value: string | Date, timezone: string): string {
  validateBusinessTimezone(timezone);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ShadowTrustError('invalid_timestamp', 'timestamp is invalid');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${valueOf('year')}-${valueOf('month')}-${valueOf('day')}`;
}

export function weekdayOfBusinessDate(value: string): string {
  validateBusinessDate(value);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
  }).format(new Date(`${value}T12:00:00.000Z`)).toLowerCase();
}

function parseLocalTime(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new ShadowTrustError('invalid_business_window', 'business time must use HH:MM');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new ShadowTrustError('invalid_business_window', 'business time is invalid');
  }
  return hour * 60 + minute;
}

export function expectedSyncsForWindow(startLocal: string, endLocal: string): number {
  const start = parseLocalTime(startLocal);
  const end = parseLocalTime(endLocal);
  const duration = end > start ? end - start : (24 * 60) - start + end;
  if (duration === 0) throw new ShadowTrustError('invalid_business_window', 'business window is empty');
  return Math.max(1, Math.floor(duration / 15));
}

export function isInsideBusinessWindow(
  value: string | Date,
  timezone: string,
  startLocal: string,
  endLocal: string,
): boolean {
  validateBusinessTimezone(timezone);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ShadowTrustError('invalid_timestamp', 'timestamp is invalid');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  const current = hour * 60 + minute;
  const start = parseLocalTime(startLocal);
  const end = parseLocalTime(endLocal);
  if (end > start) return current >= start && current < end;
  return current >= start || current < end;
}

function nextCalendarDate(value: string): string {
  const date = new Date(`${validateBusinessDate(value)}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function nextBusinessDate(value: string, businessDays: readonly string[]): string {
  const allowed = new Set(businessDays.map((day) => day.toLowerCase()));
  if (allowed.size === 0) throw new ShadowTrustError('invalid_business_days', 'business days are empty');
  let candidate = value;
  for (let index = 0; index < 14; index += 1) {
    candidate = nextCalendarDate(candidate);
    if (allowed.has(weekdayOfBusinessDate(candidate))) return candidate;
  }
  throw new ShadowTrustError('invalid_business_days', 'no eligible business day was found');
}

export function dailyFailureCodes(row: Omit<ShadowDailyEvidence, 'id' | 'evidence_key' | 'status' | 'failure_codes_json' | 'created_at'>): string[] {
  const failures: string[] = [];
  if (row.scheduled_syncs < row.expected_syncs) failures.push('scheduled_sync_coverage_failed');
  if (row.scheduled_syncs === 0 || row.successful_syncs !== row.scheduled_syncs) {
    failures.push('daily_poll_failure');
  }
  if (
    row.latest_confirmation_age_seconds === null
    || row.latest_confirmation_age_seconds >= row.stale_after_seconds
  ) failures.push('source_stale');
  if (row.reconciliation_status !== 'passed') failures.push('reconciliation_failed');
  if (
    row.source_total === null
    || row.source_total !== row.snapshot_total
    || row.source_total !== row.brief_total
    || row.native_stage_delta_count !== 0
    || row.safe_source_delta_count !== 0
  ) failures.push('exact_counts_failed');
  if (row.source_mutation_count !== 0) failures.push('source_mutation_detected');
  if (row.employee_workflow_regression) failures.push('employee_workflow_regression');
  if (row.source_latency_regression) failures.push('source_latency_regression');
  if (row.source_error_regression) failures.push('source_error_regression');
  if (row.material_false_claim) failures.push('material_false_claim');
  if (row.reviewer_score < 1 || row.reviewer_score > 5) failures.push('invalid_reviewer_score');
  return [...new Set(failures)].sort();
}

function eligibleDay(row: ShadowDailyEvidence): boolean {
  return row.status === 'passed' && dailyFailureCodes(row).length === 0;
}

export function evaluateShadowWindow(
  rows: readonly ShadowDailyEvidence[],
  businessDays: readonly string[],
): ShadowWindowEvaluation {
  const ordered = [...rows].sort((a, b) => a.business_date.localeCompare(b.business_date));
  let current: ShadowDailyEvidence[] = [];
  let best: ShadowDailyEvidence[] = [];
  for (const row of ordered) {
    if (!eligibleDay(row)) {
      current = [];
      continue;
    }
    if (
      current.length === 0
      || row.business_date === nextBusinessDate(current[current.length - 1].business_date, businessDays)
    ) {
      current.push(row);
    } else {
      current = [row];
    }
    if (current.length > best.length) best = [...current];
  }
  const streak = best.slice(-10);
  const scheduled = streak.reduce((sum, row) => sum + row.scheduled_syncs, 0);
  const successful = streak.reduce((sum, row) => sum + row.successful_syncs, 0);
  const successRate = scheduled === 0 ? 0 : successful / scheduled;
  const averageScore = streak.length === 0
    ? 0
    : streak.reduce((sum, row) => sum + row.reviewer_score, 0) / streak.length;
  const failureCodes: string[] = [];
  if (best.length < 10) failureCodes.push('ten_consecutive_business_days_incomplete');
  if (successRate < 0.995) failureCodes.push('sync_success_rate_below_99_5');
  if (averageScore < 4) failureCodes.push('reviewer_usefulness_below_4');
  const core = {
    required_business_days: 10 as const,
    qualifying_business_dates: streak.map((row) => row.business_date),
    consecutive_business_days: Math.min(best.length, 10),
    scheduled_syncs: scheduled,
    successful_syncs: successful,
    success_rate: Number(successRate.toFixed(6)),
    average_reviewer_score: Number(averageScore.toFixed(2)),
    failure_codes: failureCodes,
  };
  return {
    verdict: failureCodes.length === 0 ? 'pass' : 'blocked',
    ...core,
    evidence_fingerprint: evidenceFingerprint(canonicalStringify(core)),
  };
}

export function shadowDailyEvidenceKey(
  value: Omit<ShadowDailyEvidence, 'id' | 'evidence_key' | 'created_at'>,
): string {
  return evidenceFingerprint(value);
}
