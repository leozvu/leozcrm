import { createHash } from 'node:crypto';
import { canonicalStringify } from './businessMemory';

export const VOICE_SESSION_SCHEMA = 'leozops_voice_session_v1' as const;
export const VOICE_SESSION_REQUEST_SCHEMA = 'leozops_voice_session_request_v2' as const;
export const VOICE_SESSION_EVENT_SCHEMA = 'leozops_voice_session_event_v1' as const;
export const VOICE_SESSION_CONSENT_SCHEMA = 'leozops_voice_session_consent_v1' as const;
export const VOICE_SESSION_REVIEW_SCHEMA = 'leozops_voice_session_review_v1' as const;
export const VOICE_QUALITY_SCHEMA = 'leozops_voice_quality_v1' as const;
export const VOICE_PRIVACY_NOTICE_VERSION = 'jarvis_voice_privacy_v1' as const;
export const VOICE_CAPABILITY_PROFILE = 'webrtc_audio_barge_in_v1' as const;
export const VOICE_SESSION_MODEL = 'gpt-realtime-2.1' as const;
export const VOICE_SESSION_VOICE = 'marin' as const;
export const VOICE_SESSION_TABLES = {
  sessions: 'jarvis_voice_sessions',
  events: 'jarvis_voice_session_events',
  consents: 'jarvis_voice_session_consents',
  reviews: 'jarvis_voice_session_reviews',
} as const;

export type VoiceLocale = 'en' | 'vi';
export type VoiceSessionState =
  | 'authorizing'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'ended'
  | 'failed';

export type VoiceClientEventType =
  | 'connected'
  | 'user_turn_started'
  | 'user_turn_committed'
  | 'assistant_response_started'
  | 'assistant_response_completed'
  | 'assistant_response_interrupted'
  | 'advisor_grounding_started'
  | 'advisor_grounding_failed'
  | 'action_request_blocked'
  | 'disconnected'
  | 'connection_failed';

export type VoiceServerEventType =
  | 'credential_issued'
  | 'credential_reissued'
  | 'advisor_grounding_completed'
  | 'provider_failed'
  | 'session_ended';

export type VoiceSessionEventType = VoiceClientEventType | VoiceServerEventType;

export interface VoiceSessionRequest {
  schema_version: typeof VOICE_SESSION_REQUEST_SCHEMA;
  locale: VoiceLocale;
  privacy_notice_version: typeof VOICE_PRIVACY_NOTICE_VERSION;
  consent: true;
  capability_profile: typeof VOICE_CAPABILITY_PROFILE;
}

export interface VoiceSessionReviewRequest {
  schema_version: typeof VOICE_SESSION_REVIEW_SCHEMA;
  rating: 'useful' | 'not_useful';
  privacy_concern: boolean;
}

export interface VoiceClientEventRequest {
  schema_version: typeof VOICE_SESSION_EVENT_SCHEMA;
  event_type: VoiceClientEventType;
  client_event_id: string;
}

export interface VoiceSessionRecord {
  id: string;
  tenant_id: string;
  schema_version: typeof VOICE_SESSION_SCHEMA;
  idempotency_key: string;
  request_hash: string;
  locale: VoiceLocale;
  provider: 'disabled' | 'openai_realtime';
  model: typeof VOICE_SESSION_MODEL;
  voice: typeof VOICE_SESSION_VOICE;
  transport: 'webrtc';
  action_authority: 'none';
  raw_audio_retention: 'none';
  session_deadline_at: string;
  session_fingerprint: string;
  created_at: string;
}

export interface VoiceSessionEventRecord {
  id: string;
  tenant_id: string;
  session_id: string;
  schema_version: typeof VOICE_SESSION_EVENT_SCHEMA;
  sequence: number;
  event_key: string;
  event_type: VoiceSessionEventType;
  source: 'server' | 'browser';
  from_state: VoiceSessionState;
  to_state: VoiceSessionState;
  provider_credential_expires_at: string | null;
  failure_code: string | null;
  occurred_at: string;
  event_fingerprint: string;
}

export interface VoiceSessionConsentRecord {
  id: string;
  tenant_id: string;
  session_id: string;
  schema_version: typeof VOICE_SESSION_CONSENT_SCHEMA;
  privacy_notice_version: typeof VOICE_PRIVACY_NOTICE_VERSION;
  capability_profile: typeof VOICE_CAPABILITY_PROFILE;
  granted: true;
  granted_by: 'tenant_read_credential_holder';
  granted_at: string;
  consent_fingerprint: string;
}

export interface VoiceSessionReviewRecord {
  id: string;
  tenant_id: string;
  session_id: string;
  schema_version: typeof VOICE_SESSION_REVIEW_SCHEMA;
  idempotency_key: string;
  request_hash: string;
  rating: 'useful' | 'not_useful';
  privacy_concern: boolean;
  session_fingerprint: string;
  event_chain_hash: string;
  reviewed_at: string;
  review_fingerprint: string;
}

export class VoiceSessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 404 | 409 | 429 | 500 | 502 | 503 | 504 = 400,
  ) {
    super(message);
    this.name = 'VoiceSessionError';
  }
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function object(raw: unknown, path: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new VoiceSessionError('invalid_voice_request', `${path} must be an object`);
  }
  return raw as Record<string, unknown>;
}

function exact(raw: Record<string, unknown>, fields: readonly string[], path: string): void {
  const actual = Object.keys(raw).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new VoiceSessionError('invalid_voice_request', `${path} has missing or unsupported fields`);
  }
}

export function voiceSessionHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

export function validateVoiceSessionRequest(raw: unknown): VoiceSessionRequest {
  const root = object(raw, 'voice_session');
  exact(root, [
    'schema_version', 'locale', 'privacy_notice_version', 'consent', 'capability_profile',
  ], 'voice_session');
  if (root.schema_version !== VOICE_SESSION_REQUEST_SCHEMA) {
    throw new VoiceSessionError('invalid_voice_request', `schema_version must equal ${VOICE_SESSION_REQUEST_SCHEMA}`);
  }
  if (root.locale !== 'en' && root.locale !== 'vi') {
    throw new VoiceSessionError('invalid_voice_request', 'voice_session.locale is unsupported');
  }
  if (root.privacy_notice_version !== VOICE_PRIVACY_NOTICE_VERSION || root.consent !== true) {
    throw new VoiceSessionError(
      'voice_privacy_consent_required',
      `explicit consent to ${VOICE_PRIVACY_NOTICE_VERSION} is required`,
    );
  }
  if (root.capability_profile !== VOICE_CAPABILITY_PROFILE) {
    throw new VoiceSessionError('voice_capability_unsupported', 'the secure voice capability profile is unsupported');
  }
  return {
    schema_version: VOICE_SESSION_REQUEST_SCHEMA,
    locale: root.locale,
    privacy_notice_version: VOICE_PRIVACY_NOTICE_VERSION,
    consent: true,
    capability_profile: VOICE_CAPABILITY_PROFILE,
  };
}

export function validateVoiceSessionReviewRequest(raw: unknown): VoiceSessionReviewRequest {
  const root = object(raw, 'voice_review');
  exact(root, ['schema_version', 'rating', 'privacy_concern'], 'voice_review');
  if (root.schema_version !== VOICE_SESSION_REVIEW_SCHEMA) {
    throw new VoiceSessionError('invalid_voice_review', `schema_version must equal ${VOICE_SESSION_REVIEW_SCHEMA}`);
  }
  if (root.rating !== 'useful' && root.rating !== 'not_useful') {
    throw new VoiceSessionError('invalid_voice_review', 'voice_review.rating is unsupported');
  }
  if (typeof root.privacy_concern !== 'boolean') {
    throw new VoiceSessionError('invalid_voice_review', 'voice_review.privacy_concern must be boolean');
  }
  return {
    schema_version: VOICE_SESSION_REVIEW_SCHEMA,
    rating: root.rating,
    privacy_concern: root.privacy_concern,
  };
}

export function validateVoiceClientEventRequest(raw: unknown): VoiceClientEventRequest {
  const root = object(raw, 'voice_event');
  exact(root, ['schema_version', 'event_type', 'client_event_id'], 'voice_event');
  if (root.schema_version !== VOICE_SESSION_EVENT_SCHEMA) {
    throw new VoiceSessionError('invalid_voice_request', `schema_version must equal ${VOICE_SESSION_EVENT_SCHEMA}`);
  }
  const allowed: VoiceClientEventType[] = [
    'connected',
    'user_turn_started',
    'user_turn_committed',
    'assistant_response_started',
    'assistant_response_completed',
    'assistant_response_interrupted',
    'advisor_grounding_started',
    'advisor_grounding_failed',
    'action_request_blocked',
    'disconnected',
    'connection_failed',
  ];
  if (!allowed.includes(root.event_type as VoiceClientEventType)) {
    throw new VoiceSessionError('invalid_voice_request', 'voice_event.event_type is unsupported');
  }
  if (typeof root.client_event_id !== 'string' || !SAFE_KEY.test(root.client_event_id)) {
    throw new VoiceSessionError('invalid_voice_request', 'voice_event.client_event_id is invalid');
  }
  return {
    schema_version: VOICE_SESSION_EVENT_SCHEMA,
    event_type: root.event_type as VoiceClientEventType,
    client_event_id: root.client_event_id,
  };
}

export function assertVoiceIdempotencyKey(value: string): string {
  if (!SAFE_KEY.test(value)) {
    throw new VoiceSessionError('invalid_idempotency_key', 'Idempotency-Key is invalid');
  }
  return value;
}

export function voiceTransition(
  state: VoiceSessionState,
  event: VoiceSessionEventType,
): VoiceSessionState {
  if (state === 'ended' || state === 'failed') {
    throw new VoiceSessionError('voice_session_terminal', 'voice session is already terminal', 409);
  }
  if (event === 'connection_failed' || event === 'provider_failed') return 'failed';
  if (event === 'disconnected' || event === 'session_ended') return 'ended';
  const transitions: Partial<Record<VoiceSessionState, Partial<Record<VoiceSessionEventType, VoiceSessionState>>>> = {
    authorizing: { credential_issued: 'connecting' },
    connecting: { credential_reissued: 'connecting', connected: 'listening' },
    listening: { user_turn_started: 'listening', user_turn_committed: 'thinking' },
    thinking: {
      user_turn_started: 'interrupted',
      assistant_response_started: 'speaking',
      advisor_grounding_started: 'thinking',
      advisor_grounding_completed: 'thinking',
      advisor_grounding_failed: 'thinking',
      action_request_blocked: 'thinking',
    },
    speaking: {
      user_turn_started: 'interrupted',
      assistant_response_completed: 'listening',
      assistant_response_interrupted: 'interrupted',
    },
    interrupted: {
      user_turn_started: 'interrupted',
      user_turn_committed: 'thinking',
      assistant_response_completed: 'listening',
    },
  };
  const next = transitions[state]?.[event];
  if (!next) {
    throw new VoiceSessionError(
      'invalid_voice_transition',
      `voice event ${event} is invalid while session is ${state}`,
      409,
    );
  }
  return next;
}

export function voiceSafetyIdentifier(tenantId: string): string {
  return createHash('sha256').update(`leozops-voice:${tenantId}`).digest('hex');
}
