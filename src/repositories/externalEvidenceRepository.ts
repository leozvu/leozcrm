import { v4 as uuidv4 } from 'uuid';
import { canonicalStringify } from '../domain/businessMemory';
import {
  ExternalEvidenceAssessmentRecord,
  ExternalEvidenceAttestationRecord,
  ExternalEvidenceEnvelope,
  ExternalEvidenceError,
  ExternalEvidenceEventRecord,
  ExternalEvidenceEventType,
  ExternalEvidenceMatrixRow,
  ExternalEvidencePolicyRecord,
  PHASE6_TABLES,
  externalEvidenceFingerprint,
  validateExternalEvidenceEnvelope,
  verifyExternalEvidenceEnvelope,
} from '../domain/externalEvidence';
import {
  ExternalEvidencePolicyManifest,
  PHASE6_EVIDENCE_MATRIX,
  validateExternalEvidencePolicy,
} from '../domain/externalEvidencePolicy';
import { OperationalAssurancePolicyRecord, PHASE5_TABLES } from '../domain/operationalAssurance';
import {
  actionActor,
  actionCode,
  actionHash,
  actionIdempotencyKey,
  actionIso,
  actionUuid,
} from '../domain/supervisedAction';
import { db, Knex } from '../db/knex';
import { OperationalAssuranceRepository } from './operationalAssuranceRepository';

const EVENT_TYPES: readonly ExternalEvidenceEventType[] = [
  'policy_accepted',
  'attestation_admitted',
  'attestation_revoked',
  'assessment_incomplete',
  'assessment_complete_unreleased',
];

function parseJson(value: unknown, code: string): unknown {
  if (typeof value !== 'string') throw new ExternalEvidenceError(code, 'stored JSON must be text');
  try {
    return JSON.parse(value);
  } catch {
    throw new ExternalEvidenceError(code, 'stored JSON is invalid');
  }
}

function asObject(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ExternalEvidenceError(code, 'stored value must be an object');
  }
  return value as Record<string, unknown>;
}

function exactObjectKeys(value: Record<string, unknown>, keys: readonly string[], code: string): void {
  if (Object.keys(value).sort().join('\u0000') !== [...keys].sort().join('\u0000')) {
    throw new ExternalEvidenceError(code, 'stored object keys are invalid');
  }
}

function normalizePolicy(
  row: ExternalEvidencePolicyRecord | undefined,
  phase5: Awaited<ReturnType<OperationalAssuranceRepository['findPolicy']>>,
): { record: ExternalEvidencePolicyRecord; manifest: ExternalEvidencePolicyManifest } {
  if (!row) throw new ExternalEvidenceError('missing_external_evidence_policy', 'external-evidence policy does not exist', 404);
  const validation = validateExternalEvidencePolicy(
    parseJson(row.manifest_json, 'corrupt_external_evidence_policy'),
    phase5.manifest,
    phase5.g7.manifest,
    phase5.g7.g6.manifest,
  );
  if (!validation.ok || !validation.value || !validation.fingerprint) {
    throw new ExternalEvidenceError('corrupt_external_evidence_policy', validation.issues.join('; '));
  }
  const record: ExternalEvidencePolicyRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_external_evidence_policy'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_external_evidence_policy'),
    source_connection_id: actionUuid(row.source_connection_id, 'corrupt_external_evidence_policy'),
    phase5_policy_record_id: actionUuid(row.phase5_policy_record_id, 'corrupt_external_evidence_policy'),
    phase5_policy_fingerprint: actionHash(row.phase5_policy_fingerprint, 'corrupt_external_evidence_policy'),
    phase5_assessment_fingerprint: actionHash(row.phase5_assessment_fingerprint, 'corrupt_external_evidence_policy'),
    phase5_release_package_fingerprint: actionHash(row.phase5_release_package_fingerprint, 'corrupt_external_evidence_policy'),
    policy_fingerprint: actionHash(row.policy_fingerprint, 'corrupt_external_evidence_policy'),
    valid_from: actionIso(row.valid_from, 'corrupt_external_evidence_policy'),
    valid_until: actionIso(row.valid_until, 'corrupt_external_evidence_policy'),
    accepted_at: actionIso(row.accepted_at, 'corrupt_external_evidence_policy'),
    created_at: actionIso(row.created_at, 'corrupt_external_evidence_policy'),
  };
  if (!/^P6-[A-Za-z0-9._-]{4,64}$/.test(record.policy_id)) {
    throw new ExternalEvidenceError('corrupt_external_evidence_policy', 'stored policy ID is invalid');
  }
  if (record.environment !== 'test' && record.environment !== 'production') {
    throw new ExternalEvidenceError('corrupt_external_evidence_policy', 'stored environment is invalid');
  }
  if (
    record.phase5_policy_record_id !== phase5.record.id
    || record.tenant_id !== validation.value.tenant_id
    || record.source_connection_id !== validation.value.source_connection_id
    || record.policy_id !== validation.value.policy_id
    || record.environment !== validation.value.environment
    || record.phase5_policy_fingerprint !== validation.value.phase5.policy_fingerprint
    || record.phase5_assessment_fingerprint !== validation.value.phase5.assessment_fingerprint
    || record.phase5_release_package_fingerprint !== validation.value.phase5.release_package_fingerprint
    || record.policy_fingerprint !== validation.fingerprint
    || record.valid_from !== actionIso(validation.value.valid_from)
    || record.valid_until !== actionIso(validation.value.valid_until)
    || record.manifest_json !== canonicalStringify(validation.value)
  ) throw new ExternalEvidenceError('corrupt_external_evidence_policy', 'stored policy binding is invalid');
  return { record, manifest: validation.value };
}

function normalizeAttestation(
  row: ExternalEvidenceAttestationRecord | undefined,
  policy: ExternalEvidencePolicyManifest,
): { record: ExternalEvidenceAttestationRecord; envelope: ExternalEvidenceEnvelope } {
  if (!row) throw new ExternalEvidenceError('missing_external_attestation', 'external attestation does not exist', 404);
  const validation = validateExternalEvidenceEnvelope(
    parseJson(row.envelope_json, 'corrupt_external_attestation'),
    policy,
  );
  if (!validation.ok || !validation.value || !validation.fingerprint) {
    throw new ExternalEvidenceError('corrupt_external_attestation', validation.issues.join('; '));
  }
  if (!verifyExternalEvidenceEnvelope(validation.value, policy)) {
    throw new ExternalEvidenceError('corrupt_external_attestation', 'stored attestation signature is invalid');
  }
  const record: ExternalEvidenceAttestationRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_external_attestation'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_external_attestation'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_external_attestation'),
    attestation_id: actionUuid(row.attestation_id, 'corrupt_external_attestation'),
    supersedes_attestation_id: row.supersedes_attestation_id === null
      ? null
      : actionUuid(row.supersedes_attestation_id, 'corrupt_external_attestation'),
    issued_at: actionIso(row.issued_at, 'corrupt_external_attestation'),
    expires_at: actionIso(row.expires_at, 'corrupt_external_attestation'),
    envelope_fingerprint: actionHash(row.envelope_fingerprint, 'corrupt_external_attestation'),
    admitted_by: actionActor(row.admitted_by, 'corrupt_external_attestation'),
    admitted_at: actionIso(row.admitted_at, 'corrupt_external_attestation'),
    created_at: actionIso(row.created_at, 'corrupt_external_attestation'),
  };
  const attestation = validation.value.attestation;
  if (
    record.attestation_id !== attestation.attestation_id
    || record.evidence_type !== attestation.evidence_type
    || record.statement !== attestation.statement
    || record.supersedes_attestation_id !== attestation.supersedes_attestation_id
    || record.issuer_role !== attestation.issuer.role
    || record.issuer_id !== attestation.issuer.issuer_id
    || record.key_id !== attestation.issuer.key_id
    || record.nonce !== attestation.nonce
    || record.issued_at !== actionIso(attestation.issued_at)
    || record.expires_at !== actionIso(attestation.expires_at)
    || record.envelope_json !== canonicalStringify(validation.value)
    || record.envelope_fingerprint !== validation.fingerprint
  ) throw new ExternalEvidenceError('corrupt_external_attestation', 'stored attestation binding is invalid');
  return { record, envelope: validation.value };
}

function normalizeMatrix(value: unknown): ExternalEvidenceMatrixRow[] {
  if (!Array.isArray(value) || value.length !== PHASE6_EVIDENCE_MATRIX.length) {
    throw new ExternalEvidenceError('corrupt_external_evidence_matrix', 'stored evidence matrix is invalid');
  }
  return value.map((item, index) => {
    const row = asObject(item, 'corrupt_external_evidence_matrix');
    exactObjectKeys(row, [
      'evidence_type', 'blocker_code', 'issuer_role', 'status', 'attestation_id', 'envelope_fingerprint',
    ], 'corrupt_external_evidence_matrix');
    const expected = PHASE6_EVIDENCE_MATRIX[index];
    if (
      row.evidence_type !== expected.evidence_type
      || row.blocker_code !== expected.blocker_code
      || row.issuer_role !== expected.issuer_role
      || !['satisfied', 'missing', 'revoked', 'expired'].includes(String(row.status))
    ) throw new ExternalEvidenceError('corrupt_external_evidence_matrix', 'stored evidence matrix row is invalid');
    if (row.attestation_id !== null) actionUuid(row.attestation_id, 'corrupt_external_evidence_matrix');
    if (row.envelope_fingerprint !== null) actionHash(row.envelope_fingerprint, 'corrupt_external_evidence_matrix');
    if ((row.attestation_id === null) !== (row.envelope_fingerprint === null)) {
      throw new ExternalEvidenceError('corrupt_external_evidence_matrix', 'matrix evidence references are incomplete');
    }
    return row as unknown as ExternalEvidenceMatrixRow;
  });
}

function normalizeAssessment(row: ExternalEvidenceAssessmentRecord | undefined): ExternalEvidenceAssessmentRecord {
  if (!row) throw new ExternalEvidenceError('missing_external_evidence_assessment', 'external-evidence assessment does not exist', 404);
  const matrix = normalizeMatrix(parseJson(row.matrix_json, 'corrupt_external_evidence_assessment'));
  const record: ExternalEvidenceAssessmentRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_external_evidence_assessment'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_external_evidence_assessment'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_external_evidence_assessment'),
    assessment_key: actionIdempotencyKey(row.assessment_key),
    policy_fingerprint: actionHash(row.policy_fingerprint, 'corrupt_external_evidence_assessment'),
    phase5_release_package_fingerprint: actionHash(row.phase5_release_package_fingerprint, 'corrupt_external_evidence_assessment'),
    matrix_fingerprint: actionHash(row.matrix_fingerprint, 'corrupt_external_evidence_assessment'),
    assessed_by: actionActor(row.assessed_by, 'corrupt_external_evidence_assessment'),
    assessed_at: actionIso(row.assessed_at, 'corrupt_external_evidence_assessment'),
    assessment_fingerprint: actionHash(row.assessment_fingerprint, 'corrupt_external_evidence_assessment'),
    created_at: actionIso(row.created_at, 'corrupt_external_evidence_assessment'),
  };
  if (record.status !== 'incomplete' && record.status !== 'complete_unreleased') {
    throw new ExternalEvidenceError('corrupt_external_evidence_assessment', 'assessment status is invalid');
  }
  if (record.release_status !== 'blocked_external_activation') {
    throw new ExternalEvidenceError('corrupt_external_evidence_assessment', 'release status is invalid');
  }
  if (record.matrix_json !== canonicalStringify(matrix) || record.matrix_fingerprint !== externalEvidenceFingerprint(matrix)) {
    throw new ExternalEvidenceError('corrupt_external_evidence_assessment', 'matrix canonical form or fingerprint is invalid');
  }
  if ((record.status === 'complete_unreleased') !== matrix.every((item) => item.status === 'satisfied')) {
    throw new ExternalEvidenceError('corrupt_external_evidence_assessment', 'assessment status does not match matrix');
  }
  const { id: _id, assessment_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.assessment_fingerprint !== externalEvidenceFingerprint(core)) {
    throw new ExternalEvidenceError('corrupt_external_evidence_assessment', 'assessment fingerprint is invalid');
  }
  return record;
}

function normalizeEvent(row: ExternalEvidenceEventRecord): ExternalEvidenceEventRecord {
  const record: ExternalEvidenceEventRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_external_evidence_event'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_external_evidence_event'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_external_evidence_event'),
    sequence: Number(row.sequence),
    actor: actionActor(row.actor, 'corrupt_external_evidence_event'),
    evidence_fingerprint: actionHash(row.evidence_fingerprint, 'corrupt_external_evidence_event'),
    reason_code: actionCode(row.reason_code, 'corrupt_external_evidence_event'),
    occurred_at: actionIso(row.occurred_at, 'corrupt_external_evidence_event'),
    event_fingerprint: actionHash(row.event_fingerprint, 'corrupt_external_evidence_event'),
    created_at: actionIso(row.created_at, 'corrupt_external_evidence_event'),
  };
  if (!Number.isInteger(record.sequence) || record.sequence < 1 || !EVENT_TYPES.includes(record.event_type)) {
    throw new ExternalEvidenceError('corrupt_external_evidence_event', 'event type or sequence is invalid');
  }
  const { id: _id, event_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.event_fingerprint !== externalEvidenceFingerprint(core)) {
    throw new ExternalEvidenceError('corrupt_external_evidence_event', 'event fingerprint is invalid');
  }
  return record;
}

export class ExternalEvidenceRepository {
  private readonly assurance: OperationalAssuranceRepository;

  constructor(private readonly knex: Knex = db, private readonly uuid: () => string = uuidv4) {
    this.assurance = new OperationalAssuranceRepository(knex, uuid);
  }

  async findPhase5Policy(policyId: string) {
    return this.assurance.findPolicy(policyId);
  }

  async latestPhase5Assessment(policyRecordId: string) {
    return this.assurance.latestAssessment(policyRecordId);
  }

  async latestPhase5ReleasePackage(policyRecordId: string) {
    return this.assurance.latestReleasePackage(policyRecordId);
  }

  async findLatestG5Decision(tenantId: string, sourceConnectionId: string) {
    return this.assurance.findLatestG5Decision(tenantId, sourceConnectionId);
  }

  async deriveCurrentPhase5Facts(input: Parameters<OperationalAssuranceRepository['deriveFacts']>[0]) {
    return this.assurance.deriveFacts(input);
  }

  async recordPolicy(input: {
    manifest: ExternalEvidencePolicyManifest;
    phase5: Awaited<ReturnType<OperationalAssuranceRepository['findPolicy']>>;
  }): Promise<ExternalEvidencePolicyRecord> {
    const validation = validateExternalEvidencePolicy(
      input.manifest,
      input.phase5.manifest,
      input.phase5.g7.manifest,
      input.phase5.g7.g6.manifest,
    );
    if (!validation.ok || !validation.value || !validation.fingerprint) {
      throw new ExternalEvidenceError('invalid_external_evidence_policy', validation.issues.join('; '), 400);
    }
    const manifest = validation.value;
    const policyFingerprint = validation.fingerprint;
    return this.knex.transaction(async (trx) => {
      const existing = await trx<ExternalEvidencePolicyRecord>(PHASE6_TABLES.policies).where({ policy_id: manifest.policy_id }).first();
      if (existing) {
        const normalized = normalizePolicy(existing, input.phase5);
        if (normalized.record.policy_fingerprint !== validation.fingerprint) {
          throw new ExternalEvidenceError('external_evidence_policy_conflict', 'policy ID already has different evidence');
        }
        return normalized.record;
      }
      const record: ExternalEvidencePolicyRecord = {
        id: this.uuid(),
        tenant_id: manifest.tenant_id,
        source_connection_id: manifest.source_connection_id,
        phase5_policy_record_id: input.phase5.record.id,
        policy_id: manifest.policy_id,
        environment: manifest.environment,
        phase5_policy_fingerprint: manifest.phase5.policy_fingerprint,
        phase5_assessment_fingerprint: manifest.phase5.assessment_fingerprint,
        phase5_release_package_fingerprint: manifest.phase5.release_package_fingerprint,
        valid_from: actionIso(manifest.valid_from),
        valid_until: actionIso(manifest.valid_until),
        policy_fingerprint: policyFingerprint,
        manifest_json: canonicalStringify(manifest),
        accepted_at: actionIso(manifest.approved_at),
        created_at: actionIso(manifest.approved_at),
      };
      await trx(PHASE6_TABLES.policies).insert(record);
      await this.appendEvent(trx, record, 'policy_accepted', manifest.approved_by, policyFingerprint, 'phase6_policy_accepted', record.accepted_at);
      return normalizePolicy(await trx<ExternalEvidencePolicyRecord>(PHASE6_TABLES.policies).where({ id: record.id }).first(), input.phase5).record;
    });
  }

  async findPolicy(policyId: string): Promise<{
    record: ExternalEvidencePolicyRecord;
    manifest: ExternalEvidencePolicyManifest;
    phase5: Awaited<ReturnType<OperationalAssuranceRepository['findPolicy']>>;
  }> {
    const row = await this.knex<ExternalEvidencePolicyRecord>(PHASE6_TABLES.policies).where({ policy_id: policyId }).first();
    if (!row) throw new ExternalEvidenceError('missing_external_evidence_policy', 'external-evidence policy does not exist', 404);
    const phase5Row = await this.knex<OperationalAssurancePolicyRecord>(PHASE5_TABLES.policies).where({ id: row.phase5_policy_record_id }).first();
    if (!phase5Row) throw new ExternalEvidenceError('corrupt_external_evidence_policy', 'bound Phase 5 policy is missing');
    const phase5 = await this.assurance.findPolicy(phase5Row.policy_id);
    return { ...normalizePolicy(row, phase5), phase5 };
  }

  async recordAttestation(input: {
    policy: ExternalEvidencePolicyRecord;
    manifest: ExternalEvidencePolicyManifest;
    envelope: ExternalEvidenceEnvelope;
    envelopeFingerprint: string;
    admittedBy: string;
    admittedAt: string;
  }): Promise<ExternalEvidenceAttestationRecord> {
    const attestation = input.envelope.attestation;
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      const existing = await trx<ExternalEvidenceAttestationRecord>(PHASE6_TABLES.attestations)
        .where({ policy_record_id: input.policy.id, attestation_id: attestation.attestation_id }).first();
      if (existing) {
        const normalized = normalizeAttestation(existing, input.manifest).record;
        if (normalized.envelope_fingerprint !== input.envelopeFingerprint) {
          throw new ExternalEvidenceError('attestation_replay_conflict', 'attestation ID was replayed with different evidence');
        }
        return normalized;
      }
      const nonceReplay = await trx<ExternalEvidenceAttestationRecord>(PHASE6_TABLES.attestations)
        .where({ policy_record_id: input.policy.id, nonce: attestation.nonce }).first();
      if (nonceReplay) throw new ExternalEvidenceError('attestation_nonce_replay', 'attestation nonce was already used');
      const latestRow = await trx<ExternalEvidenceAttestationRecord>(PHASE6_TABLES.attestations)
        .where({ policy_record_id: input.policy.id, evidence_type: attestation.evidence_type })
        .orderBy('issued_at', 'desc').orderBy('created_at', 'desc').first();
      const latest = latestRow ? normalizeAttestation(latestRow, input.manifest).record : null;
      if (latest && Date.parse(actionIso(attestation.issued_at)) <= Date.parse(actionIso(latest.issued_at))) {
        throw new ExternalEvidenceError('non_monotonic_attestation', 'attestation must be newer than the latest statement');
      }
      if (attestation.statement === 'revoke') {
        if (!latest || latest.statement !== 'pass' || attestation.supersedes_attestation_id !== latest.attestation_id) {
          throw new ExternalEvidenceError('invalid_attestation_revocation', 'revocation must supersede the latest pass statement');
        }
      }
      const record: ExternalEvidenceAttestationRecord = {
        id: this.uuid(),
        tenant_id: input.policy.tenant_id,
        policy_record_id: input.policy.id,
        attestation_id: attestation.attestation_id,
        evidence_type: attestation.evidence_type,
        statement: attestation.statement,
        supersedes_attestation_id: attestation.supersedes_attestation_id,
        issuer_role: attestation.issuer.role,
        issuer_id: attestation.issuer.issuer_id,
        key_id: attestation.issuer.key_id,
        nonce: attestation.nonce,
        issued_at: actionIso(attestation.issued_at),
        expires_at: actionIso(attestation.expires_at),
        envelope_json: canonicalStringify(input.envelope),
        envelope_fingerprint: input.envelopeFingerprint,
        admitted_by: actionActor(input.admittedBy, 'invalid_external_evidence_actor'),
        admitted_at: actionIso(input.admittedAt),
        created_at: actionIso(input.admittedAt),
      };
      await trx(PHASE6_TABLES.attestations).insert(record);
      await this.appendEvent(
        trx,
        input.policy,
        attestation.statement === 'revoke' ? 'attestation_revoked' : 'attestation_admitted',
        record.admitted_by,
        record.envelope_fingerprint,
        attestation.statement === 'revoke' ? 'phase6_attestation_revoked' : 'phase6_attestation_admitted',
        record.admitted_at,
      );
      return normalizeAttestation(
        await trx<ExternalEvidenceAttestationRecord>(PHASE6_TABLES.attestations).where({ id: record.id }).first(),
        input.manifest,
      ).record;
    });
  }

  async latestAttestations(policyRecordId: string, manifest: ExternalEvidencePolicyManifest): Promise<Map<string, {
    record: ExternalEvidenceAttestationRecord;
    envelope: ExternalEvidenceEnvelope;
  }>> {
    const rows = await this.knex<ExternalEvidenceAttestationRecord>(PHASE6_TABLES.attestations)
      .where({ policy_record_id: policyRecordId }).orderBy('issued_at', 'desc').orderBy('created_at', 'desc');
    const result = new Map<string, { record: ExternalEvidenceAttestationRecord; envelope: ExternalEvidenceEnvelope }>();
    for (const row of rows) {
      const normalized = normalizeAttestation(row, manifest);
      if (!result.has(normalized.record.evidence_type)) result.set(normalized.record.evidence_type, normalized);
    }
    return result;
  }

  async findAssessmentIfExists(policyRecordId: string, assessmentKey: string): Promise<ExternalEvidenceAssessmentRecord | null> {
    const row = await this.knex<ExternalEvidenceAssessmentRecord>(PHASE6_TABLES.assessments)
      .where({ policy_record_id: policyRecordId, assessment_key: actionIdempotencyKey(assessmentKey) }).first();
    return row ? normalizeAssessment(row) : null;
  }

  async recordAssessment(input: {
    policy: ExternalEvidencePolicyRecord;
    assessmentKey: string;
    matrix: ExternalEvidenceMatrixRow[];
    status: 'incomplete' | 'complete_unreleased';
    assessedBy: string;
    assessedAt: string;
  }): Promise<ExternalEvidenceAssessmentRecord> {
    const assessmentKey = actionIdempotencyKey(input.assessmentKey);
    const matrix = normalizeMatrix(input.matrix);
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      const existing = await trx<ExternalEvidenceAssessmentRecord>(PHASE6_TABLES.assessments)
        .where({ policy_record_id: input.policy.id, assessment_key: assessmentKey }).first();
      if (existing) return normalizeAssessment(existing);
      const core = {
        tenant_id: input.policy.tenant_id,
        policy_record_id: input.policy.id,
        assessment_key: assessmentKey,
        policy_fingerprint: input.policy.policy_fingerprint,
        phase5_release_package_fingerprint: input.policy.phase5_release_package_fingerprint,
        matrix_json: canonicalStringify(matrix),
        matrix_fingerprint: externalEvidenceFingerprint(matrix),
        status: input.status,
        release_status: 'blocked_external_activation' as const,
        assessed_by: actionActor(input.assessedBy, 'invalid_external_evidence_actor'),
        assessed_at: actionIso(input.assessedAt),
      };
      const record: ExternalEvidenceAssessmentRecord = {
        id: this.uuid(),
        ...core,
        assessment_fingerprint: externalEvidenceFingerprint(core),
        created_at: actionIso(input.assessedAt),
      };
      await trx(PHASE6_TABLES.assessments).insert(record);
      await this.appendEvent(
        trx,
        input.policy,
        input.status === 'complete_unreleased' ? 'assessment_complete_unreleased' : 'assessment_incomplete',
        record.assessed_by,
        record.assessment_fingerprint,
        input.status === 'complete_unreleased' ? 'phase6_matrix_complete_unreleased' : 'phase6_matrix_incomplete',
        record.assessed_at,
      );
      return normalizeAssessment(await trx<ExternalEvidenceAssessmentRecord>(PHASE6_TABLES.assessments).where({ id: record.id }).first());
    });
  }

  async latestAssessment(policyRecordId: string): Promise<ExternalEvidenceAssessmentRecord | null> {
    const row = await this.knex<ExternalEvidenceAssessmentRecord>(PHASE6_TABLES.assessments)
      .where({ policy_record_id: policyRecordId }).orderBy('assessed_at', 'desc').orderBy('created_at', 'desc').first();
    return row ? normalizeAssessment(row) : null;
  }

  async listEvents(policyRecordId: string): Promise<ExternalEvidenceEventRecord[]> {
    const rows = await this.knex<ExternalEvidenceEventRecord>(PHASE6_TABLES.events)
      .where({ policy_record_id: policyRecordId }).orderBy('sequence', 'asc');
    return rows.map(normalizeEvent);
  }

  private async lockPolicy(trx: Knex.Transaction, policyRecordId: string): Promise<void> {
    let query = trx<ExternalEvidencePolicyRecord>(PHASE6_TABLES.policies).where({ id: policyRecordId });
    const client = String(trx.client.config.client);
    if (client === 'pg' || client.includes('postgres')) query = query.forUpdate();
    const policy = await query.first();
    if (!policy) throw new ExternalEvidenceError('missing_external_evidence_policy', 'external-evidence policy does not exist', 404);
  }

  private async appendEvent(
    trx: Knex.Transaction,
    policy: ExternalEvidencePolicyRecord,
    eventType: ExternalEvidenceEventType,
    actor: string,
    evidenceFingerprint: string,
    reasonCode: string,
    occurredAt: string,
  ): Promise<ExternalEvidenceEventRecord> {
    const previous = await trx<ExternalEvidenceEventRecord>(PHASE6_TABLES.events)
      .where({ policy_record_id: policy.id }).orderBy('sequence', 'desc').first();
    const core = {
      tenant_id: policy.tenant_id,
      policy_record_id: policy.id,
      sequence: previous ? Number(previous.sequence) + 1 : 1,
      event_type: eventType,
      actor: actionActor(actor, 'invalid_external_evidence_actor'),
      evidence_fingerprint: actionHash(evidenceFingerprint, 'invalid_external_evidence_fingerprint'),
      reason_code: actionCode(reasonCode, 'invalid_external_evidence_reason'),
      occurred_at: actionIso(occurredAt),
    };
    const event: ExternalEvidenceEventRecord = {
      id: this.uuid(),
      ...core,
      event_fingerprint: externalEvidenceFingerprint(core),
      created_at: actionIso(occurredAt),
    };
    await trx(PHASE6_TABLES.events).insert(event);
    return normalizeEvent(event);
  }
}
