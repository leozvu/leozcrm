import { v4 as uuidv4 } from 'uuid';
import { db, Knex } from '../db/knex';
import {
  PHASE2_TABLES,
  Phase2ReleaseDecisionRecord,
  ShadowDailyEvidence,
  ShadowTrustError,
  SourcePollRun,
  shadowDailyEvidenceKey,
} from '../domain/shadowTrust';
import { evidenceFingerprint } from '../domain/phase2Proof';
import { safeSourceOperationsCode, validateBusinessDate, validateBusinessTimezone } from '../domain/sourceOperations';

type PollRunInsert = Omit<SourcePollRun, 'id' | 'created_at'>;
type DailyInsert = Omit<ShadowDailyEvidence, 'id' | 'created_at'>;
type ReleaseInsert = Omit<Phase2ReleaseDecisionRecord, 'id' | 'created_at'>;

function iso(value: unknown): string | null {
  const millis = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function boolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function normalizedPollRun(row: SourcePollRun | undefined): SourcePollRun {
  if (!row) throw new ShadowTrustError('missing_poll_run', 'poll run does not exist');
  const started = iso(row.started_at);
  const finished = iso(row.finished_at);
  const created = iso(row.created_at);
  const sourceGenerated = row.source_generated_at === null ? null : iso(row.source_generated_at);
  const confirmed = row.confirmed_fresh_at === null ? null : iso(row.confirmed_fresh_at);
  const outcome = ['accepted', 'not_modified', 'failed', 'skipped'].includes(row.outcome);
  const success = row.outcome === 'accepted' || row.outcome === 'not_modified';
  const skipped = row.outcome === 'skipped';
  const failed = row.outcome === 'failed';
  if (
    !started
    || !finished
    || !created
    || !outcome
    || !['test', 'production'].includes(row.environment)
    || !Number.isInteger(row.latency_ms)
    || row.latency_ms < 0
    || !Number.isInteger(row.attempt_count)
    || row.attempt_count < 0
    || (row.error_code !== null && safeSourceOperationsCode(row.error_code) !== row.error_code)
    || (row.request_method !== null && row.request_method !== 'GET')
    || boolean(row.request_body_present)
    || row.source_mutation_count !== 0
    || (row.record_count !== null && (!Number.isInteger(row.record_count) || row.record_count < 0))
    || (row.source_generated_at !== null && sourceGenerated === null)
    || (row.confirmed_fresh_at !== null && confirmed === null)
    || (skipped && (
      row.attempt_count !== 0
      || row.request_method !== null
      || row.error_code !== null
      || row.http_status !== null
    ))
    || (success && (
      row.attempt_count < 1
      || row.request_method !== 'GET'
      || row.error_code !== null
      || row.record_count === null
      || row.snapshot_id === null
      || row.intelligence_run_id === null
      || row.confirmed_fresh_at === null
      || (row.outcome === 'accepted' && row.http_status !== 200)
      || (row.outcome === 'not_modified' && row.http_status !== 304)
    ))
    || (failed && (
      row.attempt_count < 1
      || row.request_method !== 'GET'
      || row.error_code === null
    ))
  ) throw new ShadowTrustError('corrupt_poll_run', 'poll run failed validation');
  return {
    ...row,
    started_at: started,
    finished_at: finished,
    source_generated_at: sourceGenerated,
    confirmed_fresh_at: confirmed,
    request_body_present: false,
    source_mutation_count: 0,
    created_at: created,
  };
}

function normalizedDaily(row: ShadowDailyEvidence | undefined): ShadowDailyEvidence {
  if (!row) throw new ShadowTrustError('missing_daily_evidence', 'daily evidence does not exist');
  validateBusinessDate(row.business_date);
  validateBusinessTimezone(row.business_timezone);
  const reviewed = iso(row.reviewed_at);
  const created = iso(row.created_at);
  let failures: unknown;
  try {
    failures = JSON.parse(row.failure_codes_json);
  } catch {
    failures = null;
  }
  const counts = [
    row.expected_syncs,
    row.scheduled_syncs,
    row.successful_syncs,
    row.not_modified_syncs,
    row.failed_syncs,
    row.skipped_invocations,
    row.source_mutation_count,
    row.incident_count,
    row.rollback_event_count,
  ];
  const normalized = {
    ...row,
    employee_workflow_regression: boolean(row.employee_workflow_regression),
    source_latency_regression: boolean(row.source_latency_regression),
    source_error_regression: boolean(row.source_error_regression),
    material_false_claim: boolean(row.material_false_claim),
    reviewed_at: reviewed ?? '',
    created_at: created ?? '',
  };
  const {
    id: _id,
    evidence_key: _evidenceKey,
    created_at: _createdAt,
    ...keyFacts
  } = normalized;
  if (
    !reviewed
    || !created
    || row.environment !== 'production'
    || !['passed', 'failed'].includes(row.status)
    || !['passed', 'failed'].includes(row.reconciliation_status)
    || counts.some((value) => !Number.isInteger(value) || value < 0)
    || !Number.isInteger(row.reviewer_score)
    || row.reviewer_score < 1
    || row.reviewer_score > 5
    || !Array.isArray(failures)
    || failures.some((value) => typeof value !== 'string' || safeSourceOperationsCode(value) !== value)
    || row.successful_syncs > row.scheduled_syncs
    || row.failed_syncs > row.scheduled_syncs
    || row.successful_syncs + row.failed_syncs !== row.scheduled_syncs
    || row.not_modified_syncs > row.successful_syncs
    || !/^sha256:[0-9a-f]{64}$/.test(row.evidence_key)
    || shadowDailyEvidenceKey(keyFacts) !== row.evidence_key
    || (row.status === 'passed' && failures.length !== 0)
    || (row.status === 'failed' && failures.length === 0)
  ) throw new ShadowTrustError('corrupt_daily_evidence', 'daily evidence failed validation');
  return normalized;
}

function normalizedRelease(row: Phase2ReleaseDecisionRecord | undefined): Phase2ReleaseDecisionRecord {
  if (!row) throw new ShadowTrustError('missing_release_decision', 'release decision does not exist');
  const decided = iso(row.decided_at);
  const created = iso(row.created_at);
  const normalized = {
    ...row,
    decided_at: decided ?? '',
    created_at: created ?? '',
  };
  const {
    id: _id,
    evidence_key: _evidenceKey,
    created_at: _createdAt,
    ...keyFacts
  } = normalized;
  if (
    !decided
    || !created
    || !['go', 'extend', 'revoke'].includes(row.decision)
    || safeSourceOperationsCode(row.reason_code) !== row.reason_code
    || (row.extend_until_business_date !== null && row.decision !== 'extend')
    || !/^sha256:[0-9a-f]{64}$/.test(row.evaluation_fingerprint)
    || evidenceFingerprint(keyFacts) !== row.evidence_key
  ) throw new ShadowTrustError('corrupt_release_decision', 'release decision failed validation');
  if (row.extend_until_business_date !== null) validateBusinessDate(row.extend_until_business_date);
  return normalized;
}

export class ShadowTrustRepository {
  constructor(
    private readonly knex: Knex = db,
    private readonly uuid: () => string = uuidv4,
  ) {}

  async recordPollRun(input: PollRunInsert): Promise<SourcePollRun> {
    const id = this.uuid();
    const candidate = normalizedPollRun({
      id,
      ...input,
      created_at: input.finished_at,
    });
    await this.knex(PHASE2_TABLES.pollRuns).insert(candidate)
      .onConflict(['environment', 'tenant_id', 'source_connection_id', 'correlation_id'])
      .ignore();
    const stored = normalizedPollRun(await this.knex<SourcePollRun>(PHASE2_TABLES.pollRuns).where({
      environment: input.environment,
      tenant_id: input.tenant_id,
      source_connection_id: input.source_connection_id,
      correlation_id: input.correlation_id,
    }).first());
    const comparable = (row: SourcePollRun) => {
      const { id: _id, created_at: _createdAt, ...rest } = row;
      return rest;
    };
    if (JSON.stringify(comparable(stored)) !== JSON.stringify(comparable(candidate))) {
      throw new ShadowTrustError(
        'poll_evidence_conflict',
        'poll correlation already has different immutable evidence',
      );
    }
    return stored;
  }

  async listPollRuns(input: {
    tenantId: string;
    sourceConnectionId: string;
    environment: 'test' | 'production';
    from: string;
    to: string;
  }): Promise<SourcePollRun[]> {
    const rows = await this.knex<SourcePollRun>(PHASE2_TABLES.pollRuns)
      .where({
        tenant_id: input.tenantId,
        source_connection_id: input.sourceConnectionId,
        environment: input.environment,
      })
      .andWhere('started_at', '>=', input.from)
      .andWhere('started_at', '<', input.to)
      .orderBy('started_at', 'asc')
      .orderBy('id', 'asc');
    return rows.map(normalizedPollRun);
  }

  async recordDailyEvidence(input: DailyInsert): Promise<ShadowDailyEvidence> {
    const id = this.uuid();
    const candidate = normalizedDaily({ id, ...input, created_at: input.reviewed_at });
    await this.knex(PHASE2_TABLES.dailyEvidence).insert(candidate)
      .onConflict(['environment', 'tenant_id', 'source_connection_id', 'business_date'])
      .ignore();
    const stored = normalizedDaily(await this.knex<ShadowDailyEvidence>(PHASE2_TABLES.dailyEvidence)
      .where({
        environment: input.environment,
        tenant_id: input.tenant_id,
        source_connection_id: input.source_connection_id,
        business_date: input.business_date,
      })
      .first());
    // The key is recomputed from every normalized fact before insert/read, so
    // equality is an exact content-addressed identity check across SQL dialects.
    if (stored.evidence_key !== candidate.evidence_key) {
      throw new ShadowTrustError(
        'daily_evidence_conflict',
        'business date already has different immutable evidence',
      );
    }
    return stored;
  }

  async listDailyEvidence(tenantId: string, sourceConnectionId: string): Promise<ShadowDailyEvidence[]> {
    const rows = await this.knex<ShadowDailyEvidence>(PHASE2_TABLES.dailyEvidence)
      .where({ tenant_id: tenantId, source_connection_id: sourceConnectionId, environment: 'production' })
      .orderBy('business_date', 'asc');
    return rows.map(normalizedDaily);
  }

  async recordReleaseDecision(input: ReleaseInsert): Promise<Phase2ReleaseDecisionRecord> {
    const id = this.uuid();
    const candidate = normalizedRelease({ id, ...input, created_at: input.decided_at });
    await this.knex(PHASE2_TABLES.releaseDecisions).insert(candidate)
      .onConflict('evidence_key')
      .ignore();
    const stored = normalizedRelease(await this.knex<Phase2ReleaseDecisionRecord>(PHASE2_TABLES.releaseDecisions)
      .where({ evidence_key: input.evidence_key })
      .first());
    if (stored.evidence_key !== candidate.evidence_key) {
      throw new ShadowTrustError(
        'release_evidence_conflict',
        'release evidence key already has different immutable evidence',
      );
    }
    return stored;
  }
}
