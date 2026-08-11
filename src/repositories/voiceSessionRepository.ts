import { randomUUID } from 'node:crypto';
import type { Knex } from '../db/knex';
import {
  VOICE_SESSION_EVENT_SCHEMA,
  VOICE_SESSION_MODEL,
  VOICE_SESSION_SCHEMA,
  VOICE_SESSION_TABLES,
  VOICE_SESSION_VOICE,
  VoiceLocale,
  VoiceSessionError,
  VoiceSessionEventRecord,
  VoiceSessionEventType,
  VoiceSessionRecord,
  VoiceSessionState,
  assertVoiceIdempotencyKey,
  voiceSessionHash,
  voiceTransition,
} from '../domain/voiceSession';

function postgres(knex: Knex): boolean {
  return String(knex.client.config.client).includes('pg');
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new VoiceSessionError('corrupt_voice_evidence', 'stored voice timestamp is invalid', 500);
  }
  return parsed.toISOString();
}

function normalizeSession(raw: VoiceSessionRecord): VoiceSessionRecord {
  const record: VoiceSessionRecord = {
    ...raw,
    created_at: iso(raw.created_at),
    session_deadline_at: iso(raw.session_deadline_at),
  };
  const { session_fingerprint: fingerprint, ...core } = record;
  if (record.schema_version !== VOICE_SESSION_SCHEMA
    || !['en', 'vi'].includes(record.locale)
    || !['disabled', 'openai_realtime'].includes(record.provider)
    || record.model !== VOICE_SESSION_MODEL
    || record.voice !== VOICE_SESSION_VOICE
    || record.transport !== 'webrtc'
    || record.action_authority !== 'none'
    || record.raw_audio_retention !== 'none'
    || Date.parse(record.session_deadline_at) <= Date.parse(record.created_at)
    || voiceSessionHash(core) !== fingerprint) {
    throw new VoiceSessionError('corrupt_voice_evidence', 'stored voice session fingerprint is invalid', 500);
  }
  return record;
}

function normalizeEvent(raw: VoiceSessionEventRecord): VoiceSessionEventRecord {
  const record: VoiceSessionEventRecord = {
    ...raw,
    sequence: Number(raw.sequence),
    occurred_at: iso(raw.occurred_at),
    provider_credential_expires_at: raw.provider_credential_expires_at
      ? iso(raw.provider_credential_expires_at) : null,
  };
  const { event_fingerprint: fingerprint, ...core } = record;
  if (record.schema_version !== VOICE_SESSION_EVENT_SCHEMA
    || !Number.isInteger(record.sequence) || record.sequence < 1
    || !['server', 'browser'].includes(record.source)
    || voiceSessionHash(core) !== fingerprint) {
    throw new VoiceSessionError('corrupt_voice_evidence', 'stored voice event fingerprint is invalid', 500);
  }
  return record;
}

export interface VoiceSessionViewRecord {
  session: VoiceSessionRecord;
  state: VoiceSessionState;
  events: VoiceSessionEventRecord[];
}

const SESSION_RATE_WINDOW_MS = 60_000;
const SESSION_RATE_LIMIT = 5;

export class VoiceSessionRepository {
  constructor(
    private readonly knex: Knex,
    private readonly clock: () => Date = () => new Date(),
    private readonly uuid: () => string = randomUUID,
  ) {}

  async create(input: {
    tenantId: string;
    locale: VoiceLocale;
    provider: 'disabled' | 'openai_realtime';
    idempotencyKey: string;
    requestHash: string;
  }): Promise<{ record: VoiceSessionRecord; replayed: boolean }> {
    assertVoiceIdempotencyKey(input.idempotencyKey);
    return this.knex.transaction(async (trx) => {
      if (postgres(this.knex)) await trx('tenants').where({ id: input.tenantId }).forUpdate().first();
      const replay = await trx<VoiceSessionRecord>(VOICE_SESSION_TABLES.sessions)
        .where({ tenant_id: input.tenantId, idempotency_key: input.idempotencyKey }).first();
      if (replay) {
        const record = normalizeSession(replay);
        if (record.request_hash !== input.requestHash) {
          throw new VoiceSessionError(
            'voice_session_idempotency_conflict',
            'Idempotency-Key binds a different voice session request',
            409,
          );
        }
        return { record, replayed: true };
      }
      const now = this.clock();
      const recent = await trx(VOICE_SESSION_TABLES.sessions)
        .where({ tenant_id: input.tenantId })
        .andWhere('created_at', '>=', new Date(now.getTime() - SESSION_RATE_WINDOW_MS).toISOString())
        .count<{ count: string | number }>({ count: 'id' })
        .first();
      if (Number(recent?.count ?? 0) >= SESSION_RATE_LIMIT) {
        throw new VoiceSessionError(
          'voice_session_rate_limited',
          'too many voice sessions were requested for this tenant',
          429,
        );
      }
      const createdAt = now.toISOString();
      const core = {
        id: this.uuid(),
        tenant_id: input.tenantId,
        schema_version: VOICE_SESSION_SCHEMA,
        idempotency_key: input.idempotencyKey,
        request_hash: input.requestHash,
        locale: input.locale,
        provider: input.provider,
        model: VOICE_SESSION_MODEL,
        voice: VOICE_SESSION_VOICE,
        transport: 'webrtc' as const,
        action_authority: 'none' as const,
        raw_audio_retention: 'none' as const,
        session_deadline_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
        created_at: createdAt,
      };
      const record: VoiceSessionRecord = { ...core, session_fingerprint: voiceSessionHash(core) };
      await trx(VOICE_SESSION_TABLES.sessions).insert(record);
      return { record, replayed: false };
    });
  }

  async view(tenantId: string, sessionId: string): Promise<VoiceSessionViewRecord> {
    const raw = await this.knex<VoiceSessionRecord>(VOICE_SESSION_TABLES.sessions)
      .where({ tenant_id: tenantId, id: sessionId }).first();
    if (!raw) throw new VoiceSessionError('voice_session_not_found', 'voice session was not found', 404);
    const session = normalizeSession(raw);
    const events = (await this.knex<VoiceSessionEventRecord>(VOICE_SESSION_TABLES.events)
      .where({ tenant_id: tenantId, session_id: sessionId }).orderBy('sequence', 'asc')).map(normalizeEvent);
    let state: VoiceSessionState = 'authorizing';
    events.forEach((event, index) => {
      if (event.sequence !== index + 1 || event.from_state !== state
        || voiceTransition(state, event.event_type) !== event.to_state) {
        throw new VoiceSessionError('corrupt_voice_evidence', 'stored voice event chain is invalid', 500);
      }
      state = event.to_state;
    });
    return { session, state, events };
  }

  async appendEvent(input: {
    tenantId: string;
    sessionId: string;
    eventKey: string;
    eventType: VoiceSessionEventType;
    source: 'server' | 'browser';
    providerCredentialExpiresAt?: string;
    failureCode?: string;
  }): Promise<{ record: VoiceSessionEventRecord; replayed: boolean; state: VoiceSessionState }> {
    assertVoiceIdempotencyKey(input.eventKey);
    return this.knex.transaction(async (trx) => {
      let sessionQuery = trx<VoiceSessionRecord>(VOICE_SESSION_TABLES.sessions)
        .where({ tenant_id: input.tenantId, id: input.sessionId });
      if (postgres(this.knex)) sessionQuery = sessionQuery.forUpdate();
      const sessionRaw = await sessionQuery.first();
      if (!sessionRaw) throw new VoiceSessionError('voice_session_not_found', 'voice session was not found', 404);
      normalizeSession(sessionRaw);
      const replayRaw = await trx<VoiceSessionEventRecord>(VOICE_SESSION_TABLES.events)
        .where({ tenant_id: input.tenantId, session_id: input.sessionId, event_key: input.eventKey }).first();
      if (replayRaw) {
        const record = normalizeEvent(replayRaw);
        if (record.event_type !== input.eventType || record.source !== input.source) {
          throw new VoiceSessionError('voice_event_idempotency_conflict', 'event key binds a different voice event', 409);
        }
        return { record, replayed: true, state: record.to_state };
      }
      const latestRaw = await trx<VoiceSessionEventRecord>(VOICE_SESSION_TABLES.events)
        .where({ tenant_id: input.tenantId, session_id: input.sessionId }).orderBy('sequence', 'desc').first();
      const latest = latestRaw ? normalizeEvent(latestRaw) : undefined;
      const fromState: VoiceSessionState = latest?.to_state ?? 'authorizing';
      const toState = voiceTransition(fromState, input.eventType);
      const core = {
        id: this.uuid(),
        tenant_id: input.tenantId,
        session_id: input.sessionId,
        schema_version: VOICE_SESSION_EVENT_SCHEMA,
        sequence: (latest?.sequence ?? 0) + 1,
        event_key: input.eventKey,
        event_type: input.eventType,
        source: input.source,
        from_state: fromState,
        to_state: toState,
        provider_credential_expires_at: input.providerCredentialExpiresAt ?? null,
        failure_code: input.failureCode ?? null,
        occurred_at: this.clock().toISOString(),
      };
      const record: VoiceSessionEventRecord = { ...core, event_fingerprint: voiceSessionHash(core) };
      await trx(VOICE_SESSION_TABLES.events).insert(record);
      return { record, replayed: false, state: toState };
    });
  }
}
