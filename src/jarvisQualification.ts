import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { validateJarvisReleaseManifest } from './domain/jarvisRelease';
import { VOICE_QUALITY_SCHEMA } from './domain/voiceSession';
import { inspectJarvisReleasePreflight } from './jarvisReleasePreflight';

dotenv.config();

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

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
  if (quality.candidate_status !== 'meets_candidate_thresholds') issues.push('voice candidate thresholds are not met');
  if (quality.live_acceptance !== 'not_inferred') issues.push('voice quality response must not infer live acceptance');
  if (!readinessResult.response.ok || readiness.schema_version !== 'leozops_jarvis_readiness_v1') issues.push('Jarvis readiness evidence is unavailable or invalid');
  if (readiness.grants_action_authority !== false || !Array.isArray(readiness.checkpoints) || readiness.checkpoints.length !== 8) issues.push('Jarvis readiness safety boundary is invalid');
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
