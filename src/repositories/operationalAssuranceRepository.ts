import { v4 as uuidv4 } from 'uuid';
import { canonicalStringify } from '../domain/businessMemory';
import {
  AssuranceCheck,
  AssuranceDerivedFacts,
  AssuranceEventType,
  OperationalAssuranceAssessmentRecord,
  OperationalAssuranceError,
  OperationalAssuranceEventRecord,
  OperationalAssurancePolicyRecord,
  OperationalAssuranceReleasePackageRecord,
  PHASE5_EXTERNAL_BLOCKERS,
  PHASE5_TABLES,
  assuranceFingerprint,
} from '../domain/operationalAssurance';
import {
  OperationalAssurancePolicyManifest,
  validateOperationalAssurancePolicy,
} from '../domain/operationalAssurancePolicy';
import {
  AutonomyAttemptRecord,
  BoundedAutonomyPolicyRecord,
  G7_TABLES,
} from '../domain/boundedAutonomy';
import {
  actionActor,
  actionCode,
  actionHash,
  actionIdempotencyKey,
  actionIso,
  actionUuid,
} from '../domain/supervisedAction';
import { db, Knex } from '../db/knex';
import { BoundedAutonomyRepository } from './boundedAutonomyRepository';

const EVENT_TYPES: readonly AssuranceEventType[] = [
  'policy_accepted', 'assessment_passed', 'assessment_failed', 'release_package_blocked',
];

function parseJson(value: unknown, code: string): unknown {
  if (typeof value !== 'string') throw new OperationalAssuranceError(code, 'stored JSON must be text');
  try {
    return JSON.parse(value);
  } catch {
    throw new OperationalAssuranceError(code, 'stored JSON is invalid');
  }
}

function asObject(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OperationalAssuranceError(code, 'stored value must be an object');
  }
  return value as Record<string, unknown>;
}

function exactObjectKeys(value: Record<string, unknown>, keys: readonly string[], code: string): void {
  if (Object.keys(value).sort().join('\u0000') !== [...keys].sort().join('\u0000')) {
    throw new OperationalAssuranceError(code, 'stored object keys are invalid');
  }
}

function nonNegativeInteger(value: unknown, code: string): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > Number.MAX_SAFE_INTEGER) {
    throw new OperationalAssuranceError(code, 'stored count is invalid');
  }
  return Number(value);
}

function booleanValue(value: unknown, code: string): boolean {
  if (value !== true && value !== false && value !== 0 && value !== 1) {
    throw new OperationalAssuranceError(code, 'stored boolean is invalid');
  }
  return Boolean(value);
}

function normalizedFacts(value: unknown): AssuranceDerivedFacts {
  const row = asObject(value, 'corrupt_assurance_facts');
  exactObjectKeys(row, [
    'assessed_at', 'window_started_at', 'assurance_policy_active', 'g5_current_go', 'g6_active', 'g7_active',
    'simulation_passed', 'kill_switch_state', 'open_incident_count', 'successful_executions',
    'failed_executions', 'reconciliation_required_executions', 'in_progress_executions',
    'successful_recoveries', 'resolved_incident_drills', 'event_count',
    'event_chain_fingerprint', 'production_registry_size',
  ], 'corrupt_assurance_facts');
  if (row.kill_switch_state !== 'engaged' && row.kill_switch_state !== 'released') {
    throw new OperationalAssuranceError('corrupt_assurance_facts', 'kill-switch state is invalid');
  }
  return {
    assessed_at: actionIso(row.assessed_at, 'corrupt_assurance_facts'),
    window_started_at: actionIso(row.window_started_at, 'corrupt_assurance_facts'),
    assurance_policy_active: booleanValue(row.assurance_policy_active, 'corrupt_assurance_facts'),
    g5_current_go: booleanValue(row.g5_current_go, 'corrupt_assurance_facts'),
    g6_active: booleanValue(row.g6_active, 'corrupt_assurance_facts'),
    g7_active: booleanValue(row.g7_active, 'corrupt_assurance_facts'),
    simulation_passed: booleanValue(row.simulation_passed, 'corrupt_assurance_facts'),
    kill_switch_state: row.kill_switch_state,
    open_incident_count: nonNegativeInteger(row.open_incident_count, 'corrupt_assurance_facts'),
    successful_executions: nonNegativeInteger(row.successful_executions, 'corrupt_assurance_facts'),
    failed_executions: nonNegativeInteger(row.failed_executions, 'corrupt_assurance_facts'),
    reconciliation_required_executions: nonNegativeInteger(row.reconciliation_required_executions, 'corrupt_assurance_facts'),
    in_progress_executions: nonNegativeInteger(row.in_progress_executions, 'corrupt_assurance_facts'),
    successful_recoveries: nonNegativeInteger(row.successful_recoveries, 'corrupt_assurance_facts'),
    resolved_incident_drills: nonNegativeInteger(row.resolved_incident_drills, 'corrupt_assurance_facts'),
    event_count: nonNegativeInteger(row.event_count, 'corrupt_assurance_facts'),
    event_chain_fingerprint: actionHash(row.event_chain_fingerprint, 'corrupt_assurance_facts'),
    production_registry_size: nonNegativeInteger(row.production_registry_size, 'corrupt_assurance_facts'),
  };
}

function normalizedChecks(value: unknown): AssuranceCheck[] {
  if (!Array.isArray(value) || value.length !== 15) {
    throw new OperationalAssuranceError('corrupt_assurance_checks', 'stored assurance checks are invalid');
  }
  return value.map((item) => {
    const row = asObject(item, 'corrupt_assurance_checks');
    exactObjectKeys(row, ['code', 'passed', 'evidence_fingerprint'], 'corrupt_assurance_checks');
    return {
      code: actionCode(row.code, 'corrupt_assurance_checks'),
      passed: booleanValue(row.passed, 'corrupt_assurance_checks'),
      evidence_fingerprint: actionHash(row.evidence_fingerprint, 'corrupt_assurance_checks'),
    };
  });
}

function normalizedBlockers(value: unknown): string[] {
  if (!Array.isArray(value) || canonicalStringify(value) !== canonicalStringify(PHASE5_EXTERNAL_BLOCKERS)) {
    throw new OperationalAssuranceError('corrupt_external_blockers', 'external blocker set is invalid');
  }
  return [...PHASE5_EXTERNAL_BLOCKERS];
}

function normalizedPolicy(
  row: OperationalAssurancePolicyRecord | undefined,
  g7: Awaited<ReturnType<BoundedAutonomyRepository['findPolicy']>>,
): { record: OperationalAssurancePolicyRecord; manifest: OperationalAssurancePolicyManifest } {
  if (!row) throw new OperationalAssuranceError('missing_assurance_policy', 'operational-assurance policy does not exist', 404);
  const manifestInput = parseJson(row.manifest_json, 'corrupt_assurance_policy');
  const validation = validateOperationalAssurancePolicy(manifestInput, g7.manifest, g7.g6.manifest);
  if (!validation.ok || !validation.value || !validation.fingerprint) {
    throw new OperationalAssuranceError('corrupt_assurance_policy', validation.issues.join('; '));
  }
  const record: OperationalAssurancePolicyRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_assurance_policy'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_assurance_policy'),
    source_connection_id: actionUuid(row.source_connection_id, 'corrupt_assurance_policy'),
    g7_policy_record_id: actionUuid(row.g7_policy_record_id, 'corrupt_assurance_policy'),
    policy_fingerprint: actionHash(row.policy_fingerprint, 'corrupt_assurance_policy'),
    g7_policy_fingerprint: actionHash(row.g7_policy_fingerprint, 'corrupt_assurance_policy'),
    valid_from: actionIso(row.valid_from, 'corrupt_assurance_policy'),
    valid_until: actionIso(row.valid_until, 'corrupt_assurance_policy'),
    accepted_at: actionIso(row.accepted_at, 'corrupt_assurance_policy'),
    created_at: actionIso(row.created_at, 'corrupt_assurance_policy'),
  };
  if (!/^P5-[A-Za-z0-9._-]{4,64}$/.test(record.policy_id)) {
    throw new OperationalAssuranceError('corrupt_assurance_policy', 'policy ID is invalid');
  }
  if (record.environment !== 'test' && record.environment !== 'production') {
    throw new OperationalAssuranceError('corrupt_assurance_policy', 'environment is invalid');
  }
  if (
    record.g7_policy_record_id !== g7.record.id
    || record.g7_policy_fingerprint !== g7.record.policy_fingerprint
    || record.policy_fingerprint !== validation.fingerprint
    || record.policy_id !== validation.value.policy_id
    || record.tenant_id !== validation.value.tenant_id
    || record.source_connection_id !== validation.value.source_connection_id
    || record.environment !== validation.value.environment
    || record.valid_from !== actionIso(validation.value.valid_from)
    || record.valid_until !== actionIso(validation.value.valid_until)
    || record.manifest_json !== canonicalStringify(validation.value)
  ) throw new OperationalAssuranceError('corrupt_assurance_policy', 'stored policy binding is invalid');
  return { record, manifest: validation.value };
}

function normalizedAssessment(row: OperationalAssuranceAssessmentRecord | undefined): OperationalAssuranceAssessmentRecord {
  if (!row) throw new OperationalAssuranceError('missing_assurance_assessment', 'assurance assessment does not exist', 404);
  const facts = normalizedFacts(parseJson(row.facts_json, 'corrupt_assurance_assessment'));
  const checks = normalizedChecks(parseJson(row.checks_json, 'corrupt_assurance_assessment'));
  normalizedBlockers(parseJson(row.external_blockers_json, 'corrupt_assurance_assessment'));
  const record: OperationalAssuranceAssessmentRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_assurance_assessment'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_assurance_assessment'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_assurance_assessment'),
    assessment_key: actionIdempotencyKey(row.assessment_key),
    policy_fingerprint: actionHash(row.policy_fingerprint, 'corrupt_assurance_assessment'),
    g7_policy_fingerprint: actionHash(row.g7_policy_fingerprint, 'corrupt_assurance_assessment'),
    facts_fingerprint: actionHash(row.facts_fingerprint, 'corrupt_assurance_assessment'),
    assessed_by: actionActor(row.assessed_by, 'corrupt_assurance_assessment'),
    assessed_at: actionIso(row.assessed_at, 'corrupt_assurance_assessment'),
    assessment_fingerprint: actionHash(row.assessment_fingerprint, 'corrupt_assurance_assessment'),
    created_at: actionIso(row.created_at, 'corrupt_assurance_assessment'),
  };
  if (record.local_status !== 'pass' && record.local_status !== 'fail') {
    throw new OperationalAssuranceError('corrupt_assurance_assessment', 'local status is invalid');
  }
  if (record.external_status !== 'blocked_external') {
    throw new OperationalAssuranceError('corrupt_assurance_assessment', 'external status is invalid');
  }
  if (record.facts_json !== canonicalStringify(facts) || record.checks_json !== canonicalStringify(checks)) {
    throw new OperationalAssuranceError('corrupt_assurance_assessment', 'stored assessment JSON is not canonical');
  }
  if (record.facts_fingerprint !== assuranceFingerprint(facts)) {
    throw new OperationalAssuranceError('corrupt_assurance_assessment', 'facts fingerprint is invalid');
  }
  const { id: _id, assessment_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.assessment_fingerprint !== assuranceFingerprint(core)) {
    throw new OperationalAssuranceError('corrupt_assurance_assessment', 'assessment fingerprint is invalid');
  }
  return record;
}

function normalizedReleasePackage(row: OperationalAssuranceReleasePackageRecord | undefined): OperationalAssuranceReleasePackageRecord {
  if (!row) throw new OperationalAssuranceError('missing_release_package', 'release package does not exist', 404);
  normalizedBlockers(parseJson(row.external_blockers_json, 'corrupt_release_package'));
  const record: OperationalAssuranceReleasePackageRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_release_package'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_release_package'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_release_package'),
    assessment_id: actionUuid(row.assessment_id, 'corrupt_release_package'),
    package_key: actionIdempotencyKey(row.package_key),
    policy_fingerprint: actionHash(row.policy_fingerprint, 'corrupt_release_package'),
    assessment_fingerprint: actionHash(row.assessment_fingerprint, 'corrupt_release_package'),
    reviewed_by: actionActor(row.reviewed_by, 'corrupt_release_package'),
    reviewed_at: actionIso(row.reviewed_at, 'corrupt_release_package'),
    package_fingerprint: actionHash(row.package_fingerprint, 'corrupt_release_package'),
    created_at: actionIso(row.created_at, 'corrupt_release_package'),
  };
  if (record.local_status !== 'pass' || record.release_status !== 'blocked_external') {
    throw new OperationalAssuranceError('corrupt_release_package', 'release package status is invalid');
  }
  const { id: _id, package_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.package_fingerprint !== assuranceFingerprint(core)) {
    throw new OperationalAssuranceError('corrupt_release_package', 'release package fingerprint is invalid');
  }
  return record;
}

function normalizedEvent(row: OperationalAssuranceEventRecord | undefined): OperationalAssuranceEventRecord {
  if (!row) throw new OperationalAssuranceError('corrupt_assurance_event', 'assurance event is missing');
  const record: OperationalAssuranceEventRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_assurance_event'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_assurance_event'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_assurance_event'),
    sequence: nonNegativeInteger(row.sequence, 'corrupt_assurance_event'),
    actor: actionActor(row.actor, 'corrupt_assurance_event'),
    evidence_fingerprint: actionHash(row.evidence_fingerprint, 'corrupt_assurance_event'),
    reason_code: actionCode(row.reason_code, 'corrupt_assurance_event'),
    occurred_at: actionIso(row.occurred_at, 'corrupt_assurance_event'),
    event_fingerprint: actionHash(row.event_fingerprint, 'corrupt_assurance_event'),
    created_at: actionIso(row.created_at, 'corrupt_assurance_event'),
  };
  if (record.sequence < 1 || !EVENT_TYPES.includes(record.event_type)) {
    throw new OperationalAssuranceError('corrupt_assurance_event', 'assurance event type or sequence is invalid');
  }
  const { id: _id, event_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.event_fingerprint !== assuranceFingerprint(core)) {
    throw new OperationalAssuranceError('corrupt_assurance_event', 'assurance event fingerprint is invalid');
  }
  return record;
}

export class OperationalAssuranceRepository {
  private readonly bounded: BoundedAutonomyRepository;

  constructor(private readonly knex: Knex = db, private readonly uuid: () => string = uuidv4) {
    this.bounded = new BoundedAutonomyRepository(knex, uuid);
  }

  async findG7Policy(policyId: string) {
    return this.bounded.findPolicy(policyId);
  }

  async findLatestG5Decision(tenantId: string, sourceConnectionId: string) {
    return this.bounded.findLatestG5Decision(tenantId, sourceConnectionId);
  }

  async recordPolicy(input: {
    manifest: OperationalAssurancePolicyManifest;
    g7: Awaited<ReturnType<BoundedAutonomyRepository['findPolicy']>>;
  }): Promise<OperationalAssurancePolicyRecord> {
    const validation = validateOperationalAssurancePolicy(input.manifest, input.g7.manifest, input.g7.g6.manifest);
    if (!validation.ok || !validation.value || !validation.fingerprint) {
      throw new OperationalAssuranceError('invalid_assurance_policy', validation.issues.join('; '), 400);
    }
    const manifest = validation.value;
    const policyFingerprint = validation.fingerprint;
    return this.knex.transaction(async (trx) => {
      const existing = await trx<OperationalAssurancePolicyRecord>(PHASE5_TABLES.policies)
        .where({ policy_id: manifest.policy_id }).first();
      if (existing) {
        const found = normalizedPolicy(existing, input.g7);
        if (found.record.policy_fingerprint !== validation.fingerprint) {
          throw new OperationalAssuranceError('assurance_policy_conflict', 'policy ID already has different evidence');
        }
        return found.record;
      }
      const record: OperationalAssurancePolicyRecord = {
        id: this.uuid(),
        tenant_id: manifest.tenant_id,
        source_connection_id: manifest.source_connection_id,
        g7_policy_record_id: input.g7.record.id,
        policy_id: manifest.policy_id,
        environment: manifest.environment,
        g7_policy_fingerprint: input.g7.record.policy_fingerprint,
        valid_from: actionIso(manifest.valid_from),
        valid_until: actionIso(manifest.valid_until),
        policy_fingerprint: policyFingerprint,
        manifest_json: canonicalStringify(manifest),
        accepted_at: actionIso(manifest.approved_at),
        created_at: actionIso(manifest.approved_at),
      };
      await trx(PHASE5_TABLES.policies).insert(record);
      await this.appendEvent(trx, record, 'policy_accepted', manifest.approved_by, record.policy_fingerprint, 'phase5_policy_accepted', record.accepted_at);
      return normalizedPolicy(await trx<OperationalAssurancePolicyRecord>(PHASE5_TABLES.policies).where({ id: record.id }).first(), input.g7).record;
    });
  }

  async findPolicy(policyId: string): Promise<{
    record: OperationalAssurancePolicyRecord;
    manifest: OperationalAssurancePolicyManifest;
    g7: Awaited<ReturnType<BoundedAutonomyRepository['findPolicy']>>;
  }> {
    const row = await this.knex<OperationalAssurancePolicyRecord>(PHASE5_TABLES.policies).where({ policy_id: policyId }).first();
    if (!row) throw new OperationalAssuranceError('missing_assurance_policy', 'operational-assurance policy does not exist', 404);
    const g7Row = await this.knex<BoundedAutonomyPolicyRecord>(G7_TABLES.policies).where({ id: row.g7_policy_record_id }).first();
    if (!g7Row) throw new OperationalAssuranceError('corrupt_assurance_policy', 'bound G7 policy is missing');
    const g7 = await this.bounded.findPolicy(g7Row.policy_id);
    return { ...normalizedPolicy(row, g7), g7 };
  }

  async deriveFacts(input: {
    policy: OperationalAssurancePolicyRecord;
    windowDays: number;
    assessedAt: string;
    assurancePolicyActive: boolean;
    g5CurrentGo: boolean;
    g6Active: boolean;
    g7Active: boolean;
    simulationPassed: boolean;
    productionRegistrySize: number;
  }): Promise<AssuranceDerivedFacts> {
    const assessedAt = actionIso(input.assessedAt);
    const windowStartedAt = new Date(Date.parse(assessedAt) - input.windowDays * 86_400_000).toISOString();
    const attempts = await this.knex<AutonomyAttemptRecord>(G7_TABLES.attempts)
      .where({ policy_record_id: input.policy.g7_policy_record_id })
      .andWhere('started_at', '>=', windowStartedAt)
      .andWhere('started_at', '<=', assessedAt);
    for (const attempt of attempts) {
      actionUuid(attempt.id, 'corrupt_autonomy_attempt');
      actionIso(attempt.started_at, 'corrupt_autonomy_attempt');
      if (!['execute', 'recovery'].includes(attempt.kind) || !['in_progress', 'succeeded', 'failed', 'reconciliation_required'].includes(attempt.status)) {
        throw new OperationalAssuranceError('corrupt_autonomy_attempt', 'attempt kind or status is invalid');
      }
    }
    const [kill, openIncidentCount, incidentEvents, events] = await Promise.all([
      this.bounded.latestKillSwitch(input.policy.g7_policy_record_id),
      this.bounded.countOpenIncidents(input.policy.g7_policy_record_id),
      this.bounded.listIncidentEvents(input.policy.g7_policy_record_id),
      this.bounded.listEvents(input.policy.g7_policy_record_id),
    ]);
    const latestIncident = new Map<string, (typeof incidentEvents)[number]>();
    for (const incident of incidentEvents) latestIncident.set(incident.incident_id, incident);
    const resolvedIncidentDrills = [...latestIncident.values()].filter(
      (incident) => incident.kind === 'resolved'
        && Date.parse(incident.occurred_at) >= Date.parse(windowStartedAt)
        && Date.parse(incident.occurred_at) <= Date.parse(assessedAt),
    ).length;
    const facts: AssuranceDerivedFacts = {
      assessed_at: assessedAt,
      window_started_at: windowStartedAt,
      assurance_policy_active: input.assurancePolicyActive,
      g5_current_go: input.g5CurrentGo,
      g6_active: input.g6Active,
      g7_active: input.g7Active,
      simulation_passed: input.simulationPassed,
      kill_switch_state: kill.state,
      open_incident_count: openIncidentCount,
      successful_executions: attempts.filter((row) => row.kind === 'execute' && row.status === 'succeeded').length,
      failed_executions: attempts.filter((row) => row.kind === 'execute' && row.status === 'failed').length,
      reconciliation_required_executions: attempts.filter((row) => row.kind === 'execute' && row.status === 'reconciliation_required').length,
      in_progress_executions: attempts.filter((row) => row.kind === 'execute' && row.status === 'in_progress').length,
      successful_recoveries: attempts.filter((row) => row.kind === 'recovery' && row.status === 'succeeded').length,
      resolved_incident_drills: resolvedIncidentDrills,
      event_count: events.length,
      event_chain_fingerprint: assuranceFingerprint(events.map((event) => ({
        sequence: event.sequence,
        event_fingerprint: event.event_fingerprint,
      }))),
      production_registry_size: nonNegativeInteger(input.productionRegistrySize, 'invalid_registry_size'),
    };
    return normalizedFacts(facts);
  }

  async recordAssessment(input: {
    policy: OperationalAssurancePolicyRecord;
    assessmentKey: string;
    facts: AssuranceDerivedFacts;
    checks: AssuranceCheck[];
    localStatus: 'pass' | 'fail';
    assessedBy: string;
  }): Promise<OperationalAssuranceAssessmentRecord> {
    const assessmentKey = actionIdempotencyKey(input.assessmentKey);
    const facts = normalizedFacts(input.facts);
    const checks = normalizedChecks(input.checks);
    const core = {
      tenant_id: input.policy.tenant_id,
      policy_record_id: input.policy.id,
      assessment_key: assessmentKey,
      policy_fingerprint: input.policy.policy_fingerprint,
      g7_policy_fingerprint: input.policy.g7_policy_fingerprint,
      facts_json: canonicalStringify(facts),
      facts_fingerprint: assuranceFingerprint(facts),
      checks_json: canonicalStringify(checks),
      local_status: input.localStatus,
      external_status: 'blocked_external' as const,
      external_blockers_json: canonicalStringify(PHASE5_EXTERNAL_BLOCKERS),
      assessed_by: actionActor(input.assessedBy, 'invalid_assessor'),
      assessed_at: actionIso(facts.assessed_at),
    };
    const candidate: OperationalAssuranceAssessmentRecord = {
      id: this.uuid(), ...core, assessment_fingerprint: assuranceFingerprint(core), created_at: core.assessed_at,
    };
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      const existing = await trx<OperationalAssuranceAssessmentRecord>(PHASE5_TABLES.assessments)
        .where({ policy_record_id: input.policy.id, assessment_key: assessmentKey }).first();
      if (existing) {
        const normalized = normalizedAssessment(existing);
        if (normalized.assessment_fingerprint !== candidate.assessment_fingerprint) {
          throw new OperationalAssuranceError('assessment_idempotency_conflict', 'assessment key has different evidence');
        }
        return normalized;
      }
      await trx(PHASE5_TABLES.assessments).insert(candidate);
      await this.appendEvent(
        trx,
        input.policy,
        input.localStatus === 'pass' ? 'assessment_passed' : 'assessment_failed',
        core.assessed_by,
        candidate.assessment_fingerprint,
        input.localStatus === 'pass' ? 'local_assurance_passed' : 'local_assurance_failed',
        core.assessed_at,
      );
      return normalizedAssessment(await trx<OperationalAssuranceAssessmentRecord>(PHASE5_TABLES.assessments).where({ id: candidate.id }).first());
    });
  }

  async findAssessment(policyRecordId: string, assessmentKey: string): Promise<OperationalAssuranceAssessmentRecord> {
    return normalizedAssessment(await this.knex<OperationalAssuranceAssessmentRecord>(PHASE5_TABLES.assessments)
      .where({ policy_record_id: policyRecordId, assessment_key: actionIdempotencyKey(assessmentKey) }).first());
  }

  async findAssessmentIfExists(
    policyRecordId: string,
    assessmentKey: string,
  ): Promise<OperationalAssuranceAssessmentRecord | null> {
    const row = await this.knex<OperationalAssuranceAssessmentRecord>(PHASE5_TABLES.assessments)
      .where({ policy_record_id: policyRecordId, assessment_key: actionIdempotencyKey(assessmentKey) }).first();
    return row ? normalizedAssessment(row) : null;
  }

  async latestAssessment(policyRecordId: string): Promise<OperationalAssuranceAssessmentRecord | null> {
    const row = await this.knex<OperationalAssuranceAssessmentRecord>(PHASE5_TABLES.assessments)
      .where({ policy_record_id: policyRecordId }).orderBy('assessed_at', 'desc').orderBy('id', 'desc').first();
    return row ? normalizedAssessment(row) : null;
  }

  async recordReleasePackage(input: {
    policy: OperationalAssurancePolicyRecord;
    assessment: OperationalAssuranceAssessmentRecord;
    packageKey: string;
    reviewedBy: string;
    reviewedAt: string;
  }): Promise<OperationalAssuranceReleasePackageRecord> {
    if (input.assessment.local_status !== 'pass') {
      throw new OperationalAssuranceError('local_assurance_not_passed', 'release package requires a passing local assessment');
    }
    if (
      input.assessment.policy_record_id !== input.policy.id
      || input.assessment.policy_fingerprint !== input.policy.policy_fingerprint
      || input.assessment.g7_policy_fingerprint !== input.policy.g7_policy_fingerprint
      || input.assessment.external_status !== 'blocked_external'
    ) throw new OperationalAssuranceError('assessment_binding_mismatch', 'assessment does not bind the exact policy');
    normalizedBlockers(parseJson(input.assessment.external_blockers_json, 'corrupt_assurance_assessment'));
    const core = {
      tenant_id: input.policy.tenant_id,
      policy_record_id: input.policy.id,
      assessment_id: input.assessment.id,
      package_key: actionIdempotencyKey(input.packageKey),
      policy_fingerprint: input.policy.policy_fingerprint,
      assessment_fingerprint: input.assessment.assessment_fingerprint,
      local_status: 'pass' as const,
      release_status: 'blocked_external' as const,
      external_blockers_json: canonicalStringify(PHASE5_EXTERNAL_BLOCKERS),
      reviewed_by: actionActor(input.reviewedBy, 'invalid_release_reviewer'),
      reviewed_at: actionIso(input.reviewedAt),
    };
    const candidate: OperationalAssuranceReleasePackageRecord = {
      id: this.uuid(), ...core, package_fingerprint: assuranceFingerprint(core), created_at: core.reviewed_at,
    };
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      const existing = await trx<OperationalAssuranceReleasePackageRecord>(PHASE5_TABLES.releasePackages)
        .where({ policy_record_id: input.policy.id, package_key: core.package_key }).first();
      if (existing) {
        const normalized = normalizedReleasePackage(existing);
        if (normalized.package_fingerprint !== candidate.package_fingerprint) {
          throw new OperationalAssuranceError('release_package_conflict', 'package key has different evidence');
        }
        return normalized;
      }
      const existingAssessment = await trx<OperationalAssuranceReleasePackageRecord>(PHASE5_TABLES.releasePackages)
        .where({ assessment_id: input.assessment.id }).first();
      if (existingAssessment) return normalizedReleasePackage(existingAssessment);
      await trx(PHASE5_TABLES.releasePackages).insert(candidate);
      await this.appendEvent(
        trx,
        input.policy,
        'release_package_blocked',
        core.reviewed_by,
        candidate.package_fingerprint,
        'external_evidence_missing',
        core.reviewed_at,
      );
      return normalizedReleasePackage(await trx<OperationalAssuranceReleasePackageRecord>(PHASE5_TABLES.releasePackages).where({ id: candidate.id }).first());
    });
  }

  async latestReleasePackage(policyRecordId: string): Promise<OperationalAssuranceReleasePackageRecord | null> {
    const row = await this.knex<OperationalAssuranceReleasePackageRecord>(PHASE5_TABLES.releasePackages)
      .where({ policy_record_id: policyRecordId }).orderBy('reviewed_at', 'desc').orderBy('id', 'desc').first();
    return row ? normalizedReleasePackage(row) : null;
  }

  async findReleasePackageIfExists(
    policyRecordId: string,
    packageKey: string,
  ): Promise<OperationalAssuranceReleasePackageRecord | null> {
    const row = await this.knex<OperationalAssuranceReleasePackageRecord>(PHASE5_TABLES.releasePackages)
      .where({ policy_record_id: policyRecordId, package_key: actionIdempotencyKey(packageKey) }).first();
    return row ? normalizedReleasePackage(row) : null;
  }

  async listEvents(policyRecordId: string): Promise<OperationalAssuranceEventRecord[]> {
    const rows = await this.knex<OperationalAssuranceEventRecord>(PHASE5_TABLES.events)
      .where({ policy_record_id: policyRecordId }).orderBy('sequence', 'asc');
    return rows.map(normalizedEvent);
  }

  private async appendEvent(
    trx: Knex.Transaction,
    policy: OperationalAssurancePolicyRecord,
    eventType: AssuranceEventType,
    actor: string,
    evidenceFingerprint: string,
    reasonCode: string,
    occurredAt: string,
  ): Promise<OperationalAssuranceEventRecord> {
    const max = await trx(PHASE5_TABLES.events).where({ policy_record_id: policy.id })
      .max<{ max: number | null }[]>({ max: 'sequence' });
    const core = {
      tenant_id: policy.tenant_id,
      policy_record_id: policy.id,
      sequence: Number(max[0]?.max ?? 0) + 1,
      event_type: eventType,
      actor: actionActor(actor, 'invalid_assurance_event_actor'),
      evidence_fingerprint: actionHash(evidenceFingerprint, 'invalid_assurance_event_evidence'),
      reason_code: actionCode(reasonCode, 'invalid_assurance_event_reason'),
      occurred_at: actionIso(occurredAt),
    };
    const event = normalizedEvent({
      id: this.uuid(), ...core, event_fingerprint: assuranceFingerprint(core), created_at: core.occurred_at,
    });
    await trx(PHASE5_TABLES.events).insert(event);
    return event;
  }

  private async lockPolicy(trx: Knex.Transaction, policyRecordId: string): Promise<void> {
    let query = trx(PHASE5_TABLES.policies).where({ id: policyRecordId });
    const client = String(trx.client.config.client);
    if (client === 'pg' || client.includes('postgres')) query = query.forUpdate();
    if (!await query.first()) throw new OperationalAssuranceError('missing_assurance_policy', 'operational-assurance policy does not exist', 404);
  }
}
