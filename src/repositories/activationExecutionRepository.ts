import { v4 as uuidv4 } from 'uuid';
import { canonicalStringify } from '../domain/businessMemory';
import {
  ActivationAdapterObservation,
  ActivationAdapterPreview,
  ActivationAdapterResult,
  ActivationAdapterRollback,
  ActivationClaimRecord,
  ActivationExecutionError,
  ActivationExecutionEventRecord,
  ActivationExecutionEventType,
  ActivationExecutionPolicyRecord,
  ActivationIncidentRecord,
  ActivationKillSwitchEventRecord,
  ActivationObservationRecord,
  ActivationOutcomeRecord,
  ActivationPreviewRecord,
  ActivationReleaseRecord,
  ActivationRollbackRecord,
  PHASE8_TABLES,
  activationExecutionFingerprint,
  validateActivationAdapterObservation,
  validateActivationAdapterPreview,
  validateActivationAdapterResult,
  validateActivationAdapterRollback,
} from '../domain/activationExecution';
import {
  ActivationExecutionPolicyManifest,
  validateActivationExecutionPolicy,
} from '../domain/activationExecutionPolicy';
import {
  ActivationCeremonyDossierRecord,
  ActivationCeremonyHandoffRecord,
  ActivationCeremonyPolicyRecord,
  PHASE7_TABLES,
} from '../domain/activationCeremony';
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
import { ActivationCeremonyRepository } from './activationCeremonyRepository';

export type Phase7ExecutionState = Awaited<ReturnType<ActivationExecutionRepository['findPhase7State']>>;

const EVENT_TYPES: readonly ActivationExecutionEventType[] = [
  'policy_accepted', 'preview_recorded', 'activation_released', 'activation_claimed',
  'activation_succeeded', 'activation_failed', 'activation_unknown',
  'observation_healthy', 'observation_unhealthy', 'observation_unknown',
  'rollback_succeeded', 'rollback_failed', 'rollback_unknown', 'incident_opened',
];

function parseJson(value: unknown, code: string): unknown {
  if (typeof value !== 'string') throw new ActivationExecutionError(code, 'stored JSON must be text');
  try {
    return JSON.parse(value);
  } catch {
    throw new ActivationExecutionError(code, 'stored JSON is invalid');
  }
}

function normalizePolicy(row: ActivationExecutionPolicyRecord | undefined, state: Phase7ExecutionState) {
  if (!row) throw new ActivationExecutionError('missing_activation_execution_policy', 'activation-execution policy does not exist', 404);
  const validation = validateActivationExecutionPolicy(parseJson(row.manifest_json, 'corrupt_activation_execution_policy'), {
    phase7: state.found.manifest,
    handoff: state.handoff,
    phase6: state.found.phase6.manifest,
    phase5: state.found.phase6.phase5.manifest,
    g7: state.found.phase6.phase5.g7.manifest,
    g6: state.found.phase6.phase5.g7.g6.manifest,
  });
  if (!validation.ok || !validation.value || !validation.fingerprint) throw new ActivationExecutionError('corrupt_activation_execution_policy', validation.issues.join('; '));
  const record: ActivationExecutionPolicyRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_execution_policy'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_execution_policy'),
    source_connection_id: actionUuid(row.source_connection_id, 'corrupt_activation_execution_policy'),
    phase7_policy_record_id: actionUuid(row.phase7_policy_record_id, 'corrupt_activation_execution_policy'),
    phase7_handoff_id: actionUuid(row.phase7_handoff_id, 'corrupt_activation_execution_policy'),
    phase7_policy_fingerprint: actionHash(row.phase7_policy_fingerprint, 'corrupt_activation_execution_policy'),
    phase7_handoff_fingerprint: actionHash(row.phase7_handoff_fingerprint, 'corrupt_activation_execution_policy'),
    target_fingerprint: actionHash(row.target_fingerprint, 'corrupt_activation_execution_policy'),
    valid_from: actionIso(row.valid_from, 'corrupt_activation_execution_policy'),
    valid_until: actionIso(row.valid_until, 'corrupt_activation_execution_policy'),
    policy_fingerprint: actionHash(row.policy_fingerprint, 'corrupt_activation_execution_policy'),
    accepted_at: actionIso(row.accepted_at, 'corrupt_activation_execution_policy'),
    created_at: actionIso(row.created_at, 'corrupt_activation_execution_policy'),
  };
  const manifest = validation.value;
  if (
    record.policy_id !== manifest.policy_id
    || record.environment !== manifest.environment
    || record.tenant_id !== manifest.tenant_id
    || record.source_connection_id !== manifest.source_connection_id
    || record.phase7_policy_record_id !== state.found.record.id
    || record.phase7_handoff_id !== state.handoff.id
    || record.phase7_policy_fingerprint !== manifest.phase7.policy_fingerprint
    || record.phase7_handoff_fingerprint !== manifest.phase7.handoff_fingerprint
    || record.target_fingerprint !== manifest.target.target_fingerprint
    || record.adapter_id !== manifest.target.adapter_id
    || record.adapter_version !== manifest.target.adapter_version
    || record.valid_from !== actionIso(manifest.valid_from)
    || record.valid_until !== actionIso(manifest.valid_until)
    || record.policy_fingerprint !== validation.fingerprint
    || record.manifest_json !== canonicalStringify(manifest)
    || record.accepted_at !== actionIso(manifest.approved_at)
    || record.created_at !== record.accepted_at
  ) throw new ActivationExecutionError('corrupt_activation_execution_policy', 'stored policy binding is invalid');
  return { record, manifest };
}

function normalizeKill(row: ActivationKillSwitchEventRecord): ActivationKillSwitchEventRecord {
  const record: ActivationKillSwitchEventRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_kill_event'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_kill_event'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_activation_kill_event'),
    sequence: Number(row.sequence),
    actor: actionActor(row.actor, 'corrupt_activation_kill_event'),
    reason_code: actionCode(row.reason_code, 'corrupt_activation_kill_event'),
    evidence_fingerprint: actionHash(row.evidence_fingerprint, 'corrupt_activation_kill_event'),
    occurred_at: actionIso(row.occurred_at, 'corrupt_activation_kill_event'),
    event_fingerprint: actionHash(row.event_fingerprint, 'corrupt_activation_kill_event'),
    created_at: actionIso(row.created_at, 'corrupt_activation_kill_event'),
  };
  if (!Number.isInteger(record.sequence) || record.sequence < 1 || !['engaged', 'released'].includes(record.state) || record.created_at !== record.occurred_at) throw new ActivationExecutionError('corrupt_activation_kill_event', 'stored kill-switch event is invalid');
  const { id: _id, event_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.event_fingerprint !== activationExecutionFingerprint(core)) throw new ActivationExecutionError('corrupt_activation_kill_event', 'kill-switch fingerprint is invalid');
  return record;
}

function normalizePreview(row: ActivationPreviewRecord | undefined, policy: ActivationExecutionPolicyManifest) {
  if (!row) throw new ActivationExecutionError('missing_activation_preview', 'activation preview does not exist', 404);
  const record: ActivationPreviewRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_preview'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_preview'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_activation_preview'),
    preview_key: actionIdempotencyKey(row.preview_key),
    preview_fingerprint: actionHash(row.preview_fingerprint, 'corrupt_activation_preview'),
    requested_by: actionActor(row.requested_by, 'corrupt_activation_preview'),
    recorded_at: actionIso(row.recorded_at, 'corrupt_activation_preview'),
    created_at: actionIso(row.created_at, 'corrupt_activation_preview'),
  };
  const preview = validateActivationAdapterPreview(parseJson(record.preview_json, 'corrupt_activation_preview'), policy, record.recorded_at);
  if (
    record.adapter_id !== policy.target.adapter_id
    || record.adapter_version !== policy.target.adapter_version
    || record.preview_json !== canonicalStringify(preview)
    || record.preview_fingerprint !== activationExecutionFingerprint(preview)
    || record.created_at !== record.recorded_at
  ) throw new ActivationExecutionError('corrupt_activation_preview', 'stored preview binding is invalid');
  return { record, preview };
}

function normalizeRelease(row: ActivationReleaseRecord | undefined): ActivationReleaseRecord {
  if (!row) throw new ActivationExecutionError('missing_activation_release', 'activation release does not exist', 404);
  const record: ActivationReleaseRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_release'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_release'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_activation_release'),
    preview_id: actionUuid(row.preview_id, 'corrupt_activation_release'),
    release_key: actionIdempotencyKey(row.release_key),
    preview_fingerprint: actionHash(row.preview_fingerprint, 'corrupt_activation_release'),
    released_by: actionActor(row.released_by, 'corrupt_activation_release'),
    observed_by: actionActor(row.observed_by, 'corrupt_activation_release'),
    reason_code: actionCode(row.reason_code, 'corrupt_activation_release'),
    released_at: actionIso(row.released_at, 'corrupt_activation_release'),
    expires_at: actionIso(row.expires_at, 'corrupt_activation_release'),
    release_fingerprint: actionHash(row.release_fingerprint, 'corrupt_activation_release'),
    created_at: actionIso(row.created_at, 'corrupt_activation_release'),
  };
  if (Date.parse(record.expires_at) <= Date.parse(record.released_at) || record.created_at !== record.released_at) throw new ActivationExecutionError('corrupt_activation_release', 'release expiry or creation time is invalid');
  const { id: _id, release_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.release_fingerprint !== activationExecutionFingerprint(core)) throw new ActivationExecutionError('corrupt_activation_release', 'release fingerprint is invalid');
  return record;
}

function normalizeClaim(row: ActivationClaimRecord | undefined): ActivationClaimRecord {
  if (!row) throw new ActivationExecutionError('missing_activation_claim', 'activation claim does not exist', 404);
  const record: ActivationClaimRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_claim'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_claim'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_activation_claim'),
    release_id: actionUuid(row.release_id, 'corrupt_activation_claim'),
    preview_id: actionUuid(row.preview_id, 'corrupt_activation_claim'),
    activation_key: actionIdempotencyKey(row.activation_key),
    release_fingerprint: actionHash(row.release_fingerprint, 'corrupt_activation_claim'),
    preview_fingerprint: actionHash(row.preview_fingerprint, 'corrupt_activation_claim'),
    claimed_by: actionActor(row.claimed_by, 'corrupt_activation_claim'),
    claimed_at: actionIso(row.claimed_at, 'corrupt_activation_claim'),
    lease_expires_at: actionIso(row.lease_expires_at, 'corrupt_activation_claim'),
    claim_fingerprint: actionHash(row.claim_fingerprint, 'corrupt_activation_claim'),
    created_at: actionIso(row.created_at, 'corrupt_activation_claim'),
  };
  if (Date.parse(record.lease_expires_at) <= Date.parse(record.claimed_at) || record.created_at !== record.claimed_at) throw new ActivationExecutionError('corrupt_activation_claim', 'claim lease or creation time is invalid');
  const { id: _id, claim_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.claim_fingerprint !== activationExecutionFingerprint(core)) throw new ActivationExecutionError('corrupt_activation_claim', 'claim fingerprint is invalid');
  return record;
}

function normalizeOutcome(row: ActivationOutcomeRecord | undefined, policy: ActivationExecutionPolicyManifest) {
  if (!row) throw new ActivationExecutionError('missing_activation_outcome', 'activation outcome does not exist', 404);
  const record: ActivationOutcomeRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_outcome'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_outcome'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_activation_outcome'),
    claim_id: actionUuid(row.claim_id, 'corrupt_activation_outcome'),
    result_fingerprint: actionHash(row.result_fingerprint, 'corrupt_activation_outcome'),
    recorded_at: actionIso(row.recorded_at, 'corrupt_activation_outcome'),
    outcome_fingerprint: actionHash(row.outcome_fingerprint, 'corrupt_activation_outcome'),
    created_at: actionIso(row.created_at, 'corrupt_activation_outcome'),
  };
  const result = validateActivationAdapterResult(parseJson(record.result_json, 'corrupt_activation_outcome'), policy);
  if (record.outcome !== result.outcome || record.result_json !== canonicalStringify(result) || record.result_fingerprint !== activationExecutionFingerprint(result) || record.created_at !== record.recorded_at) throw new ActivationExecutionError('corrupt_activation_outcome', 'stored outcome result is invalid');
  const { id: _id, outcome_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.outcome_fingerprint !== activationExecutionFingerprint(core)) throw new ActivationExecutionError('corrupt_activation_outcome', 'outcome fingerprint is invalid');
  return { record, result };
}

function normalizeObservation(
  row: ActivationObservationRecord | undefined,
  policy: ActivationExecutionPolicyManifest,
  activation: ActivationAdapterResult,
) {
  if (!row) throw new ActivationExecutionError('missing_activation_observation', 'activation observation does not exist', 404);
  const record: ActivationObservationRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_observation'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_observation'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_activation_observation'),
    outcome_id: actionUuid(row.outcome_id, 'corrupt_activation_observation'),
    observation_key: actionIdempotencyKey(row.observation_key),
    observation_fingerprint: actionHash(row.observation_fingerprint, 'corrupt_activation_observation'),
    observed_by: actionActor(row.observed_by, 'corrupt_activation_observation'),
    recorded_at: actionIso(row.recorded_at, 'corrupt_activation_observation'),
    record_fingerprint: actionHash(row.record_fingerprint, 'corrupt_activation_observation'),
    created_at: actionIso(row.created_at, 'corrupt_activation_observation'),
  };
  const observation = validateActivationAdapterObservation(parseJson(record.observation_json, 'corrupt_activation_observation'), policy, activation);
  if (record.verdict !== observation.verdict || record.observation_json !== canonicalStringify(observation) || record.observation_fingerprint !== activationExecutionFingerprint(observation) || record.created_at !== record.recorded_at) throw new ActivationExecutionError('corrupt_activation_observation', 'stored observation is invalid');
  const { id: _id, record_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.record_fingerprint !== activationExecutionFingerprint(core)) throw new ActivationExecutionError('corrupt_activation_observation', 'observation record fingerprint is invalid');
  return { record, observation };
}

function normalizeRollback(
  row: ActivationRollbackRecord | undefined,
  policy: ActivationExecutionPolicyManifest,
  activation: ActivationAdapterResult,
) {
  if (!row) throw new ActivationExecutionError('missing_activation_rollback', 'activation rollback does not exist', 404);
  const record: ActivationRollbackRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_rollback'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_rollback'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_activation_rollback'),
    outcome_id: actionUuid(row.outcome_id, 'corrupt_activation_rollback'),
    rollback_key: actionIdempotencyKey(row.rollback_key),
    rollback_fingerprint: actionHash(row.rollback_fingerprint, 'corrupt_activation_rollback'),
    authorized_by: actionActor(row.authorized_by, 'corrupt_activation_rollback'),
    operated_by: actionActor(row.operated_by, 'corrupt_activation_rollback'),
    reason_code: actionCode(row.reason_code, 'corrupt_activation_rollback'),
    recorded_at: actionIso(row.recorded_at, 'corrupt_activation_rollback'),
    record_fingerprint: actionHash(row.record_fingerprint, 'corrupt_activation_rollback'),
    created_at: actionIso(row.created_at, 'corrupt_activation_rollback'),
  };
  const rollback = validateActivationAdapterRollback(parseJson(record.rollback_json, 'corrupt_activation_rollback'), policy, activation);
  if (record.outcome !== rollback.outcome || record.rollback_json !== canonicalStringify(rollback) || record.rollback_fingerprint !== activationExecutionFingerprint(rollback) || record.created_at !== record.recorded_at) throw new ActivationExecutionError('corrupt_activation_rollback', 'stored rollback is invalid');
  const { id: _id, record_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.record_fingerprint !== activationExecutionFingerprint(core)) throw new ActivationExecutionError('corrupt_activation_rollback', 'rollback record fingerprint is invalid');
  return { record, rollback };
}

function normalizeIncident(row: ActivationIncidentRecord): ActivationIncidentRecord {
  const record: ActivationIncidentRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_incident'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_incident'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_activation_incident'),
    incident_key: actionIdempotencyKey(row.incident_key),
    reason_code: actionCode(row.reason_code, 'corrupt_activation_incident'),
    evidence_fingerprint: actionHash(row.evidence_fingerprint, 'corrupt_activation_incident'),
    opened_by: actionActor(row.opened_by, 'corrupt_activation_incident'),
    opened_at: actionIso(row.opened_at, 'corrupt_activation_incident'),
    incident_fingerprint: actionHash(row.incident_fingerprint, 'corrupt_activation_incident'),
    created_at: actionIso(row.created_at, 'corrupt_activation_incident'),
  };
  if (record.created_at !== record.opened_at) throw new ActivationExecutionError('corrupt_activation_incident', 'incident creation time is invalid');
  const { id: _id, incident_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.incident_fingerprint !== activationExecutionFingerprint(core)) throw new ActivationExecutionError('corrupt_activation_incident', 'incident fingerprint is invalid');
  return record;
}

function normalizeEvent(row: ActivationExecutionEventRecord): ActivationExecutionEventRecord {
  const record: ActivationExecutionEventRecord = {
    ...row,
    id: actionUuid(row.id, 'corrupt_activation_execution_event'),
    tenant_id: actionUuid(row.tenant_id, 'corrupt_activation_execution_event'),
    policy_record_id: actionUuid(row.policy_record_id, 'corrupt_activation_execution_event'),
    sequence: Number(row.sequence),
    actor: actionActor(row.actor, 'corrupt_activation_execution_event'),
    reason_code: actionCode(row.reason_code, 'corrupt_activation_execution_event'),
    evidence_fingerprint: actionHash(row.evidence_fingerprint, 'corrupt_activation_execution_event'),
    occurred_at: actionIso(row.occurred_at, 'corrupt_activation_execution_event'),
    event_fingerprint: actionHash(row.event_fingerprint, 'corrupt_activation_execution_event'),
    created_at: actionIso(row.created_at, 'corrupt_activation_execution_event'),
  };
  if (!Number.isInteger(record.sequence) || record.sequence < 1 || !EVENT_TYPES.includes(record.event_type) || record.created_at !== record.occurred_at) throw new ActivationExecutionError('corrupt_activation_execution_event', 'event type, sequence, or creation time is invalid');
  const { id: _id, event_fingerprint: _fingerprint, created_at: _created, ...core } = record;
  if (record.event_fingerprint !== activationExecutionFingerprint(core)) throw new ActivationExecutionError('corrupt_activation_execution_event', 'event fingerprint is invalid');
  return record;
}

export class ActivationExecutionRepository {
  private readonly phase7: ActivationCeremonyRepository;

  constructor(private readonly knex: Knex = db, private readonly uuid: () => string = uuidv4) {
    this.phase7 = new ActivationCeremonyRepository(knex, uuid);
  }

  async findPhase7State(policyId: string) {
    const found = await this.phase7.findPolicy(policyId);
    const handoff = await this.phase7.latestHandoff(found.record.id);
    if (!handoff) throw new ActivationExecutionError('phase7_handoff_missing', 'Phase 7 sealed handoff does not exist', 404);
    const recall = await this.phase7.findRecallIfExists(handoff.id);
    const dossier = await this.phase7.findDossierById(handoff.dossier_id);
    const verification = await this.phase7.findVerification(dossier.record.id);
    return { found, handoff, recall, dossier, verification };
  }

  async recordPolicy(input: { manifest: ActivationExecutionPolicyManifest; phase7: Phase7ExecutionState }) {
    const validation = validateActivationExecutionPolicy(input.manifest, {
      phase7: input.phase7.found.manifest,
      handoff: input.phase7.handoff,
      phase6: input.phase7.found.phase6.manifest,
      phase5: input.phase7.found.phase6.phase5.manifest,
      g7: input.phase7.found.phase6.phase5.g7.manifest,
      g6: input.phase7.found.phase6.phase5.g7.g6.manifest,
    });
    if (!validation.ok || !validation.value || !validation.fingerprint) throw new ActivationExecutionError('invalid_activation_execution_policy', validation.issues.join('; '), 400);
    const manifest = validation.value;
    const policyFingerprint = validation.fingerprint;
    return this.knex.transaction(async (trx) => {
      await this.lockCeremonySnapshot(trx, input.phase7);
      const existing = await trx<ActivationExecutionPolicyRecord>(PHASE8_TABLES.policies).where({ policy_id: manifest.policy_id }).first();
      if (existing) {
        const normalized = normalizePolicy(existing, input.phase7);
        if (normalized.record.policy_fingerprint !== policyFingerprint) throw new ActivationExecutionError('activation_execution_policy_conflict', 'policy ID already binds different evidence');
        return normalized.record;
      }
      const existingHandoffPolicy = await trx<ActivationExecutionPolicyRecord>(PHASE8_TABLES.policies)
        .where({ phase7_handoff_id: input.phase7.handoff.id })
        .first();
      if (existingHandoffPolicy) {
        throw new ActivationExecutionError(
          'phase7_handoff_already_bound',
          'Phase 7 handoff already has an activation-execution policy',
        );
      }
      const record: ActivationExecutionPolicyRecord = {
        id: this.uuid(),
        tenant_id: manifest.tenant_id,
        source_connection_id: manifest.source_connection_id,
        phase7_policy_record_id: input.phase7.found.record.id,
        phase7_handoff_id: input.phase7.handoff.id,
        policy_id: manifest.policy_id,
        environment: manifest.environment,
        phase7_policy_fingerprint: manifest.phase7.policy_fingerprint,
        phase7_handoff_fingerprint: manifest.phase7.handoff_fingerprint,
        target_fingerprint: manifest.target.target_fingerprint,
        adapter_id: manifest.target.adapter_id,
        adapter_version: manifest.target.adapter_version,
        valid_from: actionIso(manifest.valid_from),
        valid_until: actionIso(manifest.valid_until),
        policy_fingerprint: policyFingerprint,
        manifest_json: canonicalStringify(manifest),
        accepted_at: actionIso(manifest.approved_at),
        created_at: actionIso(manifest.approved_at),
      };
      await trx(PHASE8_TABLES.policies).insert(record);
      await this.appendKillSwitch(trx, record, 'engaged', manifest.approved_by, 'phase8_initial_kill_switch_engaged', record.policy_fingerprint, record.accepted_at);
      await this.appendEvent(trx, record, 'policy_accepted', manifest.approved_by, 'phase8_policy_accepted', record.policy_fingerprint, record.accepted_at);
      return normalizePolicy(await trx<ActivationExecutionPolicyRecord>(PHASE8_TABLES.policies).where({ id: record.id }).first(), input.phase7).record;
    });
  }

  async findPolicy(policyId: string) {
    const row = await this.knex<ActivationExecutionPolicyRecord>(PHASE8_TABLES.policies).where({ policy_id: policyId }).first();
    if (!row) throw new ActivationExecutionError('missing_activation_execution_policy', 'activation-execution policy does not exist', 404);
    const phase7Row = await this.knex<ActivationCeremonyPolicyRecord>(PHASE7_TABLES.policies).where({ id: row.phase7_policy_record_id }).first();
    if (!phase7Row) throw new ActivationExecutionError('corrupt_activation_execution_policy', 'bound Phase 7 policy is missing');
    const phase7 = await this.findPhase7State(phase7Row.policy_id);
    return { ...normalizePolicy(row, phase7), phase7 };
  }

  async recordPreview(input: {
    policy: ActivationExecutionPolicyRecord;
    manifest: ActivationExecutionPolicyManifest;
    phase7: Phase7ExecutionState;
    previewKey: string;
    preview: ActivationAdapterPreview;
    requestedBy: string;
    recordedAt: string;
  }) {
    if (
      input.policy.policy_id !== input.manifest.policy_id
      || input.policy.phase7_handoff_id !== input.phase7.handoff.id
    ) throw new ActivationExecutionError('activation_preview_policy_mismatch', 'preview inputs do not bind the same policy and handoff');
    const previewKey = actionIdempotencyKey(input.previewKey);
    const preview = validateActivationAdapterPreview(input.preview, input.manifest, input.recordedAt);
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      await this.lockCeremonySnapshot(trx, input.phase7);
      const existing = await trx<ActivationPreviewRecord>(PHASE8_TABLES.previews).where({ policy_record_id: input.policy.id }).first();
      if (existing) {
        const normalized = normalizePreview(existing, input.manifest);
        if (normalized.record.preview_key !== previewKey || normalized.record.preview_fingerprint !== activationExecutionFingerprint(preview)) throw new ActivationExecutionError('activation_preview_conflict', 'policy already has a different preview');
        return normalized.record;
      }
      const record: ActivationPreviewRecord = {
        id: this.uuid(), tenant_id: input.policy.tenant_id, policy_record_id: input.policy.id,
        preview_key: previewKey, adapter_id: input.manifest.target.adapter_id,
        adapter_version: input.manifest.target.adapter_version, preview_json: canonicalStringify(preview),
        preview_fingerprint: activationExecutionFingerprint(preview),
        requested_by: actionActor(input.requestedBy, 'invalid_activation_execution_actor'),
        recorded_at: actionIso(input.recordedAt), created_at: actionIso(input.recordedAt),
      };
      await trx(PHASE8_TABLES.previews).insert(record);
      await this.appendEvent(trx, input.policy, 'preview_recorded', record.requested_by, 'phase8_zero_mutation_preview_recorded', record.preview_fingerprint, record.recorded_at);
      return normalizePreview(await trx<ActivationPreviewRecord>(PHASE8_TABLES.previews).where({ id: record.id }).first(), input.manifest).record;
    });
  }

  async findPreview(policyRecordId: string, manifest: ActivationExecutionPolicyManifest) {
    return normalizePreview(await this.knex<ActivationPreviewRecord>(PHASE8_TABLES.previews).where({ policy_record_id: policyRecordId }).first(), manifest);
  }

  async findPreviewIfExists(policyRecordId: string, manifest: ActivationExecutionPolicyManifest) {
    const row = await this.knex<ActivationPreviewRecord>(PHASE8_TABLES.previews).where({ policy_record_id: policyRecordId }).first();
    return row ? normalizePreview(row, manifest) : null;
  }

  async recordRelease(input: {
    policy: ActivationExecutionPolicyRecord;
    phase7: Phase7ExecutionState;
    preview: ActivationPreviewRecord;
    releaseKey: string;
    releasedBy: string;
    observedBy: string;
    reasonCode: string;
    releasedAt: string;
    expiresAt: string;
  }) {
    if (
      input.preview.policy_record_id !== input.policy.id
      || input.phase7.handoff.id !== input.policy.phase7_handoff_id
    ) throw new ActivationExecutionError('activation_release_policy_mismatch', 'release inputs do not bind the same policy, preview, and handoff');
    if (Date.parse(input.expiresAt) <= Date.parse(input.releasedAt)) {
      throw new ActivationExecutionError('activation_release_window_closed', 'release expiry must follow release time');
    }
    const releaseKey = actionIdempotencyKey(input.releaseKey);
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      await this.lockCeremonySnapshot(trx, input.phase7);
      const existing = await trx<ActivationReleaseRecord>(PHASE8_TABLES.releases).where({ policy_record_id: input.policy.id }).first();
      if (existing) {
        const normalized = normalizeRelease(existing);
        if (normalized.release_key !== releaseKey || normalized.preview_id !== input.preview.id || normalized.reason_code !== input.reasonCode) throw new ActivationExecutionError('activation_release_conflict', 'policy already has a different release');
        return normalized;
      }
      const kill = await trx<ActivationKillSwitchEventRecord>(PHASE8_TABLES.killSwitchEvents).where({ policy_record_id: input.policy.id }).orderBy('sequence', 'desc').first();
      if (!kill || normalizeKill(kill).state !== 'engaged') throw new ActivationExecutionError('activation_kill_switch_not_engaged', 'release requires the kill switch to start engaged');
      const core = {
        tenant_id: input.policy.tenant_id, policy_record_id: input.policy.id, preview_id: input.preview.id,
        release_key: releaseKey, preview_fingerprint: input.preview.preview_fingerprint,
        released_by: actionActor(input.releasedBy, 'invalid_activation_execution_actor'),
        observed_by: actionActor(input.observedBy, 'invalid_activation_execution_actor'),
        reason_code: actionCode(input.reasonCode, 'invalid_activation_execution_reason'),
        released_at: actionIso(input.releasedAt), expires_at: actionIso(input.expiresAt),
      };
      const record: ActivationReleaseRecord = { id: this.uuid(), ...core, release_fingerprint: activationExecutionFingerprint(core), created_at: core.released_at };
      await trx(PHASE8_TABLES.releases).insert(record);
      await this.appendKillSwitch(trx, input.policy, 'released', record.released_by, 'phase8_dual_credential_release', record.release_fingerprint, record.released_at);
      await this.appendEvent(trx, input.policy, 'activation_released', record.released_by, record.reason_code, record.release_fingerprint, record.released_at);
      return normalizeRelease(await trx<ActivationReleaseRecord>(PHASE8_TABLES.releases).where({ id: record.id }).first());
    });
  }

  async findReleaseIfExists(policyRecordId: string) {
    const row = await this.knex<ActivationReleaseRecord>(PHASE8_TABLES.releases).where({ policy_record_id: policyRecordId }).first();
    return row ? normalizeRelease(row) : null;
  }

  async recordClaim(input: {
    policy: ActivationExecutionPolicyRecord;
    phase7: Phase7ExecutionState;
    release: ActivationReleaseRecord;
    preview: ActivationPreviewRecord;
    activationKey: string;
    claimedBy: string;
    claimedAt: string;
    leaseExpiresAt: string;
  }) {
    if (
      input.release.policy_record_id !== input.policy.id
      || input.preview.policy_record_id !== input.policy.id
      || input.release.preview_id !== input.preview.id
      || input.release.preview_fingerprint !== input.preview.preview_fingerprint
      || input.phase7.handoff.id !== input.policy.phase7_handoff_id
    ) throw new ActivationExecutionError('activation_claim_policy_mismatch', 'claim inputs do not bind the same policy, release, preview, and handoff');
    if (Date.parse(input.release.expires_at) <= Date.parse(input.claimedAt)) {
      throw new ActivationExecutionError('activation_release_expired', 'activation release expired before the claim');
    }
    const activationKey = actionIdempotencyKey(input.activationKey);
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      await this.lockCeremonySnapshot(trx, input.phase7);
      const existing = await trx<ActivationClaimRecord>(PHASE8_TABLES.claims).where({ policy_record_id: input.policy.id }).first();
      if (existing) {
        const normalized = normalizeClaim(existing);
        if (normalized.activation_key !== activationKey) throw new ActivationExecutionError('activation_already_claimed', 'policy already has its one activation claim');
        return { record: normalized, created: false as const };
      }
      const kill = await trx<ActivationKillSwitchEventRecord>(PHASE8_TABLES.killSwitchEvents).where({ policy_record_id: input.policy.id }).orderBy('sequence', 'desc').first();
      if (!kill || normalizeKill(kill).state !== 'released') throw new ActivationExecutionError('activation_kill_switch_engaged', 'kill switch is engaged');
      const core = {
        tenant_id: input.policy.tenant_id, policy_record_id: input.policy.id,
        release_id: input.release.id, preview_id: input.preview.id, activation_key: activationKey,
        release_fingerprint: input.release.release_fingerprint, preview_fingerprint: input.preview.preview_fingerprint,
        claimed_by: actionActor(input.claimedBy, 'invalid_activation_execution_actor'),
        claimed_at: actionIso(input.claimedAt), lease_expires_at: actionIso(input.leaseExpiresAt),
      };
      const record: ActivationClaimRecord = { id: this.uuid(), ...core, claim_fingerprint: activationExecutionFingerprint(core), created_at: core.claimed_at };
      await trx(PHASE8_TABLES.claims).insert(record);
      await this.appendEvent(trx, input.policy, 'activation_claimed', record.claimed_by, 'phase8_single_activation_claimed', record.claim_fingerprint, record.claimed_at);
      return {
        record: normalizeClaim(await trx<ActivationClaimRecord>(PHASE8_TABLES.claims).where({ id: record.id }).first()),
        created: true as const,
      };
    });
  }

  async findClaimIfExists(policyRecordId: string) {
    const row = await this.knex<ActivationClaimRecord>(PHASE8_TABLES.claims).where({ policy_record_id: policyRecordId }).first();
    return row ? normalizeClaim(row) : null;
  }

  async recordOutcome(input: {
    policy: ActivationExecutionPolicyRecord;
    manifest: ActivationExecutionPolicyManifest;
    claim: ActivationClaimRecord;
    result: ActivationAdapterResult;
    actor: string;
    recordedAt: string;
  }) {
    const result = validateActivationAdapterResult(input.result, input.manifest);
    if (input.claim.policy_record_id !== input.policy.id) {
      throw new ActivationExecutionError('activation_outcome_policy_mismatch', 'outcome claim does not bind the policy');
    }
    if (result.activation_idempotency_key !== input.claim.activation_key) {
      throw new ActivationExecutionError(
        'activation_result_key_mismatch',
        'activation result does not bind the claimed idempotency key',
      );
    }
    if (
      Date.parse(result.completed_at) < Date.parse(input.claim.claimed_at)
      || Date.parse(result.completed_at) > Date.parse(input.recordedAt)
    ) throw new ActivationExecutionError('activation_outcome_time_mismatch', 'activation result timestamp is outside the claim window');
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      const existing = await trx<ActivationOutcomeRecord>(PHASE8_TABLES.outcomes).where({ claim_id: input.claim.id }).first();
      if (existing) {
        const normalized = normalizeOutcome(existing, input.manifest);
        if (normalized.record.result_fingerprint !== activationExecutionFingerprint(result)) throw new ActivationExecutionError('activation_outcome_conflict', 'claim already has a different terminal outcome');
        return normalized.record;
      }
      const core = {
        tenant_id: input.policy.tenant_id, policy_record_id: input.policy.id, claim_id: input.claim.id,
        outcome: result.outcome, result_json: canonicalStringify(result),
        result_fingerprint: activationExecutionFingerprint(result), recorded_at: actionIso(input.recordedAt),
      };
      const record: ActivationOutcomeRecord = { id: this.uuid(), ...core, outcome_fingerprint: activationExecutionFingerprint(core), created_at: core.recorded_at };
      await trx(PHASE8_TABLES.outcomes).insert(record);
      const actor = actionActor(input.actor, 'invalid_activation_execution_actor');
      await this.appendKillSwitch(trx, input.policy, 'engaged', actor, result.outcome === 'succeeded' ? 'phase8_activation_attempt_consumed' : `phase8_activation_${result.outcome}`, record.outcome_fingerprint, record.recorded_at);
      if (result.outcome !== 'succeeded') await this.appendIncident(trx, input.policy, `phase8:activation:${input.claim.id}`, `activation_${result.outcome}`, record.outcome_fingerprint, actor, record.recorded_at);
      await this.appendEvent(trx, input.policy, `activation_${result.outcome}`, actor, result.result_code, record.outcome_fingerprint, record.recorded_at);
      return normalizeOutcome(await trx<ActivationOutcomeRecord>(PHASE8_TABLES.outcomes).where({ id: record.id }).first(), input.manifest).record;
    });
  }

  async findOutcomeIfExists(policyRecordId: string, manifest: ActivationExecutionPolicyManifest) {
    const row = await this.knex<ActivationOutcomeRecord>(PHASE8_TABLES.outcomes).where({ policy_record_id: policyRecordId }).first();
    if (!row) return null;
    const normalized = normalizeOutcome(row, manifest);
    const claim = normalizeClaim(await this.knex<ActivationClaimRecord>(PHASE8_TABLES.claims)
      .where({ id: normalized.record.claim_id }).first());
    if (
      claim.policy_record_id !== policyRecordId
      || normalized.result.activation_idempotency_key !== claim.activation_key
      || Date.parse(normalized.result.completed_at) < Date.parse(claim.claimed_at)
      || Date.parse(normalized.result.completed_at) > Date.parse(normalized.record.recorded_at)
    ) throw new ActivationExecutionError('corrupt_activation_outcome', 'stored outcome does not bind its activation claim');
    return normalized;
  }

  async recordObservation(input: {
    policy: ActivationExecutionPolicyRecord;
    manifest: ActivationExecutionPolicyManifest;
    outcome: ActivationOutcomeRecord;
    activation: ActivationAdapterResult;
    observationKey: string;
    observation: ActivationAdapterObservation;
    observedBy: string;
    recordedAt: string;
  }) {
    const observationKey = actionIdempotencyKey(input.observationKey);
    const observation = validateActivationAdapterObservation(input.observation, input.manifest, input.activation);
    if (
      input.outcome.policy_record_id !== input.policy.id
      || input.outcome.result_fingerprint !== activationExecutionFingerprint(input.activation)
      || input.activation.outcome !== 'succeeded'
    ) throw new ActivationExecutionError('activation_observation_policy_mismatch', 'observation does not bind a successful outcome for this policy');
    if (
      Date.parse(observation.observed_at) < Date.parse(input.activation.completed_at)
      || Date.parse(observation.observed_at) > Date.parse(input.recordedAt)
    ) throw new ActivationExecutionError('activation_observation_time_mismatch', 'observation timestamp is outside the activation window');
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      const existing = await trx<ActivationObservationRecord>(PHASE8_TABLES.observations).where({ outcome_id: input.outcome.id }).first();
      if (existing) {
        const normalized = normalizeObservation(existing, input.manifest, input.activation);
        if (normalized.record.observation_key !== observationKey || normalized.record.observation_fingerprint !== activationExecutionFingerprint(observation)) throw new ActivationExecutionError('activation_observation_conflict', 'activation already has a different observation');
        return normalized.record;
      }
      const core = {
        tenant_id: input.policy.tenant_id, policy_record_id: input.policy.id, outcome_id: input.outcome.id,
        observation_key: observationKey, verdict: observation.verdict,
        observation_json: canonicalStringify(observation), observation_fingerprint: activationExecutionFingerprint(observation),
        observed_by: actionActor(input.observedBy, 'invalid_activation_execution_actor'), recorded_at: actionIso(input.recordedAt),
      };
      const record: ActivationObservationRecord = { id: this.uuid(), ...core, record_fingerprint: activationExecutionFingerprint(core), created_at: core.recorded_at };
      await trx(PHASE8_TABLES.observations).insert(record);
      if (observation.verdict !== 'healthy') await this.appendIncident(trx, input.policy, `phase8:observation:${input.outcome.id}`, `observation_${observation.verdict}`, record.record_fingerprint, record.observed_by, record.recorded_at);
      await this.appendEvent(trx, input.policy, `observation_${observation.verdict}`, record.observed_by, observation.result_code, record.record_fingerprint, record.recorded_at);
      return normalizeObservation(await trx<ActivationObservationRecord>(PHASE8_TABLES.observations).where({ id: record.id }).first(), input.manifest, input.activation).record;
    });
  }

  async findObservationIfExists(policyRecordId: string, manifest: ActivationExecutionPolicyManifest, activation: ActivationAdapterResult) {
    const row = await this.knex<ActivationObservationRecord>(PHASE8_TABLES.observations).where({ policy_record_id: policyRecordId }).first();
    return row ? normalizeObservation(row, manifest, activation) : null;
  }

  async recordRollback(input: {
    policy: ActivationExecutionPolicyRecord;
    manifest: ActivationExecutionPolicyManifest;
    outcome: ActivationOutcomeRecord;
    activation: ActivationAdapterResult;
    rollbackKey: string;
    rollback: ActivationAdapterRollback;
    authorizedBy: string;
    operatedBy: string;
    reasonCode: string;
    recordedAt: string;
  }) {
    const rollbackKey = actionIdempotencyKey(input.rollbackKey);
    const rollback = validateActivationAdapterRollback(input.rollback, input.manifest, input.activation);
    if (
      input.outcome.policy_record_id !== input.policy.id
      || input.outcome.result_fingerprint !== activationExecutionFingerprint(input.activation)
      || input.activation.outcome !== 'succeeded'
    ) throw new ActivationExecutionError('activation_rollback_policy_mismatch', 'rollback does not bind a successful outcome for this policy');
    if (
      Date.parse(rollback.completed_at) < Date.parse(input.activation.completed_at)
      || Date.parse(rollback.completed_at) > Date.parse(input.recordedAt)
    ) throw new ActivationExecutionError('activation_rollback_time_mismatch', 'rollback timestamp is outside the activation window');
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      const existing = await trx<ActivationRollbackRecord>(PHASE8_TABLES.rollbacks).where({ outcome_id: input.outcome.id }).first();
      if (existing) {
        const normalized = normalizeRollback(existing, input.manifest, input.activation);
        if (normalized.record.rollback_key !== rollbackKey || normalized.record.rollback_fingerprint !== activationExecutionFingerprint(rollback)) throw new ActivationExecutionError('activation_rollback_conflict', 'activation already has a different rollback');
        return normalized.record;
      }
      const core = {
        tenant_id: input.policy.tenant_id, policy_record_id: input.policy.id, outcome_id: input.outcome.id,
        rollback_key: rollbackKey, outcome: rollback.outcome, rollback_json: canonicalStringify(rollback),
        rollback_fingerprint: activationExecutionFingerprint(rollback),
        authorized_by: actionActor(input.authorizedBy, 'invalid_activation_execution_actor'),
        operated_by: actionActor(input.operatedBy, 'invalid_activation_execution_actor'),
        reason_code: actionCode(input.reasonCode, 'invalid_activation_execution_reason'), recorded_at: actionIso(input.recordedAt),
      };
      const record: ActivationRollbackRecord = { id: this.uuid(), ...core, record_fingerprint: activationExecutionFingerprint(core), created_at: core.recorded_at };
      await trx(PHASE8_TABLES.rollbacks).insert(record);
      if (rollback.outcome !== 'succeeded') await this.appendIncident(trx, input.policy, `phase8:rollback:${input.outcome.id}`, `rollback_${rollback.outcome}`, record.record_fingerprint, record.operated_by, record.recorded_at);
      await this.appendEvent(trx, input.policy, `rollback_${rollback.outcome}`, record.operated_by, record.reason_code, record.record_fingerprint, record.recorded_at);
      return normalizeRollback(await trx<ActivationRollbackRecord>(PHASE8_TABLES.rollbacks).where({ id: record.id }).first(), input.manifest, input.activation).record;
    });
  }

  async findRollbackIfExists(policyRecordId: string, manifest: ActivationExecutionPolicyManifest, activation: ActivationAdapterResult) {
    const row = await this.knex<ActivationRollbackRecord>(PHASE8_TABLES.rollbacks).where({ policy_record_id: policyRecordId }).first();
    return row ? normalizeRollback(row, manifest, activation) : null;
  }

  async latestKillSwitch(policyRecordId: string) {
    const row = await this.knex<ActivationKillSwitchEventRecord>(PHASE8_TABLES.killSwitchEvents).where({ policy_record_id: policyRecordId }).orderBy('sequence', 'desc').first();
    return row ? normalizeKill(row) : null;
  }

  async listIncidents(policyRecordId: string) {
    return (await this.knex<ActivationIncidentRecord>(PHASE8_TABLES.incidents).where({ policy_record_id: policyRecordId }).orderBy('opened_at', 'asc')).map(normalizeIncident);
  }

  async listEvents(policyRecordId: string) {
    return (await this.knex<ActivationExecutionEventRecord>(PHASE8_TABLES.events).where({ policy_record_id: policyRecordId }).orderBy('sequence', 'asc')).map(normalizeEvent);
  }

  private async lockPolicy(trx: Knex.Transaction, policyRecordId: string) {
    let query = trx<ActivationExecutionPolicyRecord>(PHASE8_TABLES.policies).where({ id: policyRecordId });
    const client = String(trx.client.config.client);
    if (client === 'pg' || client.includes('postgres')) query = query.forUpdate();
    if (!(await query.first())) throw new ActivationExecutionError('missing_activation_execution_policy', 'activation-execution policy does not exist', 404);
  }

  private async lockCeremonySnapshot(trx: Knex.Transaction, state: Phase7ExecutionState) {
    let p7Query = trx<ActivationCeremonyPolicyRecord>(PHASE7_TABLES.policies).where({ id: state.found.record.id });
    const client = String(trx.client.config.client);
    if (client === 'pg' || client.includes('postgres')) p7Query = p7Query.forUpdate();
    if (!(await p7Query.first())) throw new ActivationExecutionError('phase7_snapshot_changed', 'Phase 7 policy is missing');
    const handoff = await trx<ActivationCeremonyHandoffRecord>(PHASE7_TABLES.handoffs).where({ policy_record_id: state.found.record.id }).orderBy('sealed_at', 'desc').first();
    if (!handoff || handoff.id !== state.handoff.id || handoff.handoff_fingerprint !== state.handoff.handoff_fingerprint) throw new ActivationExecutionError('phase7_snapshot_changed', 'Phase 7 handoff changed');
    if (await trx(PHASE7_TABLES.recalls).where({ handoff_id: state.handoff.id }).first()) throw new ActivationExecutionError('phase7_handoff_recalled', 'Phase 7 handoff has been recalled');

    let p6Query = trx<ExternalEvidencePolicyRecord>(PHASE6_TABLES.policies).where({ id: state.found.record.phase6_policy_record_id });
    if (client === 'pg' || client.includes('postgres')) p6Query = p6Query.forUpdate();
    if (!(await p6Query.first())) throw new ActivationExecutionError('phase6_snapshot_changed', 'Phase 6 policy is missing');
    const assessment = await trx<ExternalEvidenceAssessmentRecord>(PHASE6_TABLES.assessments)
      .where({ policy_record_id: state.found.record.phase6_policy_record_id }).orderBy('assessed_at', 'desc').orderBy('created_at', 'desc').first();
    if (!assessment || assessment.assessment_fingerprint !== state.found.record.phase6_assessment_fingerprint || assessment.status !== 'complete_unreleased') throw new ActivationExecutionError('phase6_snapshot_changed', 'Phase 6 assessment changed');
    const facts = state.dossier.facts;
    const rows = await trx<ExternalEvidenceAttestationRecord>(PHASE6_TABLES.attestations)
      .where({ policy_record_id: state.found.record.phase6_policy_record_id }).orderBy('issued_at', 'desc').orderBy('created_at', 'desc');
    const latest = new Map<string, ExternalEvidenceAttestationRecord>();
    for (const row of rows) if (!latest.has(row.evidence_type)) latest.set(row.evidence_type, row);
    if (facts.evidence.length !== PHASE6_EVIDENCE_MATRIX.length) {
      throw new ActivationExecutionError('phase6_snapshot_changed', 'Phase 6 evidence matrix is incomplete');
    }
    for (const [index, evidence] of facts.evidence.entries()) {
      const expected = PHASE6_EVIDENCE_MATRIX[index];
      const current = latest.get(expected.evidence_type);
      if (!current || evidence.evidence_type !== expected.evidence_type || current.statement !== 'pass' || current.attestation_id !== evidence.attestation_id || current.envelope_fingerprint !== evidence.envelope_fingerprint) throw new ActivationExecutionError('phase6_snapshot_changed', 'Phase 6 evidence changed');
    }
  }

  private async appendKillSwitch(
    trx: Knex.Transaction,
    policy: ActivationExecutionPolicyRecord,
    state: 'engaged' | 'released',
    actor: string,
    reasonCode: string,
    evidenceFingerprint: string,
    occurredAt: string,
  ) {
    const previous = await trx<ActivationKillSwitchEventRecord>(PHASE8_TABLES.killSwitchEvents).where({ policy_record_id: policy.id }).orderBy('sequence', 'desc').first();
    const core = {
      tenant_id: policy.tenant_id, policy_record_id: policy.id, sequence: previous ? Number(previous.sequence) + 1 : 1,
      state, actor: actionActor(actor, 'invalid_activation_execution_actor'),
      reason_code: actionCode(reasonCode, 'invalid_activation_execution_reason'),
      evidence_fingerprint: actionHash(evidenceFingerprint, 'invalid_activation_execution_evidence'),
      occurred_at: actionIso(occurredAt),
    };
    const record: ActivationKillSwitchEventRecord = { id: this.uuid(), ...core, event_fingerprint: activationExecutionFingerprint(core), created_at: core.occurred_at };
    await trx(PHASE8_TABLES.killSwitchEvents).insert(record);
    return record;
  }

  private async appendIncident(
    trx: Knex.Transaction,
    policy: ActivationExecutionPolicyRecord,
    incidentKey: string,
    reasonCode: string,
    evidenceFingerprint: string,
    actor: string,
    openedAt: string,
  ) {
    const key = actionIdempotencyKey(incidentKey);
    const existing = await trx<ActivationIncidentRecord>(PHASE8_TABLES.incidents).where({ policy_record_id: policy.id, incident_key: key }).first();
    if (existing) return normalizeIncident(existing);
    const core = {
      tenant_id: policy.tenant_id, policy_record_id: policy.id, incident_key: key,
      reason_code: actionCode(reasonCode, 'invalid_activation_execution_reason'),
      evidence_fingerprint: actionHash(evidenceFingerprint, 'invalid_activation_execution_evidence'),
      opened_by: actionActor(actor, 'invalid_activation_execution_actor'), opened_at: actionIso(openedAt),
    };
    const record: ActivationIncidentRecord = { id: this.uuid(), ...core, incident_fingerprint: activationExecutionFingerprint(core), created_at: core.opened_at };
    await trx(PHASE8_TABLES.incidents).insert(record);
    await this.appendEvent(trx, policy, 'incident_opened', record.opened_by, record.reason_code, record.incident_fingerprint, record.opened_at);
    return record;
  }

  private async appendEvent(
    trx: Knex.Transaction,
    policy: ActivationExecutionPolicyRecord,
    eventType: ActivationExecutionEventType,
    actor: string,
    reasonCode: string,
    evidenceFingerprint: string,
    occurredAt: string,
  ) {
    const previous = await trx<ActivationExecutionEventRecord>(PHASE8_TABLES.events).where({ policy_record_id: policy.id }).orderBy('sequence', 'desc').first();
    const core = {
      tenant_id: policy.tenant_id, policy_record_id: policy.id, sequence: previous ? Number(previous.sequence) + 1 : 1,
      event_type: eventType, actor: actionActor(actor, 'invalid_activation_execution_actor'),
      reason_code: actionCode(reasonCode, 'invalid_activation_execution_reason'),
      evidence_fingerprint: actionHash(evidenceFingerprint, 'invalid_activation_execution_evidence'), occurred_at: actionIso(occurredAt),
    };
    const record: ActivationExecutionEventRecord = { id: this.uuid(), ...core, event_fingerprint: activationExecutionFingerprint(core), created_at: core.occurred_at };
    await trx(PHASE8_TABLES.events).insert(record);
    return record;
  }
}
