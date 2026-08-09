import { v4 as uuidv4 } from 'uuid';
import { canonicalStringify } from '../domain/businessMemory';
import {
  ActivationCeremonyDossierRecord,
  ActivationCeremonyError,
  ActivationCeremonyEventRecord,
  ActivationEventType,
  ActivationCeremonyHandoffRecord,
  ActivationCeremonyPolicyRecord,
  ActivationCeremonyRecallRecord,
  ActivationCeremonyVerificationRecord,
  ActivationDossierFacts,
  PHASE7_TABLES,
  activationCeremonyFingerprint,
} from '../domain/activationCeremony';
import {
  ActivationCeremonyPolicyManifest,
  validateActivationCeremonyPolicy,
} from '../domain/activationCeremonyPolicy';
import {
  ExternalEvidenceAssessmentRecord,
  ExternalEvidenceAttestationRecord,
  ExternalEvidencePolicyRecord,
  PHASE6_TABLES,
} from '../domain/externalEvidence';
import { PHASE6_EVIDENCE_MATRIX } from '../domain/externalEvidencePolicy';
import {
  actionActor,
  actionCode,
  actionHash,
  actionIdempotencyKey,
  actionIso,
  actionUuid,
} from '../domain/supervisedAction';
import { db, Knex } from '../db/knex';
import { ExternalEvidenceRepository } from './externalEvidenceRepository';

const EVENT_TYPES: readonly ActivationEventType[] = [
  'policy_accepted',
  'dossier_created',
  'dossier_approved',
  'dossier_rejected',
  'handoff_sealed',
  'handoff_recalled',
];

function parseJson(value: unknown, code: string): unknown {
  if (typeof value !== 'string') throw new ActivationCeremonyError(code, 'stored JSON must be text');
  try {
    return JSON.parse(value);
  } catch {
    throw new ActivationCeremonyError(code, 'stored JSON is invalid');
  }
}

function asObject(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ActivationCeremonyError(code, 'stored value must be an object');
  }
  return value as Record<string, unknown>;
}

function exactObjectKeys(value: Record<string, unknown>, keys: readonly string[], code: string): void {
  if (Object.keys(value).sort().join('\u0000') !== [...keys].sort().join('\u0000')) {
    throw new ActivationCeremonyError(code, 'stored object keys are invalid');
  }
}

function normalizeFacts(value: unknown): ActivationDossierFacts {
  const root = asObject(value, 'corrupt_activation_dossier_facts');
  exactObjectKeys(root, [
    'created_at', 'phase6_assessed_at', 'phase6_evidence_set_fingerprint', 'evidence',
    'deployment_id', 'target_fingerprint', 'target_contract_fingerprint',
    'canary_contract_fingerprint', 'rollback_contract_fingerprint',
  ], 'corrupt_activation_dossier_facts');
  if (!Array.isArray(root.evidence) || root.evidence.length !== PHASE6_EVIDENCE_MATRIX.length) {
    throw new ActivationCeremonyError('corrupt_activation_dossier_facts', 'stored evidence set is invalid');
  }
  const evidence = root.evidence.map((item, index) => {
    const row = asObject(item, 'corrupt_activation_dossier_facts');
    exactObjectKeys(row, ['evidence_type', 'attestation_id', 'envelope_fingerprint'], 'corrupt_activation_dossier_facts');
    if (row.evidence_type !== PHASE6_EVIDENCE_MATRIX[index].evidence_type) {
      throw new ActivationCeremonyError('corrupt_activation_dossier_facts', 'stored evidence order or type is invalid');
    }
    return {
      evidence_type: PHASE6_EVIDENCE_MATRIX[index].evidence_type,
      attestation_id: actionUuid(row.attestation_id, 'corrupt_activation_dossier_facts'),
      envelope_fingerprint: actionHash(row.envelope_fingerprint, 'corrupt_activation_dossier_facts'),
    };
  });
  if (typeof root.deployment_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(root.deployment_id)) {
    throw new ActivationCeremonyError('corrupt_activation_dossier_facts', 'stored deployment ID is invalid');
  }
  return {
    created_at: actionIso(root.created_at, 'corrupt_activation_dossier_facts'),
    phase6_assessed_at: actionIso(root.phase6_assessed_at, 'corrupt_activation_dossier_facts'),
    phase6_evidence_set_fingerprint: actionHash(root.phase6_evidence_set_fingerprint, 'corrupt_activation_dossier_facts'),
    evidence,
    deployment_id: root.deployment_id,
    target_fingerprint: actionHash(root.target_fingerprint, 'corrupt_activation_dossier_facts'),
    target_contract_fingerprint: actionHash(root.target_contract_fingerprint, 'corrupt_activation_dossier_facts'),
    canary_contract_fingerprint: actionHash(root.canary_contract_fingerprint, 'corrupt_activation_dossier_facts'),
    rollback_contract_fingerprint: actionHash(root.rollback_contract_fingerprint, 'corrupt_activation_dossier_facts'),
  };
}

function normalizePolicy(
  row: ActivationCeremonyPolicyRecord | undefined,
  phase6: Awaited<ReturnType<ExternalEvidenceRepository['findPolicy']>>,
): { record: ActivationCeremonyPolicyRecord; manifest: ActivationCeremonyPolicyManifest } {
  if (!row) throw new ActivationCeremonyError('missing_activation_policy', 'activation-ceremony policy does not exist', 404);
  const validation = validateActivationCeremonyPolicy(
    parseJson(row.manifest_json, 'corrupt_activation_policy'),
    phase6.manifest,
    phase6.phase5.manifest,
    phase6.phase5.g7.manifest,
    phase6.phase5.g7.g6.manifest,
  );
  if (!validation.ok || !validation.value || !validation.fingerprint) {
    throw new ActivationCeremonyError('corrupt_activation_policy', validation.issues.join('; '));
  }
  const record: ActivationCeremonyPolicyRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_policy'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_policy'),
    source_connection_id: actionUuid(row.source_connection_id, 'corrupt_activation_policy'),
    phase6_policy_record_id: actionUuid(row.phase6_policy_record_id, 'corrupt_activation_policy'),
    phase6_policy_fingerprint: actionHash(row.phase6_policy_fingerprint, 'corrupt_activation_policy'),
    phase6_assessment_fingerprint: actionHash(row.phase6_assessment_fingerprint, 'corrupt_activation_policy'),
    target_fingerprint: actionHash(row.target_fingerprint, 'corrupt_activation_policy'),
    valid_from: actionIso(row.valid_from, 'corrupt_activation_policy'),
    valid_until: actionIso(row.valid_until, 'corrupt_activation_policy'),
    policy_fingerprint: actionHash(row.policy_fingerprint, 'corrupt_activation_policy'),
    accepted_at: actionIso(row.accepted_at, 'corrupt_activation_policy'),
    created_at: actionIso(row.created_at, 'corrupt_activation_policy'),
  };
  if (!/^P7-[A-Za-z0-9._-]{4,64}$/.test(record.policy_id)) {
    throw new ActivationCeremonyError('corrupt_activation_policy', 'stored policy ID is invalid');
  }
  if (record.environment !== 'test' && record.environment !== 'production') {
    throw new ActivationCeremonyError('corrupt_activation_policy', 'stored environment is invalid');
  }
  if (
    record.phase6_policy_record_id !== phase6.record.id
    || record.tenant_id !== validation.value.tenant_id
    || record.source_connection_id !== validation.value.source_connection_id
    || record.policy_id !== validation.value.policy_id
    || record.environment !== validation.value.environment
    || record.phase6_policy_fingerprint !== validation.value.phase6.policy_fingerprint
    || record.phase6_assessment_fingerprint !== validation.value.phase6.assessment_fingerprint
    || record.target_fingerprint !== validation.value.target.target_fingerprint
    || record.valid_from !== actionIso(validation.value.valid_from)
    || record.valid_until !== actionIso(validation.value.valid_until)
    || record.policy_fingerprint !== validation.fingerprint
    || record.manifest_json !== canonicalStringify(validation.value)
  ) throw new ActivationCeremonyError('corrupt_activation_policy', 'stored activation-policy binding is invalid');
  return { record, manifest: validation.value };
}

function normalizeDossier(row: ActivationCeremonyDossierRecord | undefined): {
  record: ActivationCeremonyDossierRecord;
  facts: ActivationDossierFacts;
} {
  if (!row) throw new ActivationCeremonyError('missing_activation_dossier', 'activation dossier does not exist', 404);
  const facts = normalizeFacts(parseJson(row.facts_json, 'corrupt_activation_dossier'));
  const record: ActivationCeremonyDossierRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_dossier'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_dossier'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_activation_dossier'),
    dossier_key: actionIdempotencyKey(row.dossier_key),
    policy_fingerprint: actionHash(row.policy_fingerprint, 'corrupt_activation_dossier'),
    phase6_assessment_fingerprint: actionHash(row.phase6_assessment_fingerprint, 'corrupt_activation_dossier'),
    facts_fingerprint: actionHash(row.facts_fingerprint, 'corrupt_activation_dossier'),
    created_by: actionActor(row.created_by, 'corrupt_activation_dossier'),
    created_at: actionIso(row.created_at, 'corrupt_activation_dossier'),
    dossier_fingerprint: actionHash(row.dossier_fingerprint, 'corrupt_activation_dossier'),
  };
  if (record.status !== 'candidate') throw new ActivationCeremonyError('corrupt_activation_dossier', 'dossier status is invalid');
  if (record.facts_json !== canonicalStringify(facts) || record.facts_fingerprint !== activationCeremonyFingerprint(facts)) {
    throw new ActivationCeremonyError('corrupt_activation_dossier', 'dossier facts are invalid');
  }
  const { id: _id, dossier_fingerprint: _fingerprint, ...core } = record;
  if (record.dossier_fingerprint !== activationCeremonyFingerprint(core)) {
    throw new ActivationCeremonyError('corrupt_activation_dossier', 'dossier fingerprint is invalid');
  }
  return { record, facts };
}

function normalizeVerification(row: ActivationCeremonyVerificationRecord | undefined): ActivationCeremonyVerificationRecord {
  if (!row) throw new ActivationCeremonyError('missing_activation_verification', 'activation verification does not exist', 404);
  const record: ActivationCeremonyVerificationRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_verification'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_verification'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_activation_verification'),
    dossier_id: actionUuid(row.dossier_id, 'corrupt_activation_verification'),
    verification_key: actionIdempotencyKey(row.verification_key),
    dossier_fingerprint: actionHash(row.dossier_fingerprint, 'corrupt_activation_verification'),
    reason_code: actionCode(row.reason_code, 'corrupt_activation_verification'),
    verified_by: actionActor(row.verified_by, 'corrupt_activation_verification'),
    verified_at: actionIso(row.verified_at, 'corrupt_activation_verification'),
    expires_at: actionIso(row.expires_at, 'corrupt_activation_verification'),
    verification_fingerprint: actionHash(row.verification_fingerprint, 'corrupt_activation_verification'),
    created_at: actionIso(row.created_at, 'corrupt_activation_verification'),
  };
  if (record.decision !== 'approved' && record.decision !== 'rejected') {
    throw new ActivationCeremonyError('corrupt_activation_verification', 'verification decision is invalid');
  }
  if (Date.parse(record.expires_at) <= Date.parse(record.verified_at)) {
    throw new ActivationCeremonyError('corrupt_activation_verification', 'verification expiry is invalid');
  }
  const { id: _id, verification_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.verification_fingerprint !== activationCeremonyFingerprint(core)) {
    throw new ActivationCeremonyError('corrupt_activation_verification', 'verification fingerprint is invalid');
  }
  return record;
}

function normalizeHandoff(row: ActivationCeremonyHandoffRecord | undefined): ActivationCeremonyHandoffRecord {
  if (!row) throw new ActivationCeremonyError('missing_activation_handoff', 'activation handoff does not exist', 404);
  const storedExternalRequired: unknown = row.external_execution_required;
  if (storedExternalRequired !== true && storedExternalRequired !== 1) {
    throw new ActivationCeremonyError('corrupt_activation_handoff', 'handoff execution boundary is invalid');
  }
  const record: ActivationCeremonyHandoffRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_handoff'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_handoff'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_activation_handoff'),
    dossier_id: actionUuid(row.dossier_id, 'corrupt_activation_handoff'),
    verification_id: actionUuid(row.verification_id, 'corrupt_activation_handoff'),
    handoff_key: actionIdempotencyKey(row.handoff_key),
    policy_fingerprint: actionHash(row.policy_fingerprint, 'corrupt_activation_handoff'),
    dossier_fingerprint: actionHash(row.dossier_fingerprint, 'corrupt_activation_handoff'),
    verification_fingerprint: actionHash(row.verification_fingerprint, 'corrupt_activation_handoff'),
    phase6_evidence_set_fingerprint: actionHash(row.phase6_evidence_set_fingerprint, 'corrupt_activation_handoff'),
    external_execution_required: true,
    sealed_by: actionActor(row.sealed_by, 'corrupt_activation_handoff'),
    sealed_at: actionIso(row.sealed_at, 'corrupt_activation_handoff'),
    handoff_fingerprint: actionHash(row.handoff_fingerprint, 'corrupt_activation_handoff'),
    created_at: actionIso(row.created_at, 'corrupt_activation_handoff'),
  };
  if (!['rehearsal_handoff_sealed', 'production_handoff_sealed_external_execution_required'].includes(record.handoff_status)) {
    throw new ActivationCeremonyError('corrupt_activation_handoff', 'handoff status is invalid');
  }
  if (record.activation_status !== 'not_executed' || record.external_execution_required !== true) {
    throw new ActivationCeremonyError('corrupt_activation_handoff', 'handoff execution boundary is invalid');
  }
  const { id: _id, handoff_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.handoff_fingerprint !== activationCeremonyFingerprint(core)) {
    throw new ActivationCeremonyError('corrupt_activation_handoff', 'handoff fingerprint is invalid');
  }
  return record;
}

function normalizeRecall(row: ActivationCeremonyRecallRecord | undefined): ActivationCeremonyRecallRecord {
  if (!row) throw new ActivationCeremonyError('missing_activation_recall', 'activation recall does not exist', 404);
  const record: ActivationCeremonyRecallRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_recall'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_recall'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_activation_recall'),
    handoff_id: actionUuid(row.handoff_id, 'corrupt_activation_recall'),
    recall_key: actionIdempotencyKey(row.recall_key),
    handoff_fingerprint: actionHash(row.handoff_fingerprint, 'corrupt_activation_recall'),
    reason_code: actionCode(row.reason_code, 'corrupt_activation_recall'),
    evidence_fingerprint: actionHash(row.evidence_fingerprint, 'corrupt_activation_recall'),
    recalled_by: actionActor(row.recalled_by, 'corrupt_activation_recall'),
    verified_by: actionActor(row.verified_by, 'corrupt_activation_recall'),
    recalled_at: actionIso(row.recalled_at, 'corrupt_activation_recall'),
    recall_fingerprint: actionHash(row.recall_fingerprint, 'corrupt_activation_recall'),
    created_at: actionIso(row.created_at, 'corrupt_activation_recall'),
  };
  const { id: _id, recall_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.recall_fingerprint !== activationCeremonyFingerprint(core)) {
    throw new ActivationCeremonyError('corrupt_activation_recall', 'recall fingerprint is invalid');
  }
  return record;
}

function normalizeEvent(row: ActivationCeremonyEventRecord): ActivationCeremonyEventRecord {
  const record: ActivationCeremonyEventRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_event'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_event'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_activation_event'),
    sequence: Number(row.sequence),
    actor: actionActor(row.actor, 'corrupt_activation_event'),
    evidence_fingerprint: actionHash(row.evidence_fingerprint, 'corrupt_activation_event'),
    reason_code: actionCode(row.reason_code, 'corrupt_activation_event'),
    occurred_at: actionIso(row.occurred_at, 'corrupt_activation_event'),
    event_fingerprint: actionHash(row.event_fingerprint, 'corrupt_activation_event'),
    created_at: actionIso(row.created_at, 'corrupt_activation_event'),
  };
  if (!Number.isInteger(record.sequence) || record.sequence < 1 || !EVENT_TYPES.includes(record.event_type)) {
    throw new ActivationCeremonyError('corrupt_activation_event', 'event type or sequence is invalid');
  }
  const { id: _id, event_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.event_fingerprint !== activationCeremonyFingerprint(core)) {
    throw new ActivationCeremonyError('corrupt_activation_event', 'event fingerprint is invalid');
  }
  return record;
}

export class ActivationCeremonyRepository {
  private readonly external: ExternalEvidenceRepository;

  constructor(private readonly knex: Knex = db, private readonly uuid: () => string = uuidv4) {
    this.external = new ExternalEvidenceRepository(knex, uuid);
  }

  async findPhase6Policy(policyId: string) {
    return this.external.findPolicy(policyId);
  }

  async latestPhase6Assessment(policyRecordId: string) {
    return this.external.latestAssessment(policyRecordId);
  }

  async recordPolicy(input: {
    manifest: ActivationCeremonyPolicyManifest;
    phase6: Awaited<ReturnType<ExternalEvidenceRepository['findPolicy']>>;
    expectedEvidence: ActivationDossierFacts['evidence'];
  }): Promise<ActivationCeremonyPolicyRecord> {
    const validation = validateActivationCeremonyPolicy(
      input.manifest,
      input.phase6.manifest,
      input.phase6.phase5.manifest,
      input.phase6.phase5.g7.manifest,
      input.phase6.phase5.g7.g6.manifest,
    );
    if (!validation.ok || !validation.value || !validation.fingerprint) {
      throw new ActivationCeremonyError('invalid_activation_policy', validation.issues.join('; '), 400);
    }
    const manifest = validation.value;
    const policyFingerprint = validation.fingerprint;
    return this.knex.transaction(async (trx) => {
      await this.lockPhase6Snapshot(
        trx,
        input.phase6.record.id,
        manifest.phase6.assessment_fingerprint,
        input.expectedEvidence,
      );
      const existing = await trx<ActivationCeremonyPolicyRecord>(PHASE7_TABLES.policies).where({ policy_id: manifest.policy_id }).first();
      if (existing) {
        const normalized = normalizePolicy(existing, input.phase6);
        if (normalized.record.policy_fingerprint !== policyFingerprint) {
          throw new ActivationCeremonyError('activation_policy_conflict', 'policy ID already has different evidence');
        }
        return normalized.record;
      }
      const record: ActivationCeremonyPolicyRecord = {
        id: this.uuid(),
        tenant_id: manifest.tenant_id,
        source_connection_id: manifest.source_connection_id,
        phase6_policy_record_id: input.phase6.record.id,
        policy_id: manifest.policy_id,
        environment: manifest.environment,
        phase6_policy_fingerprint: manifest.phase6.policy_fingerprint,
        phase6_assessment_fingerprint: manifest.phase6.assessment_fingerprint,
        target_fingerprint: manifest.target.target_fingerprint,
        valid_from: actionIso(manifest.valid_from),
        valid_until: actionIso(manifest.valid_until),
        policy_fingerprint: policyFingerprint,
        manifest_json: canonicalStringify(manifest),
        accepted_at: actionIso(manifest.approved_at),
        created_at: actionIso(manifest.approved_at),
      };
      await trx(PHASE7_TABLES.policies).insert(record);
      await this.appendEvent(trx, record, 'policy_accepted', manifest.approved_by, policyFingerprint, 'phase7_policy_accepted', record.accepted_at);
      return normalizePolicy(await trx<ActivationCeremonyPolicyRecord>(PHASE7_TABLES.policies).where({ id: record.id }).first(), input.phase6).record;
    });
  }

  async findPolicy(policyId: string): Promise<{
    record: ActivationCeremonyPolicyRecord;
    manifest: ActivationCeremonyPolicyManifest;
    phase6: Awaited<ReturnType<ExternalEvidenceRepository['findPolicy']>>;
  }> {
    const row = await this.knex<ActivationCeremonyPolicyRecord>(PHASE7_TABLES.policies).where({ policy_id: policyId }).first();
    if (!row) throw new ActivationCeremonyError('missing_activation_policy', 'activation-ceremony policy does not exist', 404);
    const phase6Row = await this.knex<ExternalEvidencePolicyRecord>(PHASE6_TABLES.policies).where({ id: row.phase6_policy_record_id }).first();
    if (!phase6Row) throw new ActivationCeremonyError('corrupt_activation_policy', 'bound Phase 6 policy is missing');
    const phase6 = await this.external.findPolicy(phase6Row.policy_id);
    return { ...normalizePolicy(row, phase6), phase6 };
  }

  async findDossierIfExists(policyRecordId: string, dossierKey: string) {
    const row = await this.knex<ActivationCeremonyDossierRecord>(PHASE7_TABLES.dossiers)
      .where({ policy_record_id: policyRecordId, dossier_key: actionIdempotencyKey(dossierKey) }).first();
    return row ? normalizeDossier(row) : null;
  }

  async recordDossier(input: {
    policy: ActivationCeremonyPolicyRecord;
    dossierKey: string;
    facts: ActivationDossierFacts;
    createdBy: string;
  }): Promise<ActivationCeremonyDossierRecord> {
    const dossierKey = actionIdempotencyKey(input.dossierKey);
    const facts = normalizeFacts(input.facts);
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      await this.lockPhase6Snapshot(
        trx,
        input.policy.phase6_policy_record_id,
        input.policy.phase6_assessment_fingerprint,
        facts.evidence,
      );
      const existing = await trx<ActivationCeremonyDossierRecord>(PHASE7_TABLES.dossiers)
        .where({ policy_record_id: input.policy.id, dossier_key: dossierKey }).first();
      if (existing) {
        const normalized = normalizeDossier(existing);
        const { created_at: _existingCreatedAt, ...existingFacts } = normalized.facts;
        const { created_at: _requestedCreatedAt, ...requestedFacts } = facts;
        if (activationCeremonyFingerprint(existingFacts) !== activationCeremonyFingerprint(requestedFacts)) {
          throw new ActivationCeremonyError('activation_dossier_conflict', 'dossier key already binds different facts');
        }
        return normalized.record;
      }
      const core = {
        tenant_id: input.policy.tenant_id,
        policy_record_id: input.policy.id,
        dossier_key: dossierKey,
        policy_fingerprint: input.policy.policy_fingerprint,
        phase6_assessment_fingerprint: input.policy.phase6_assessment_fingerprint,
        facts_json: canonicalStringify(facts),
        facts_fingerprint: activationCeremonyFingerprint(facts),
        status: 'candidate' as const,
        created_by: actionActor(input.createdBy, 'invalid_activation_actor'),
        created_at: actionIso(facts.created_at),
      };
      const record: ActivationCeremonyDossierRecord = {
        id: this.uuid(),
        ...core,
        dossier_fingerprint: activationCeremonyFingerprint(core),
      };
      await trx(PHASE7_TABLES.dossiers).insert(record);
      await this.appendEvent(trx, input.policy, 'dossier_created', record.created_by, record.dossier_fingerprint, 'phase7_dossier_created', record.created_at);
      return normalizeDossier(await trx<ActivationCeremonyDossierRecord>(PHASE7_TABLES.dossiers).where({ id: record.id }).first()).record;
    });
  }

  async findDossier(policyRecordId: string, dossierKey: string) {
    const row = await this.knex<ActivationCeremonyDossierRecord>(PHASE7_TABLES.dossiers)
      .where({ policy_record_id: policyRecordId, dossier_key: actionIdempotencyKey(dossierKey) }).first();
    return normalizeDossier(row);
  }

  async findDossierById(dossierId: string) {
    const row = await this.knex<ActivationCeremonyDossierRecord>(PHASE7_TABLES.dossiers)
      .where({ id: actionUuid(dossierId, 'invalid_activation_dossier_id') }).first();
    return normalizeDossier(row);
  }

  async recordVerification(input: {
    policy: ActivationCeremonyPolicyRecord;
    dossier: ActivationCeremonyDossierRecord;
    verificationKey: string;
    decision: 'approved' | 'rejected';
    reasonCode: string;
    verifiedBy: string;
    verifiedAt: string;
    expiresAt: string;
  }): Promise<ActivationCeremonyVerificationRecord> {
    const verificationKey = actionIdempotencyKey(input.verificationKey);
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      const byKey = await trx<ActivationCeremonyVerificationRecord>(PHASE7_TABLES.verifications)
        .where({ policy_record_id: input.policy.id, verification_key: verificationKey }).first();
      if (byKey) {
        const normalized = normalizeVerification(byKey);
        if (normalized.dossier_id !== input.dossier.id || normalized.decision !== input.decision || normalized.reason_code !== input.reasonCode) {
          throw new ActivationCeremonyError('activation_verification_conflict', 'verification key already binds different evidence');
        }
        return normalized;
      }
      const existing = await trx<ActivationCeremonyVerificationRecord>(PHASE7_TABLES.verifications).where({ dossier_id: input.dossier.id }).first();
      if (existing) throw new ActivationCeremonyError('activation_dossier_already_verified', 'dossier already has a verification');
      const core = {
        tenant_id: input.policy.tenant_id,
        policy_record_id: input.policy.id,
        dossier_id: input.dossier.id,
        verification_key: verificationKey,
        dossier_fingerprint: input.dossier.dossier_fingerprint,
        decision: input.decision,
        reason_code: actionCode(input.reasonCode, 'invalid_activation_reason'),
        verified_by: actionActor(input.verifiedBy, 'invalid_activation_actor'),
        verified_at: actionIso(input.verifiedAt),
        expires_at: actionIso(input.expiresAt),
      };
      const record: ActivationCeremonyVerificationRecord = {
        id: this.uuid(),
        ...core,
        verification_fingerprint: activationCeremonyFingerprint(core),
        created_at: actionIso(input.verifiedAt),
      };
      await trx(PHASE7_TABLES.verifications).insert(record);
      await this.appendEvent(
        trx,
        input.policy,
        input.decision === 'approved' ? 'dossier_approved' : 'dossier_rejected',
        record.verified_by,
        record.verification_fingerprint,
        input.decision === 'approved' ? 'phase7_dossier_approved' : 'phase7_dossier_rejected',
        record.verified_at,
      );
      return normalizeVerification(await trx<ActivationCeremonyVerificationRecord>(PHASE7_TABLES.verifications).where({ id: record.id }).first());
    });
  }

  async findVerification(dossierId: string): Promise<ActivationCeremonyVerificationRecord> {
    return normalizeVerification(await this.knex<ActivationCeremonyVerificationRecord>(PHASE7_TABLES.verifications).where({ dossier_id: dossierId }).first());
  }

  async findVerificationIfExists(dossierId: string): Promise<ActivationCeremonyVerificationRecord | null> {
    const row = await this.knex<ActivationCeremonyVerificationRecord>(PHASE7_TABLES.verifications).where({ dossier_id: dossierId }).first();
    return row ? normalizeVerification(row) : null;
  }

  async findHandoffIfExists(policyRecordId: string, handoffKey: string): Promise<ActivationCeremonyHandoffRecord | null> {
    const row = await this.knex<ActivationCeremonyHandoffRecord>(PHASE7_TABLES.handoffs)
      .where({ policy_record_id: policyRecordId, handoff_key: actionIdempotencyKey(handoffKey) }).first();
    return row ? normalizeHandoff(row) : null;
  }

  async recordHandoff(input: {
    policy: ActivationCeremonyPolicyRecord;
    dossier: ActivationCeremonyDossierRecord;
    verification: ActivationCeremonyVerificationRecord;
    handoffKey: string;
    evidenceSetFingerprint: string;
    expectedEvidence: ActivationDossierFacts['evidence'];
    sealedBy: string;
    sealedAt: string;
  }): Promise<ActivationCeremonyHandoffRecord> {
    const handoffKey = actionIdempotencyKey(input.handoffKey);
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      await this.lockPhase6Snapshot(
        trx,
        input.policy.phase6_policy_record_id,
        input.policy.phase6_assessment_fingerprint,
        input.expectedEvidence,
      );
      const byKey = await trx<ActivationCeremonyHandoffRecord>(PHASE7_TABLES.handoffs)
        .where({ policy_record_id: input.policy.id, handoff_key: handoffKey }).first();
      if (byKey) {
        const normalized = normalizeHandoff(byKey);
        if (normalized.dossier_id !== input.dossier.id || normalized.verification_id !== input.verification.id) {
          throw new ActivationCeremonyError('activation_handoff_conflict', 'handoff key already binds different evidence');
        }
        return normalized;
      }
      const existing = await trx<ActivationCeremonyHandoffRecord>(PHASE7_TABLES.handoffs).where({ dossier_id: input.dossier.id }).first();
      if (existing) throw new ActivationCeremonyError('activation_dossier_already_sealed', 'dossier already has a sealed handoff');
      const policyHandoff = await trx<ActivationCeremonyHandoffRecord>(PHASE7_TABLES.handoffs).where({ policy_record_id: input.policy.id }).first();
      if (policyHandoff) throw new ActivationCeremonyError('activation_policy_already_sealed', 'policy already has its one sealed handoff');
      const core = {
        tenant_id: input.policy.tenant_id,
        policy_record_id: input.policy.id,
        dossier_id: input.dossier.id,
        verification_id: input.verification.id,
        handoff_key: handoffKey,
        policy_fingerprint: input.policy.policy_fingerprint,
        dossier_fingerprint: input.dossier.dossier_fingerprint,
        verification_fingerprint: input.verification.verification_fingerprint,
        phase6_evidence_set_fingerprint: actionHash(input.evidenceSetFingerprint, 'invalid_phase6_evidence_set'),
        handoff_status: input.policy.environment === 'production'
          ? 'production_handoff_sealed_external_execution_required' as const
          : 'rehearsal_handoff_sealed' as const,
        activation_status: 'not_executed' as const,
        external_execution_required: true as const,
        sealed_by: actionActor(input.sealedBy, 'invalid_activation_actor'),
        sealed_at: actionIso(input.sealedAt),
      };
      const record: ActivationCeremonyHandoffRecord = {
        id: this.uuid(),
        ...core,
        handoff_fingerprint: activationCeremonyFingerprint(core),
        created_at: actionIso(input.sealedAt),
      };
      await trx(PHASE7_TABLES.handoffs).insert(record);
      await this.appendEvent(trx, input.policy, 'handoff_sealed', record.sealed_by, record.handoff_fingerprint, 'phase7_handoff_sealed_external_only', record.sealed_at);
      return normalizeHandoff(await trx<ActivationCeremonyHandoffRecord>(PHASE7_TABLES.handoffs).where({ id: record.id }).first());
    });
  }

  async latestHandoff(policyRecordId: string): Promise<ActivationCeremonyHandoffRecord | null> {
    const row = await this.knex<ActivationCeremonyHandoffRecord>(PHASE7_TABLES.handoffs)
      .where({ policy_record_id: policyRecordId }).orderBy('sealed_at', 'desc').orderBy('created_at', 'desc').first();
    return row ? normalizeHandoff(row) : null;
  }

  async findRecallIfExists(handoffId: string): Promise<ActivationCeremonyRecallRecord | null> {
    const row = await this.knex<ActivationCeremonyRecallRecord>(PHASE7_TABLES.recalls).where({ handoff_id: handoffId }).first();
    return row ? normalizeRecall(row) : null;
  }

  async recordRecall(input: {
    policy: ActivationCeremonyPolicyRecord;
    handoff: ActivationCeremonyHandoffRecord;
    recallKey: string;
    reasonCode: string;
    evidenceFingerprint: string;
    recalledBy: string;
    verifiedBy: string;
    recalledAt: string;
  }): Promise<ActivationCeremonyRecallRecord> {
    const recallKey = actionIdempotencyKey(input.recallKey);
    const reasonCode = actionCode(input.reasonCode, 'invalid_activation_reason');
    const evidenceFingerprint = actionHash(input.evidenceFingerprint, 'invalid_activation_evidence');
    const recalledBy = actionActor(input.recalledBy, 'invalid_activation_actor');
    const verifiedBy = actionActor(input.verifiedBy, 'invalid_activation_actor');
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      const byKey = await trx<ActivationCeremonyRecallRecord>(PHASE7_TABLES.recalls)
        .where({ policy_record_id: input.policy.id, recall_key: recallKey }).first();
      if (byKey) {
        const normalized = normalizeRecall(byKey);
        if (
          normalized.handoff_id !== input.handoff.id
          || normalized.reason_code !== reasonCode
          || normalized.evidence_fingerprint !== evidenceFingerprint
          || normalized.recalled_by !== recalledBy
          || normalized.verified_by !== verifiedBy
        ) {
          throw new ActivationCeremonyError('activation_recall_conflict', 'recall key already binds different evidence');
        }
        return normalized;
      }
      const existing = await trx<ActivationCeremonyRecallRecord>(PHASE7_TABLES.recalls).where({ handoff_id: input.handoff.id }).first();
      if (existing) {
        const normalized = normalizeRecall(existing);
        if (
          normalized.recall_key !== recallKey
          || normalized.reason_code !== reasonCode
          || normalized.evidence_fingerprint !== evidenceFingerprint
          || normalized.recalled_by !== recalledBy
          || normalized.verified_by !== verifiedBy
        ) throw new ActivationCeremonyError('activation_handoff_already_recalled', 'handoff already has a different recall');
        return normalized;
      }
      const core = {
        tenant_id: input.policy.tenant_id,
        policy_record_id: input.policy.id,
        handoff_id: input.handoff.id,
        recall_key: recallKey,
        handoff_fingerprint: input.handoff.handoff_fingerprint,
        reason_code: reasonCode,
        evidence_fingerprint: evidenceFingerprint,
        recalled_by: recalledBy,
        verified_by: verifiedBy,
        recalled_at: actionIso(input.recalledAt),
      };
      const record: ActivationCeremonyRecallRecord = {
        id: this.uuid(),
        ...core,
        recall_fingerprint: activationCeremonyFingerprint(core),
        created_at: actionIso(input.recalledAt),
      };
      await trx(PHASE7_TABLES.recalls).insert(record);
      await this.appendEvent(trx, input.policy, 'handoff_recalled', record.recalled_by, record.recall_fingerprint, 'phase7_handoff_recalled', record.recalled_at);
      return normalizeRecall(await trx<ActivationCeremonyRecallRecord>(PHASE7_TABLES.recalls).where({ id: record.id }).first());
    });
  }

  async listEvents(policyRecordId: string): Promise<ActivationCeremonyEventRecord[]> {
    const rows = await this.knex<ActivationCeremonyEventRecord>(PHASE7_TABLES.events)
      .where({ policy_record_id: policyRecordId }).orderBy('sequence', 'asc');
    return rows.map(normalizeEvent);
  }

  private async lockPolicy(trx: Knex.Transaction, policyRecordId: string): Promise<void> {
    let query = trx<ActivationCeremonyPolicyRecord>(PHASE7_TABLES.policies).where({ id: policyRecordId });
    const client = String(trx.client.config.client);
    if (client === 'pg' || client.includes('postgres')) query = query.forUpdate();
    if (!(await query.first())) throw new ActivationCeremonyError('missing_activation_policy', 'activation-ceremony policy does not exist', 404);
  }

  private async lockPhase6Snapshot(
    trx: Knex.Transaction,
    phase6PolicyRecordId: string,
    expectedAssessmentFingerprint: string,
    expectedEvidence: ActivationDossierFacts['evidence'],
  ): Promise<void> {
    let policyQuery = trx<ExternalEvidencePolicyRecord>(PHASE6_TABLES.policies).where({ id: phase6PolicyRecordId });
    const client = String(trx.client.config.client);
    if (client === 'pg' || client.includes('postgres')) policyQuery = policyQuery.forUpdate();
    if (!(await policyQuery.first())) {
      throw new ActivationCeremonyError('phase6_policy_missing', 'bound Phase 6 policy no longer exists');
    }
    const assessment = await trx<ExternalEvidenceAssessmentRecord>(PHASE6_TABLES.assessments)
      .where({ policy_record_id: phase6PolicyRecordId })
      .orderBy('assessed_at', 'desc')
      .orderBy('created_at', 'desc')
      .first();
    if (
      !assessment
      || assessment.assessment_fingerprint !== expectedAssessmentFingerprint
      || assessment.status !== 'complete_unreleased'
      || assessment.release_status !== 'blocked_external_activation'
    ) throw new ActivationCeremonyError('phase6_snapshot_changed', 'Phase 6 assessment changed before persistence');

    const rows = await trx<ExternalEvidenceAttestationRecord>(PHASE6_TABLES.attestations)
      .where({ policy_record_id: phase6PolicyRecordId })
      .orderBy('issued_at', 'desc')
      .orderBy('created_at', 'desc');
    const latest = new Map<string, ExternalEvidenceAttestationRecord>();
    for (const row of rows) if (!latest.has(row.evidence_type)) latest.set(row.evidence_type, row);
    if (expectedEvidence.length !== PHASE6_EVIDENCE_MATRIX.length) {
      throw new ActivationCeremonyError('phase6_snapshot_changed', 'Phase 6 evidence snapshot is incomplete');
    }
    for (const [index, expected] of expectedEvidence.entries()) {
      const matrix = PHASE6_EVIDENCE_MATRIX[index];
      const current = latest.get(matrix.evidence_type);
      if (
        expected.evidence_type !== matrix.evidence_type
        || !current
        || current.statement !== 'pass'
        || current.attestation_id !== expected.attestation_id
        || current.envelope_fingerprint !== expected.envelope_fingerprint
      ) throw new ActivationCeremonyError('phase6_snapshot_changed', 'Phase 6 evidence changed before persistence');
    }
  }

  private async appendEvent(
    trx: Knex.Transaction,
    policy: ActivationCeremonyPolicyRecord,
    eventType: ActivationEventType,
    actor: string,
    evidenceFingerprint: string,
    reasonCode: string,
    occurredAt: string,
  ): Promise<ActivationCeremonyEventRecord> {
    const previous = await trx<ActivationCeremonyEventRecord>(PHASE7_TABLES.events)
      .where({ policy_record_id: policy.id }).orderBy('sequence', 'desc').first();
    const core = {
      tenant_id: policy.tenant_id,
      policy_record_id: policy.id,
      sequence: previous ? Number(previous.sequence) + 1 : 1,
      event_type: eventType,
      actor: actionActor(actor, 'invalid_activation_actor'),
      evidence_fingerprint: actionHash(evidenceFingerprint, 'invalid_activation_evidence'),
      reason_code: actionCode(reasonCode, 'invalid_activation_reason'),
      occurred_at: actionIso(occurredAt),
    };
    const event: ActivationCeremonyEventRecord = {
      id: this.uuid(),
      ...core,
      event_fingerprint: activationCeremonyFingerprint(core),
      created_at: actionIso(occurredAt),
    };
    await trx(PHASE7_TABLES.events).insert(event);
    return normalizeEvent(event);
  }
}
