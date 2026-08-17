import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { validateJarvisReleaseManifest } from './domain/jarvisRelease';
import { jarvisV1Hash } from './domain/jarvisV1';
import {
  VOICE_PRIVACY_NOTICE_VERSION,
  VOICE_QUALITY_SCHEMA,
  voiceSessionHash,
} from './domain/voiceSession';
import { inspectJarvisReleasePreflight } from './jarvisReleasePreflight';

dotenv.config();

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const JARVIS_CHECKPOINTS = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8'] as const;

export interface JarvisQualificationResult {
  ok: boolean;
  code: 'candidate_ready_for_ceo_acceptance' | 'blocked';
  issues: string[];
  target: { public_base_url: string; tenant_key: string; deployment_fingerprint: string };
  evidence: {
    migrations_current: boolean;
    cockpit_csp_present: boolean;
    voice_quality_hash: string | null;
    voice_candidate_status: string;
    voice_sessions: number;
    grounded_turns: number;
    voice_reviews: number;
    jarvis_readiness_hash: string | null;
    live_acceptance: 'not_inferred';
  };
}

function record(value: unknown): Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, any> : {};
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function evidenceHashMatches(value: Record<string, any>, field: string, hash: (core: unknown) => string): boolean {
  const expected = value[field];
  if (typeof expected !== 'string' || !SHA256.test(expected)) return false;
  const core = { ...value };
  delete core[field];
  return hash(core) === expected;
}

function voiceEvidenceIssues(quality: Record<string, any>): string[] {
  const issues: string[] = [];
  const sessions = record(quality.sessions);
  const turns = record(quality.turns);
  const reviews = record(quality.reviews);
  const thresholds = record(quality.thresholds);
  const privacy = record(quality.privacy);
  const counts = [
    sessions.requested,
    sessions.openai_realtime,
    sessions.connected,
    sessions.failed,
    turns.committed,
    turns.grounding_started,
    turns.grounding_completed,
    turns.grounding_failed,
    turns.audible_responses,
    turns.interruptions,
    reviews.reviewed,
    reviews.useful,
    reviews.privacy_concerns,
  ];

  if (!evidenceHashMatches(quality, 'quality_hash', voiceSessionHash)) {
    issues.push('voice quality evidence hash is invalid');
  }
  if (quality.candidate_status !== 'meets_candidate_thresholds') {
    issues.push('voice candidate thresholds are not met');
  }
  if (quality.live_acceptance !== 'not_inferred') {
    issues.push('voice quality response must not infer live acceptance');
  }
  if (!counts.every(nonNegativeInteger)) {
    issues.push('voice quality counters are invalid');
    return issues;
  }
  if (sessions.requested < 5 || turns.committed < 10 || reviews.reviewed < 5) {
    issues.push('voice evidence minimum sample is not met');
  }
  if (sessions.openai_realtime !== sessions.requested) {
    issues.push('voice session sample is not entirely OpenAI Realtime evidence');
  }
  if (sessions.requested === 0 || sessions.connected / sessions.requested < 0.95 || sessions.failed !== 0) {
    issues.push('voice connection evidence does not meet the candidate threshold');
  }
  if (turns.committed === 0
    || turns.grounding_started !== turns.committed
    || turns.grounding_completed !== turns.committed
    || turns.grounding_failed !== 0) {
    issues.push('voice grounding evidence is not one-to-one and failure-free');
  }
  if (turns.audible_responses !== turns.committed) {
    issues.push('voice audible-response evidence is not one-to-one');
  }
  if (turns.interruptions < 1) issues.push('voice interruption evidence is absent');
  if (!finiteNumber(turns.response_latency_p95_ms)
    || turns.response_latency_p95_ms < 0
    || turns.response_latency_p95_ms > 10_000) {
    issues.push('voice response latency evidence exceeds the candidate threshold');
  }
  if (reviews.reviewed === 0
    || reviews.useful > reviews.reviewed
    || reviews.useful / reviews.reviewed < 0.8) {
    issues.push('voice CEO usefulness evidence does not meet the candidate threshold');
  }
  if (reviews.privacy_concerns !== 0) issues.push('voice privacy concerns remain open');
  if (privacy.notice_version !== VOICE_PRIVACY_NOTICE_VERSION
    || privacy.raw_audio_retention !== 'none'
    || privacy.transcript_retention !== 'none'
    || privacy.device_or_user_agent_retention !== 'none') {
    issues.push('voice privacy evidence does not match the accepted contract');
  }
  const exactThresholds = {
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
  };
  if (Object.entries(exactThresholds).some(([key, value]) => thresholds[key] !== value)) {
    issues.push('voice quality thresholds do not match the accepted contract');
  }
  if (record(quality.window).days !== 30) issues.push('voice quality window is not the required 30 days');
  return issues;
}

function readinessEvidenceIssues(readiness: Record<string, any>, quality: Record<string, any>): string[] {
  const issues: string[] = [];
  const checkpoints = Array.isArray(readiness.checkpoints) ? readiness.checkpoints.map(record) : [];
  const checkpointNames = checkpoints.map((checkpoint) => checkpoint.checkpoint);
  const exactCheckpointSequence = checkpointNames.length === JARVIS_CHECKPOINTS.length
    && checkpointNames.every((checkpoint, index) => checkpoint === JARVIS_CHECKPOINTS[index]);

  if (!evidenceHashMatches(readiness, 'readiness_hash', jarvisV1Hash)) {
    issues.push('Jarvis readiness evidence hash is invalid');
  }
  if (readiness.overall !== 'blocked_external' || readiness.grants_action_authority !== false) {
    issues.push('Jarvis readiness safety boundary is invalid');
  }
  if (!exactCheckpointSequence || checkpoints.some((checkpoint) => (
    checkpoint.repository_candidate !== true
    || checkpoint.live_status !== 'blocked_external'
    || !Array.isArray(checkpoint.blockers)
    || checkpoint.blockers.length === 0
    || checkpoint.blockers.some((blocker: unknown) => typeof blocker !== 'string' || blocker.length === 0)
  ))) {
    issues.push('Jarvis readiness must expose exact blocked J1-J8 checkpoints');
  }
  if (readiness.voice_quality_hash !== quality.quality_hash
    || readiness.voice_candidate_status !== quality.candidate_status) {
    issues.push('Jarvis readiness is not bound to the verified voice evidence');
  }
  if (typeof readiness.evaluation_hash !== 'string' || !SHA256.test(readiness.evaluation_hash)) {
    issues.push('Jarvis evaluation evidence hash is invalid');
  }
  const truth = record(readiness.operator_truth);
  if (truth.external_action_registry_enabled_by_default !== false
    || truth.voice_action_authority !== 'none'
    || truth.raw_audio_or_transcript_retained !== false
    || truth.production_restore_proven !== false) {
    issues.push('Jarvis operator truth violates the release safety boundary');
  }
  return issues;
}

async function boundedFetch(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
  } finally { clearTimeout(timer); }
}

async function jsonResponse(fetchImpl: FetchLike, url: string, token?: string): Promise<{ response: Response; body: Record<string, any> }> {
  const response = await boundedFetch(fetchImpl, url, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : { Accept: 'application/json' },
  });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 1024 * 1024) throw new Error('qualification response exceeded limit');
  const text = await response.text();
  if (text.length > 1024 * 1024) throw new Error('qualification response exceeded limit');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('qualification response was not JSON'); }
  return { response, body: record(raw) };
}

export async function qualifyJarvisDeployment(input: {
  publicBaseUrl: string;
  tenantKey: string;
  readCredential: string;
  expectedDeploymentFingerprint: string;
}, fetchImpl: FetchLike = fetch): Promise<JarvisQualificationResult> {
  const origin = new URL(input.publicBaseUrl);
  if (origin.protocol !== 'https:' || origin.origin !== input.publicBaseUrl || origin.username || origin.password) {
    throw new Error('qualification target must be an exact credential-free HTTPS origin');
  }
  if (!/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(input.tenantKey)) throw new Error('tenant key is invalid');
  if (!input.readCredential || input.readCredential.length > 2048) throw new Error('read credential is invalid');
  if (!SHA256.test(input.expectedDeploymentFingerprint)) throw new Error('deployment fingerprint is invalid');
  const issues: string[] = [];
  const [startupResult, readyResult, qualityResult, readinessResult, cockpitResponse] = await Promise.all([
    jsonResponse(fetchImpl, `${origin.origin}/startup`),
    jsonResponse(fetchImpl, `${origin.origin}/ready`),
    jsonResponse(fetchImpl, `${origin.origin}/v1/tenants/${encodeURIComponent(input.tenantKey)}/jarvis/voice/quality?days=30`, input.readCredential),
    jsonResponse(fetchImpl, `${origin.origin}/v1/tenants/${encodeURIComponent(input.tenantKey)}/jarvis/readiness?days=30`, input.readCredential),
    boundedFetch(fetchImpl, `${origin.origin}/cockpit/`, { method: 'GET' }),
  ]);
  const startup = startupResult.body;
  const ready = readyResult.body;
  const quality = qualityResult.body;
  const readiness = readinessResult.body;
  if (!startupResult.response.ok || startup.ok !== true || startup.profile !== 'egoric-readonly') issues.push('startup probe is not the egoric-readonly runtime');
  if (startup.deployment_fingerprint !== input.expectedDeploymentFingerprint) issues.push('startup deployment fingerprint does not match the release');
  if (!readyResult.response.ok || ready.ok !== true || ready.checks?.migrations_current !== true) issues.push('database migrations are not current');
  if (!qualityResult.response.ok || quality.schema_version !== VOICE_QUALITY_SCHEMA) issues.push('voice quality evidence is unavailable or invalid');
  issues.push(...voiceEvidenceIssues(quality));
  if (!readinessResult.response.ok || readiness.schema_version !== 'leozops_jarvis_readiness_v1') issues.push('Jarvis readiness evidence is unavailable or invalid');
  issues.push(...readinessEvidenceIssues(readiness, quality));
  const csp = cockpitResponse.headers.get('content-security-policy') ?? '';
  if (!cockpitResponse.ok || !csp.includes("default-src 'none'")) issues.push('cockpit shell or Content Security Policy is unavailable');
  return {
    ok: issues.length === 0,
    code: issues.length === 0 ? 'candidate_ready_for_ceo_acceptance' : 'blocked',
    issues,
    target: {
      public_base_url: origin.origin,
      tenant_key: input.tenantKey,
      deployment_fingerprint: input.expectedDeploymentFingerprint,
    },
    evidence: {
      migrations_current: ready.checks?.migrations_current === true,
      cockpit_csp_present: csp.includes("default-src 'none'"),
      voice_quality_hash: typeof quality.quality_hash === 'string' ? quality.quality_hash : null,
      voice_candidate_status: typeof quality.candidate_status === 'string' ? quality.candidate_status : 'unavailable',
      voice_sessions: Number(quality.sessions?.requested ?? 0),
      grounded_turns: Number(quality.turns?.grounding_completed ?? 0),
      voice_reviews: Number(quality.reviews?.reviewed ?? 0),
      jarvis_readiness_hash: typeof readiness.readiness_hash === 'string' ? readiness.readiness_hash : null,
      live_acceptance: 'not_inferred',
    },
  };
}

async function main(): Promise<void> {
  const releasePath = process.env.LEOZOPS_JARVIS_RELEASE_MANIFEST;
  const livePath = process.env.LEOZOPS_LIVE_DEPLOYMENT_MANIFEST;
  const tenantKey = process.env.LEOZOPS_QUALIFICATION_TENANT_KEY;
  const readCredential = process.env.LEOZOPS_QUALIFICATION_READ_CREDENTIAL;
  if (!releasePath || !livePath || !tenantKey || !readCredential) throw new Error('qualification inputs are required');
  const releaseRaw = JSON.parse(fs.readFileSync(path.resolve(releasePath), 'utf8')) as unknown;
  const liveRaw = JSON.parse(fs.readFileSync(path.resolve(livePath), 'utf8')) as unknown;
  const preflight = inspectJarvisReleasePreflight(releaseRaw, liveRaw, process.env);
  const release = validateJarvisReleaseManifest(releaseRaw);
  if (!preflight.ok || !release.value) {
    console.log(JSON.stringify({ ok: false, code: 'blocked', issues: preflight.issues }, null, 2));
    process.exitCode = 2;
    return;
  }
  const result = await qualifyJarvisDeployment({
    publicBaseUrl: release.value.endpoint.public_base_url,
    tenantKey,
    readCredential,
    expectedDeploymentFingerprint: release.value.release.live_observer_fingerprint,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(() => {
    console.error(JSON.stringify({ ok: false, code: 'blocked', issues: ['named-deployment qualification failed'] }));
    process.exitCode = 2;
  });
}
