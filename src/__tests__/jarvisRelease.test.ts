import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveObserverDeployment, validateLiveObserverDeployment } from '../domain/liveObserver';
import { JarvisReleaseManifest, validateJarvisReleaseManifest } from '../domain/jarvisRelease';
import { jarvisV1Hash } from '../domain/jarvisV1';
import { VOICE_PRIVACY_NOTICE_VERSION, voiceSessionHash } from '../domain/voiceSession';
import { inspectJarvisReleasePreflight } from '../jarvisReleasePreflight';
import { qualifyJarvisDeployment } from '../jarvisQualification';

function live(): LiveObserverDeployment {
  return {
    schema_version: 'leozops_phase12_live_observer_v1', status: 'accepted', environment: 'staging',
    runtime_profile: 'egoric-readonly',
    target: {
      provider: 'exact-cloud', project_id: 'realms-staging', service_id: 'leozops-jarvis',
      region: 'us-east-1', database_id: 'leozops-staging-pg',
    },
    source: {
      tenant_id: '11111111-1111-4111-8111-111111111118', tenant_key: 'repositoryrealms-staging',
      connection_id: '22222222-2222-4222-8222-222222222218', egoric_project_id: 'repositoryrealms-source',
      endpoint_url: 'https://realms.example/api/integrations/leozops/v1/lead-snapshot', method: 'GET', request_body_present: false,
    },
    owners: { product_owner: 'solo-founder', runtime_owner: 'solo-founder', incident_owner: 'solo-founder' },
    secret_bindings: {
      database_url: 'env://DATABASE_URL', output_auth_secret: 'env://LEOZOPS_OUTPUT_AUTH_SECRET',
      source_bearer_token: 'env://LEOZOPS_SOURCE_BEARER_TOKEN', source_operator_token: 'env://LEOZOPS_OPERATOR_TOKEN',
      proactive_operator_token: 'env://LEOZOPS_PROACTIVE_OPERATOR_TOKEN', observer_operator_token: 'env://LEOZOPS_LIVE_OBSERVER_TOKEN',
    },
    schedule: { poll_interval_seconds: 300, max_freshness_seconds: 900, observer_timeout_seconds: 120 },
    monitoring: {
      dashboard_id: 'jarvis-staging-dashboard', alert_route_id: 'jarvis-staging-alerts',
      observability_credential_sha256: `sha256:${createHash('sha256').update('observer-token').digest('hex')}`,
    },
    safety: { source_read_only: true, action_authority: 'none', background_loops_in_http_process: false, waivers_allowed: false },
  };
}

function release(liveManifest = live()): JarvisReleaseManifest {
  return {
    schema_version: 'leozops_jarvis_release_v1', status: 'accepted', environment: 'staging',
    release: {
      source_repository: 'leozvu/leozcrm', source_revision: 'a'.repeat(40),
      container_image: 'ghcr.io/leozvu/leozcrm:jarvis-staging', image_digest: `sha256:${'b'.repeat(64)}`,
      live_observer_fingerprint: validateLiveObserverDeployment(liveManifest).fingerprint!,
    },
    endpoint: { public_base_url: 'https://jarvis.repositoryrealms.com', cockpit_path: '/cockpit' },
    intelligence: {
      advisor_provider: 'openai', advisor_model: 'gpt-5.6-sol', voice_provider: 'openai_realtime',
      voice_model: 'gpt-realtime-2.1', voice: 'marin', transport: 'webrtc',
      privacy_notice_version: 'jarvis_voice_privacy_v1',
    },
    secret_bindings: { openai_api_key: 'env://OPENAI_API_KEY', integration_read_auth_secret: 'env://LEOZOPS_OUTPUT_AUTH_SECRET' },
    operations: {
      dashboard_id: 'jarvis-staging-dashboard', alert_route_id: 'jarvis-staging-alerts', backup_policy_id: 'jarvis-staging-backup',
      key_rotation_runbook_id: 'phase18-key-rotation', incident_runbook_id: 'phase18-incident-response', evidence_store_id: 'jarvis-staging-evidence',
    },
    acceptance: {
      ceo_owner: 'solo-founder', runtime_owner: 'solo-founder', qualification_window_days: 30,
      required_checkpoints: ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8'],
    },
    safety: {
      action_authority: 'none', raw_audio_retention: 'none', transcript_retention: 'none',
      production_acceptance_inferred: false, waivers_allowed: false,
    },
  };
}

function environment(liveManifest = live()): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'production', INTEGRATION_MODE: 'egoric-readonly',
    LEOZOPS_ADVISOR_PROVIDER: 'openai', LEOZOPS_VOICE_PROVIDER: 'openai_realtime',
    LEOZOPS_RUNTIME_SOURCE_REVISION: 'a'.repeat(40), LEOZOPS_CONTAINER_IMAGE_DIGEST: `sha256:${'b'.repeat(64)}`,
    LEOZOPS_PUBLIC_BASE_URL: 'https://jarvis.repositoryrealms.com', LEOZOPS_RUNTIME_PROJECT_ID: liveManifest.target.project_id,
    LEOZOPS_DATABASE_ID: liveManifest.target.database_id, LEOZOPS_EGORIC_PROJECT_ID: liveManifest.source.egoric_project_id,
    OPENAI_API_KEY: 'openai-test-key-long-enough', LEOZOPS_OUTPUT_AUTH_SECRET: 'read-auth-test-key-long-enough',
  };
  Object.values(liveManifest.secret_bindings).forEach((reference) => { env[reference.slice(6)] ??= `secret-${reference}`; });
  env.OPENAI_API_KEY = 'openai-test-key-long-enough';
  env.LEOZOPS_OUTPUT_AUTH_SECRET = 'read-auth-test-key-long-enough';
  return env;
}

function candidateQuality(mutate?: (core: Record<string, any>) => void): Record<string, any> {
  const core: Record<string, any> = {
    schema_version: 'leozops_voice_quality_v1',
    generated_at: '2026-08-17T04:00:00.000Z',
    window: { days: 30, from: '2026-07-18T04:00:00.000Z', to: '2026-08-17T04:00:00.000Z' },
    candidate_status: 'meets_candidate_thresholds',
    live_acceptance: 'not_inferred',
    sessions: {
      requested: 5, openai_realtime: 5, connected: 5, ended: 5, failed: 0,
      connect_success_rate: 1, connect_latency_p95_ms: 900,
    },
    turns: {
      committed: 10, grounding_started: 10, grounding_completed: 10, grounding_failed: 0,
      grounding_success_rate: 1, audible_responses: 10, audible_response_rate: 1,
      response_latency_p95_ms: 2_500, interruptions: 1,
    },
    reviews: { reviewed: 5, useful: 5, useful_rate: 1, privacy_concerns: 0 },
    thresholds: {
      sessions_minimum: 5, turns_minimum: 10, reviews_minimum: 5,
      connect_success_rate_minimum: 0.95, grounding_success_rate_minimum: 0.95,
      audible_response_rate_minimum: 0.95, useful_rate_minimum: 0.8,
      interruptions_minimum: 1, response_latency_p95_ms_maximum: 10_000,
      privacy_concerns_maximum: 0, failed_sessions_maximum: 0,
    },
    privacy: {
      notice_version: VOICE_PRIVACY_NOTICE_VERSION, raw_audio_retention: 'none',
      transcript_retention: 'none', device_or_user_agent_retention: 'none',
    },
    limitation: 'Candidate evidence does not infer live acceptance.',
  };
  mutate?.(core);
  return { ...core, quality_hash: voiceSessionHash(core) };
}

function candidateReadiness(
  quality: Record<string, any>,
  mutate?: (core: Record<string, any>) => void,
): Record<string, any> {
  const core: Record<string, any> = {
    schema_version: 'leozops_jarvis_readiness_v1',
    generated_at: '2026-08-17T04:00:00.000Z',
    overall: 'blocked_external',
    grants_action_authority: false,
    evaluation_hash: `sha256:${'c'.repeat(64)}`,
    voice_quality_hash: quality.quality_hash,
    voice_candidate_status: quality.candidate_status,
    checkpoints: Array.from({ length: 8 }, (_, index) => ({
      checkpoint: `J${index + 1}`,
      name: `Checkpoint J${index + 1}`,
      repository_candidate: true,
      live_status: 'blocked_external',
      blockers: [`J${index + 1}_live_evidence_absent`],
    })),
    retention_policy: { conversation_days: 90 },
    operator_truth: {
      can_inspect_repository_evidence: true,
      can_request_sanitized_export: true,
      can_request_delete: true,
      automatic_delete_enabled: false,
      production_restore_proven: false,
      external_action_registry_enabled_by_default: false,
      voice_action_authority: 'none',
      raw_audio_or_transcript_retained: false,
    },
  };
  mutate?.(core);
  return { ...core, readiness_hash: jarvisV1Hash(core) };
}

function qualificationFetch(
  deploymentFingerprint: string,
  quality: Record<string, any>,
  readiness: Record<string, any>,
) {
  return async (url: string, init?: RequestInit) => {
    assert.equal(String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '').includes('qualification-secret'),
      url.includes('/v1/tenants/'));
    if (url.endsWith('/startup')) return Response.json({ ok: true, profile: 'egoric-readonly', deployment_fingerprint: deploymentFingerprint });
    if (url.endsWith('/ready')) return Response.json({ ok: true, profile: 'egoric-readonly', checks: { db: 'ok', migrations_current: true } });
    if (url.includes('/jarvis/voice/quality')) return Response.json(quality);
    if (url.includes('/jarvis/readiness')) return Response.json(readiness);
    if (url.endsWith('/cockpit/')) return new Response('<html></html>', {
      headers: { 'content-security-policy': "default-src 'none'; connect-src 'self' https://api.openai.com" },
    });
    return new Response('', { status: 404 });
  };
}

test('Jarvis release manifest pins code, image, live source, providers, privacy, operations, and J1-J8', () => {
  const result = validateJarvisReleaseManifest(release());
  assert.equal(result.ok, true);
  assert.match(result.fingerprint ?? '', /^sha256:[0-9a-f]{64}$/);
  const unsafe = structuredClone(release()) as any;
  unsafe.safety.transcript_retention = 'full';
  unsafe.secret_bindings.openai_api_key = 'raw-secret';
  assert.equal(validateJarvisReleaseManifest(unsafe).ok, false);
});

test('Jarvis preflight verifies the entire live chain and never returns injected secrets', () => {
  const liveManifest = live();
  const manifest = release(liveManifest);
  const env = environment(liveManifest);
  const result = inspectJarvisReleasePreflight(manifest, liveManifest, env);
  assert.equal(result.ok, true, result.issues.join('\n'));
  assert.equal(JSON.stringify(result).includes('openai-test-key-long-enough'), false);
  delete env.OPENAI_API_KEY;
  assert.equal(inspectJarvisReleasePreflight(manifest, liveManifest, env).ok, false);
  env.OPENAI_API_KEY = 'openai-test-key-long-enough';
  env.LEOZOPS_RUNTIME_SOURCE_REVISION = 'c'.repeat(40);
  assert.equal(inspectJarvisReleasePreflight(manifest, liveManifest, env).ok, false);
  const serverEnv = environment(liveManifest);
  delete serverEnv.LEOZOPS_SOURCE_BEARER_TOKEN;
  delete serverEnv.LEOZOPS_OPERATOR_TOKEN;
  delete serverEnv.LEOZOPS_PROACTIVE_OPERATOR_TOKEN;
  delete serverEnv.LEOZOPS_LIVE_OBSERVER_TOKEN;
  assert.equal(inspectJarvisReleasePreflight(manifest, liveManifest, serverEnv, 'server').ok, true);
  const unusable = environment(liveManifest);
  unusable.OPENAI_API_KEY = ' placeholder ';
  const unusableResult = inspectJarvisReleasePreflight(manifest, liveManifest, unusable);
  assert.equal(unusableResult.ok, false);
  assert.equal(JSON.stringify(unusableResult).includes('placeholder'), false);
});

test('pending example and mismatched live fingerprint fail closed', () => {
  const liveManifest = live();
  const manifest = release(liveManifest);
  manifest.release.live_observer_fingerprint = `sha256:${'d'.repeat(64)}`;
  const result = inspectJarvisReleasePreflight(manifest, liveManifest, environment(liveManifest));
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes('release live observer fingerprint does not match the accepted manifest'));
  const placeholder = release(liveManifest) as any;
  placeholder.release.source_revision = '0'.repeat(40);
  placeholder.release.image_digest = `sha256:${'0'.repeat(64)}`;
  placeholder.endpoint.public_base_url = 'https://jarvis.example.com';
  assert.equal(validateJarvisReleaseManifest(placeholder).ok, false);
});

test('named-deployment qualification requires runtime identity, migrations, CSP, and voice thresholds', async () => {
  const deploymentFingerprint = validateLiveObserverDeployment(live()).fingerprint!;
  let quality = candidateQuality();
  let readiness = candidateReadiness(quality);
  const result = await qualifyJarvisDeployment({
    publicBaseUrl: 'https://jarvis.repositoryrealms.com', tenantKey: 'repositoryrealms-staging',
    readCredential: 'qualification-secret', expectedDeploymentFingerprint: deploymentFingerprint,
  }, qualificationFetch(deploymentFingerprint, quality, readiness));
  assert.equal(result.ok, true, result.issues.join('\n'));
  assert.equal(result.code, 'candidate_ready_for_ceo_acceptance');
  assert.equal(JSON.stringify(result).includes('qualification-secret'), false);
  assert.equal(result.evidence.live_acceptance, 'not_inferred');

  quality = candidateQuality((core) => {
    core.sessions = { ...core.sessions, requested: 0, openai_realtime: 0, connected: 0 };
    core.turns = {
      ...core.turns, committed: 0, grounding_started: 0, grounding_completed: 0,
      audible_responses: 0, interruptions: 0,
    };
    core.reviews = { ...core.reviews, reviewed: 0, useful: 0 };
  });
  readiness = candidateReadiness(quality);
  const blocked = await qualifyJarvisDeployment({
    publicBaseUrl: 'https://jarvis.repositoryrealms.com', tenantKey: 'repositoryrealms-staging',
    readCredential: 'qualification-secret', expectedDeploymentFingerprint: deploymentFingerprint,
  }, qualificationFetch(deploymentFingerprint, quality, readiness));
  assert.equal(blocked.ok, false);
  assert.ok(blocked.issues.includes('voice evidence minimum sample is not met'));
  assert.ok(blocked.issues.includes('voice interruption evidence is absent'));
});

test('qualification verifies evidence hashes and exact blocked J1-J8 identities instead of trusting labels', async () => {
  const deploymentFingerprint = validateLiveObserverDeployment(live()).fingerprint!;
  const quality = candidateQuality();
  const duplicated = candidateReadiness(quality, (core) => {
    core.checkpoints[1] = { ...core.checkpoints[1], checkpoint: 'J1' };
  });
  const duplicateResult = await qualifyJarvisDeployment({
    publicBaseUrl: 'https://jarvis.repositoryrealms.com', tenantKey: 'repositoryrealms-staging',
    readCredential: 'qualification-secret', expectedDeploymentFingerprint: deploymentFingerprint,
  }, qualificationFetch(deploymentFingerprint, quality, duplicated));
  assert.equal(duplicateResult.ok, false);
  assert.ok(duplicateResult.issues.includes('Jarvis readiness must expose exact blocked J1-J8 checkpoints'));

  const tampered = candidateQuality();
  tampered.quality_hash = `sha256:${'0'.repeat(64)}`;
  const boundToTampered = candidateReadiness(tampered);
  const tamperedResult = await qualifyJarvisDeployment({
    publicBaseUrl: 'https://jarvis.repositoryrealms.com', tenantKey: 'repositoryrealms-staging',
    readCredential: 'qualification-secret', expectedDeploymentFingerprint: deploymentFingerprint,
  }, qualificationFetch(deploymentFingerprint, tampered, boundToTampered));
  assert.equal(tamperedResult.ok, false);
  assert.ok(tamperedResult.issues.includes('voice quality evidence hash is invalid'));

  const tamperedReadiness = candidateReadiness(quality);
  tamperedReadiness.readiness_hash = `sha256:${'0'.repeat(64)}`;
  const tamperedReadinessResult = await qualifyJarvisDeployment({
    publicBaseUrl: 'https://jarvis.repositoryrealms.com', tenantKey: 'repositoryrealms-staging',
    readCredential: 'qualification-secret', expectedDeploymentFingerprint: deploymentFingerprint,
  }, qualificationFetch(deploymentFingerprint, quality, tamperedReadiness));
  assert.equal(tamperedReadinessResult.ok, false);
  assert.ok(tamperedReadinessResult.issues.includes('Jarvis readiness evidence hash is invalid'));

  await assert.rejects(() => qualifyJarvisDeployment({
    publicBaseUrl: 'https://jarvis.repositoryrealms.com', tenantKey: 'repositoryrealms-staging',
    readCredential: 'qualification-secret', expectedDeploymentFingerprint: 'pending',
  }, qualificationFetch(deploymentFingerprint, quality, candidateReadiness(quality))),
  /deployment fingerprint is invalid/);
});

test('qualification independently recomputes every voice candidate safety invariant', async () => {
  const deploymentFingerprint = validateLiveObserverDeployment(live()).fingerprint!;
  const cases: Array<{
    name: string;
    issue: string;
    mutate: (core: Record<string, any>) => void;
  }> = [
    { name: 'declared status', issue: 'voice candidate thresholds are not met', mutate: (core) => { core.candidate_status = 'blocked'; } },
    { name: 'live inference', issue: 'voice quality response must not infer live acceptance', mutate: (core) => { core.live_acceptance = 'accepted'; } },
    { name: 'counter type', issue: 'voice quality counters are invalid', mutate: (core) => { core.sessions.requested = '5'; } },
    { name: 'provider sample', issue: 'voice session sample is not entirely OpenAI Realtime evidence', mutate: (core) => { core.sessions.openai_realtime = 4; } },
    { name: 'connections', issue: 'voice connection evidence does not meet the candidate threshold', mutate: (core) => { core.sessions.connected = 4; } },
    { name: 'failed session', issue: 'voice connection evidence does not meet the candidate threshold', mutate: (core) => { core.sessions.failed = 1; } },
    { name: 'grounding', issue: 'voice grounding evidence is not one-to-one and failure-free', mutate: (core) => { core.turns.grounding_completed = 9; } },
    { name: 'audible response', issue: 'voice audible-response evidence is not one-to-one', mutate: (core) => { core.turns.audible_responses = 9; } },
    { name: 'latency', issue: 'voice response latency evidence exceeds the candidate threshold', mutate: (core) => { core.turns.response_latency_p95_ms = 10_001; } },
    { name: 'usefulness', issue: 'voice CEO usefulness evidence does not meet the candidate threshold', mutate: (core) => { core.reviews.useful = 3; } },
    { name: 'privacy concern', issue: 'voice privacy concerns remain open', mutate: (core) => { core.reviews.privacy_concerns = 1; } },
    { name: 'retention', issue: 'voice privacy evidence does not match the accepted contract', mutate: (core) => { core.privacy.transcript_retention = 'full'; } },
    { name: 'threshold drift', issue: 'voice quality thresholds do not match the accepted contract', mutate: (core) => { core.thresholds.sessions_minimum = 4; } },
    { name: 'window drift', issue: 'voice quality window is not the required 30 days', mutate: (core) => { core.window.days = 29; } },
  ];
  for (const scenario of cases) {
    const quality = candidateQuality(scenario.mutate);
    const result = await qualifyJarvisDeployment({
      publicBaseUrl: 'https://jarvis.repositoryrealms.com', tenantKey: 'repositoryrealms-staging',
      readCredential: 'qualification-secret', expectedDeploymentFingerprint: deploymentFingerprint,
    }, qualificationFetch(deploymentFingerprint, quality, candidateReadiness(quality)));
    assert.equal(result.ok, false, scenario.name);
    assert.ok(result.issues.includes(scenario.issue), `${scenario.name}: ${result.issues.join(', ')}`);
  }
});

test('qualification independently binds readiness safety truth and rejects malformed targets or responses', async () => {
  const deploymentFingerprint = validateLiveObserverDeployment(live()).fingerprint!;
  const quality = candidateQuality();
  const cases: Array<{
    name: string;
    issue: string;
    mutate: (core: Record<string, any>) => void;
  }> = [
    { name: 'overall', issue: 'Jarvis readiness safety boundary is invalid', mutate: (core) => { core.overall = 'ready'; } },
    { name: 'authority', issue: 'Jarvis readiness safety boundary is invalid', mutate: (core) => { core.grants_action_authority = true; } },
    { name: 'checkpoint state', issue: 'Jarvis readiness must expose exact blocked J1-J8 checkpoints', mutate: (core) => { core.checkpoints[0].blockers = []; } },
    { name: 'voice hash binding', issue: 'Jarvis readiness is not bound to the verified voice evidence', mutate: (core) => { core.voice_quality_hash = `sha256:${'d'.repeat(64)}`; } },
    { name: 'voice status binding', issue: 'Jarvis readiness is not bound to the verified voice evidence', mutate: (core) => { core.voice_candidate_status = 'blocked'; } },
    { name: 'evaluation hash', issue: 'Jarvis evaluation evidence hash is invalid', mutate: (core) => { core.evaluation_hash = 'pending'; } },
    { name: 'operator truth', issue: 'Jarvis operator truth violates the release safety boundary', mutate: (core) => { core.operator_truth.external_action_registry_enabled_by_default = true; } },
  ];
  for (const scenario of cases) {
    const readiness = candidateReadiness(quality, scenario.mutate);
    const result = await qualifyJarvisDeployment({
      publicBaseUrl: 'https://jarvis.repositoryrealms.com', tenantKey: 'repositoryrealms-staging',
      readCredential: 'qualification-secret', expectedDeploymentFingerprint: deploymentFingerprint,
    }, qualificationFetch(deploymentFingerprint, quality, readiness));
    assert.equal(result.ok, false, scenario.name);
    assert.ok(result.issues.includes(scenario.issue), `${scenario.name}: ${result.issues.join(', ')}`);
  }

  const validFetch = qualificationFetch(deploymentFingerprint, quality, candidateReadiness(quality));
  await assert.rejects(() => qualifyJarvisDeployment({
    publicBaseUrl: 'http://jarvis.repositoryrealms.com', tenantKey: 'repositoryrealms-staging',
    readCredential: 'qualification-secret', expectedDeploymentFingerprint: deploymentFingerprint,
  }, validFetch), /exact credential-free HTTPS origin/);
  await assert.rejects(() => qualifyJarvisDeployment({
    publicBaseUrl: 'https://jarvis.repositoryrealms.com/path', tenantKey: 'repositoryrealms-staging',
    readCredential: 'qualification-secret', expectedDeploymentFingerprint: deploymentFingerprint,
  }, validFetch), /exact credential-free HTTPS origin/);
  await assert.rejects(() => qualifyJarvisDeployment({
    publicBaseUrl: 'https://jarvis.repositoryrealms.com', tenantKey: 'INVALID TENANT',
    readCredential: 'qualification-secret', expectedDeploymentFingerprint: deploymentFingerprint,
  }, validFetch), /tenant key is invalid/);
  await assert.rejects(() => qualifyJarvisDeployment({
    publicBaseUrl: 'https://jarvis.repositoryrealms.com', tenantKey: 'repositoryrealms-staging',
    readCredential: '', expectedDeploymentFingerprint: deploymentFingerprint,
  }, validFetch), /read credential is invalid/);

  const invalidJsonFetch = async (url: string, init?: RequestInit) => url.endsWith('/startup')
    ? new Response('not-json')
    : validFetch(url, init);
  await assert.rejects(() => qualifyJarvisDeployment({
    publicBaseUrl: 'https://jarvis.repositoryrealms.com', tenantKey: 'repositoryrealms-staging',
    readCredential: 'qualification-secret', expectedDeploymentFingerprint: deploymentFingerprint,
  }, invalidJsonFetch), /qualification response was not JSON/);

  const oversizedFetch = async (url: string, init?: RequestInit) => url.endsWith('/startup')
    ? new Response('{}', { headers: { 'content-length': String(1024 * 1024 + 1) } })
    : validFetch(url, init);
  await assert.rejects(() => qualifyJarvisDeployment({
    publicBaseUrl: 'https://jarvis.repositoryrealms.com', tenantKey: 'repositoryrealms-staging',
    readCredential: 'qualification-secret', expectedDeploymentFingerprint: deploymentFingerprint,
  }, oversizedFetch), /qualification response exceeded limit/);
});
