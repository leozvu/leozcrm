import { randomUUID } from 'node:crypto';
import type { Knex } from '../db/knex';
import {
  VOICE_SESSION_EVENT_SCHEMA,
  VOICE_SESSION_CONSENT_SCHEMA,
  VOICE_SESSION_REVIEW_SCHEMA,
  VOICE_QUALITY_SCHEMA,
  VOICE_PRIVACY_NOTICE_VERSION,
  VOICE_CAPABILITY_PROFILE,
  VOICE_SESSION_MODEL,
  VOICE_SESSION_SCHEMA,
  VOICE_SESSION_TABLES,
  VOICE_SESSION_VOICE,
  VoiceLocale,
  VoiceSessionConsentRecord,
  VoiceSessionError,
  VoiceSessionEventRecord,
  VoiceSessionEventType,
  VoiceSessionRecord,
  VoiceSessionReviewRecord,
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

function normalizeConsent(raw: VoiceSessionConsentRecord): VoiceSessionConsentRecord {
  const record: VoiceSessionConsentRecord = {
    ...raw,
    granted: Boolean(raw.granted) as true,
    granted_at: iso(raw.granted_at),
  };
  const { consent_fingerprint: fingerprint, ...core } = record;
  if (record.schema_version !== VOICE_SESSION_CONSENT_SCHEMA
    || record.privacy_notice_version !== VOICE_PRIVACY_NOTICE_VERSION
    || record.capability_profile !== VOICE_CAPABILITY_PROFILE
    || record.granted !== true
    || record.granted_by !== 'tenant_read_credential_holder'
    || voiceSessionHash(core) !== fingerprint) {
    throw new VoiceSessionError('corrupt_voice_evidence', 'stored voice consent fingerprint is invalid', 500);
  }
  return record;
}

function normalizeReview(raw: VoiceSessionReviewRecord): VoiceSessionReviewRecord {
  const record: VoiceSessionReviewRecord = {
    ...raw,
    privacy_concern: Boolean(raw.privacy_concern),
    reviewed_at: iso(raw.reviewed_at),
  };
  const { review_fingerprint: fingerprint, ...core } = record;
  if (record.schema_version !== VOICE_SESSION_REVIEW_SCHEMA
    || !['useful', 'not_useful'].includes(record.rating)
    || voiceSessionHash(core) !== fingerprint) {
    throw new VoiceSessionError('corrupt_voice_evidence', 'stored voice review fingerprint is invalid', 500);
  }
  return record;
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function rate(numerator: number, denominator: number): number | null {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function validateEventChain(events: VoiceSessionEventRecord[]): VoiceSessionState {
  return events.reduce<VoiceSessionState>((state, event, index) => {
    const next = voiceTransition(state, event.event_type);
    if (event.sequence !== index + 1 || event.from_state !== state || event.to_state !== next) {
      throw new VoiceSessionError('corrupt_voice_evidence', 'stored voice event chain is invalid', 500);
    }
    return next;
  }, 'authorizing');
}

export interface VoiceSessionViewRecord {
  session: VoiceSessionRecord;
  state: VoiceSessionState;
  events: VoiceSessionEventRecord[];
  consent: VoiceSessionConsentRecord;
  review: VoiceSessionReviewRecord | null;
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
    privacyNoticeVersion: typeof VOICE_PRIVACY_NOTICE_VERSION;
    capabilityProfile: typeof VOICE_CAPABILITY_PROFILE;
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
        const rawConsent = await trx<VoiceSessionConsentRecord>(VOICE_SESSION_TABLES.consents)
          .where({ tenant_id: input.tenantId, session_id: record.id }).first();
        if (!rawConsent || normalizeConsent(rawConsent).privacy_notice_version !== input.privacyNoticeVersion
          || normalizeConsent(rawConsent).capability_profile !== input.capabilityProfile) {
          throw new VoiceSessionError('corrupt_voice_evidence', 'voice session consent evidence is missing', 500);
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
      const consentCore = {
        id: this.uuid(),
        tenant_id: input.tenantId,
        session_id: record.id,
        schema_version: VOICE_SESSION_CONSENT_SCHEMA,
        privacy_notice_version: input.privacyNoticeVersion,
        capability_profile: input.capabilityProfile,
        granted: true as const,
        granted_by: 'tenant_read_credential_holder' as const,
        granted_at: createdAt,
      };
      await trx(VOICE_SESSION_TABLES.consents).insert({
        ...consentCore,
        consent_fingerprint: voiceSessionHash(consentCore),
      });
      return { record, replayed: false };
    });
  }

  async view(tenantId: string, sessionId: string): Promise<VoiceSessionViewRecord> {
    const raw = await this.knex<VoiceSessionRecord>(VOICE_SESSION_TABLES.sessions)
      .where({ tenant_id: tenantId, id: sessionId }).first();
    if (!raw) throw new VoiceSessionError('voice_session_not_found', 'voice session was not found', 404);
    const session = normalizeSession(raw);
    const [eventRows, consentRaw, reviewRaw] = await Promise.all([
      this.knex<VoiceSessionEventRecord>(VOICE_SESSION_TABLES.events)
        .where({ tenant_id: tenantId, session_id: sessionId }).orderBy('sequence', 'asc'),
      this.knex<VoiceSessionConsentRecord>(VOICE_SESSION_TABLES.consents)
        .where({ tenant_id: tenantId, session_id: sessionId }).first(),
      this.knex<VoiceSessionReviewRecord>(VOICE_SESSION_TABLES.reviews)
        .where({ tenant_id: tenantId, session_id: sessionId }).first(),
    ]);
    if (!consentRaw) throw new VoiceSessionError('corrupt_voice_evidence', 'voice session consent evidence is missing', 500);
    const events = eventRows.map(normalizeEvent);
    const state = validateEventChain(events);
    return {
      session,
      state,
      events,
      consent: normalizeConsent(consentRaw),
      review: reviewRaw ? normalizeReview(reviewRaw) : null,
    };
  }

  async review(input: {
    tenantId: string;
    sessionId: string;
    idempotencyKey: string;
    rating: 'useful' | 'not_useful';
    privacyConcern: boolean;
  }): Promise<{ record: VoiceSessionReviewRecord; replayed: boolean }> {
    assertVoiceIdempotencyKey(input.idempotencyKey);
    return this.knex.transaction(async (trx) => {
      let sessionQuery = trx<VoiceSessionRecord>(VOICE_SESSION_TABLES.sessions)
        .where({ tenant_id: input.tenantId, id: input.sessionId });
      if (postgres(this.knex)) sessionQuery = sessionQuery.forUpdate();
      const sessionRaw = await sessionQuery.first();
      if (!sessionRaw) throw new VoiceSessionError('voice_session_not_found', 'voice session was not found', 404);
      const session = normalizeSession(sessionRaw);
      const events = (await trx<VoiceSessionEventRecord>(VOICE_SESSION_TABLES.events)
        .where({ tenant_id: input.tenantId, session_id: input.sessionId }).orderBy('sequence', 'asc'))
        .map(normalizeEvent);
      const state = validateEventChain(events);
      if (state !== 'ended' && state !== 'failed') {
        throw new VoiceSessionError('voice_review_requires_terminal_session', 'end the voice session before reviewing it', 409);
      }
      const requestHash = voiceSessionHash({ rating: input.rating, privacy_concern: input.privacyConcern });
      const replayRaw = await trx<VoiceSessionReviewRecord>(VOICE_SESSION_TABLES.reviews)
        .where({ tenant_id: input.tenantId, session_id: input.sessionId }).first();
      if (replayRaw) {
        const record = normalizeReview(replayRaw);
        if (record.request_hash !== requestHash || record.idempotency_key !== input.idempotencyKey) {
          throw new VoiceSessionError('voice_review_conflict', 'voice session already has a different review', 409);
        }
        return { record, replayed: true };
      }
      const reviewedAt = this.clock().toISOString();
      const core = {
        id: this.uuid(),
        tenant_id: input.tenantId,
        session_id: input.sessionId,
        schema_version: VOICE_SESSION_REVIEW_SCHEMA,
        idempotency_key: input.idempotencyKey,
        request_hash: requestHash,
        rating: input.rating,
        privacy_concern: input.privacyConcern,
        session_fingerprint: session.session_fingerprint,
        event_chain_hash: voiceSessionHash(events.map((event) => event.event_fingerprint)),
        reviewed_at: reviewedAt,
      };
      const record: VoiceSessionReviewRecord = { ...core, review_fingerprint: voiceSessionHash(core) };
      await trx(VOICE_SESSION_TABLES.reviews).insert(record);
      return { record, replayed: false };
    });
  }

  async quality(tenantId: string, days = 30) {
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw new VoiceSessionError('invalid_voice_quality_window', 'voice quality window must be 1 to 90 whole days');
    }
    const generatedAt = this.clock().toISOString();
    const from = new Date(this.clock().getTime() - days * 86_400_000).toISOString();
    const sessions = (await this.knex<VoiceSessionRecord>(VOICE_SESSION_TABLES.sessions)
      .where({ tenant_id: tenantId }).andWhere('created_at', '>=', from)).map(normalizeSession);
    const ids = sessions.map((session) => session.id);
    const events = ids.length ? (await this.knex<VoiceSessionEventRecord>(VOICE_SESSION_TABLES.events)
      .where({ tenant_id: tenantId }).whereIn('session_id', ids)
      .orderBy('session_id', 'asc').orderBy('sequence', 'asc')).map(normalizeEvent) : [];
    const reviews = ids.length ? (await this.knex<VoiceSessionReviewRecord>(VOICE_SESSION_TABLES.reviews)
      .where({ tenant_id: tenantId }).whereIn('session_id', ids)).map(normalizeReview) : [];
    const bySession = new Map<string, VoiceSessionEventRecord[]>();
    events.forEach((event) => bySession.set(event.session_id, [...(bySession.get(event.session_id) ?? []), event]));
    sessions.forEach((session) => validateEventChain(bySession.get(session.id) ?? []));
    const connected = sessions.filter((session) => bySession.get(session.id)?.some((event) => event.event_type === 'connected')).length;
    const failed = sessions.filter((session) => bySession.get(session.id)?.some((event) => event.to_state === 'failed')).length;
    const ended = sessions.filter((session) => bySession.get(session.id)?.some((event) => event.to_state === 'ended')).length;
    const turns = events.filter((event) => event.event_type === 'user_turn_committed');
    const groundingStarted = events.filter((event) => event.event_type === 'advisor_grounding_started').length;
    const groundingCompleted = events.filter((event) => event.event_type === 'advisor_grounding_completed'
      && event.source === 'server').length;
    const groundingFailed = events.filter((event) => event.event_type === 'advisor_grounding_failed').length;
    const audibleResponses = events.filter((event) => event.event_type === 'assistant_response_started').length;
    const interruptions = events.filter((event) => event.event_type === 'user_turn_started'
      && (event.from_state === 'speaking' || event.from_state === 'thinking')).length;
    const connectLatencies: number[] = [];
    const responseLatencies: number[] = [];
    sessions.forEach((session) => {
      const chain = bySession.get(session.id) ?? [];
      const credential = chain.find((event) => event.event_type === 'credential_issued');
      const connection = chain.find((event) => event.event_type === 'connected');
      if (credential && connection) connectLatencies.push(Date.parse(connection.occurred_at) - Date.parse(credential.occurred_at));
      chain.forEach((event, index) => {
        if (event.event_type !== 'user_turn_committed') return;
        const response = chain.slice(index + 1).find((candidate) => candidate.event_type === 'assistant_response_started');
        if (response) responseLatencies.push(Date.parse(response.occurred_at) - Date.parse(event.occurred_at));
      });
    });
    const useful = reviews.filter((review) => review.rating === 'useful').length;
    const privacyConcerns = reviews.filter((review) => review.privacy_concern).length;
    const connectSuccessRate = rate(connected, sessions.length);
    // Client-declared starts are useful telemetry, but only server-attested
    // completions prove grounding. Candidate coverage is therefore measured
    // against committed turns and also requires a one-to-one event shape.
    const groundingSuccessRate = rate(groundingCompleted, turns.length);
    const audibleResponseRate = rate(audibleResponses, turns.length);
    const usefulRate = rate(useful, reviews.length);
    const minimumSample = sessions.length >= 5 && turns.length >= 10 && reviews.length >= 5;
    const meetsThresholds = minimumSample
      && (connectSuccessRate ?? 0) >= 0.95
      && (groundingSuccessRate ?? 0) >= 0.95
      && (audibleResponseRate ?? 0) >= 0.95
      && (usefulRate ?? 0) >= 0.8
      && groundingStarted === turns.length
      && groundingCompleted === turns.length
      && groundingFailed === 0
      && audibleResponses === turns.length
      && interruptions >= 1
      && privacyConcerns === 0
      && failed === 0
      && percentile(responseLatencies, 0.95) <= 10_000;
    const quality = {
      schema_version: VOICE_QUALITY_SCHEMA,
      generated_at: generatedAt,
      window: { days, from, to: generatedAt },
      candidate_status: !minimumSample ? 'insufficient_sample' : meetsThresholds ? 'meets_candidate_thresholds' : 'blocked',
      live_acceptance: 'not_inferred',
      sessions: {
        requested: sessions.length,
        openai_realtime: sessions.filter((session) => session.provider === 'openai_realtime').length,
        connected,
        ended,
        failed,
        connect_success_rate: connectSuccessRate,
        connect_latency_p95_ms: percentile(connectLatencies, 0.95),
      },
      turns: {
        committed: turns.length,
        grounding_started: groundingStarted,
        grounding_completed: groundingCompleted,
        grounding_failed: groundingFailed,
        grounding_success_rate: groundingSuccessRate,
        audible_responses: audibleResponses,
        audible_response_rate: audibleResponseRate,
        response_latency_p95_ms: percentile(responseLatencies, 0.95),
        interruptions,
      },
      reviews: { reviewed: reviews.length, useful, useful_rate: usefulRate, privacy_concerns: privacyConcerns },
      thresholds: {
        sessions_minimum: 5,
        turns_minimum: 10,
        reviews_minimum: 5,
        connect_success_rate_minimum: 0.95,
        grounding_success_rate_minimum: 0.95,
        audible_response_rate_minimum: 0.95,
        useful_rate_minimum: 0.8,
        interruptions_minimum: 1,
        response_latency_p95_ms_maximum: 10_000,
        privacy_concerns_maximum: 0,
        failed_sessions_maximum: 0,
      },
      privacy: {
        notice_version: VOICE_PRIVACY_NOTICE_VERSION,
        raw_audio_retention: 'none',
        transcript_retention: 'none',
        device_or_user_agent_retention: 'none',
      },
      limitation: 'Repository voice evidence and CEO feedback do not prove named-deployment or production acceptance.',
    };
    return { ...quality, quality_hash: voiceSessionHash(quality) };
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
