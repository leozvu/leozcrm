import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveObserverDeployment, validateLiveObserverDeployment } from '../domain/liveObserver';
import { JarvisReleaseManifest, validateJarvisReleaseManifest } from '../domain/jarvisRelease';
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
    OPENAI_API_KEY: 'openai-test-key', LEOZOPS_OUTPUT_AUTH_SECRET: 'read-auth-test-key',
  };
  Object.values(liveManifest.secret_bindings).forEach((reference) => { env[reference.slice(6)] ??= `secret-${reference}`; });
  env.OPENAI_API_KEY = 'openai-test-key';
  env.LEOZOPS_OUTPUT_AUTH_SECRET = 'read-auth-test-key';
  return env;
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
  assert.equal(JSON.stringify(result).includes('openai-test-key'), false);
  delete env.OPENAI_API_KEY;
  assert.equal(inspectJarvisReleasePreflight(manifest, liveManifest, env).ok, false);
  env.OPENAI_API_KEY = 'openai-test-key';
  env.LEOZOPS_RUNTIME_SOURCE_REVISION = 'c'.repeat(40);
  assert.equal(inspectJarvisReleasePreflight(manifest, liveManifest, env).ok, false);
  const serverEnv = environment(liveManifest);
  delete serverEnv.LEOZOPS_SOURCE_BEARER_TOKEN;
  delete serverEnv.LEOZOPS_OPERATOR_TOKEN;
  delete serverEnv.LEOZOPS_PROACTIVE_OPERATOR_TOKEN;
  delete serverEnv.LEOZOPS_LIVE_OBSERVER_TOKEN;
  assert.equal(inspectJarvisReleasePreflight(manifest, liveManifest, serverEnv, 'server').ok, true);
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
  let candidateStatus = 'meets_candidate_thresholds';
  const fetchImpl = async (url: string, init?: RequestInit) => {
    assert.equal(String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '').includes('qualification-secret'),
      url.includes('/v1/tenants/'));
    if (url.endsWith('/startup')) return Response.json({ ok: true, profile: 'egoric-readonly', deployment_fingerprint: deploymentFingerprint });
    if (url.endsWith('/ready')) return Response.json({ ok: true, profile: 'egoric-readonly', checks: { db: 'ok', migrations_current: true } });
    if (url.includes('/jarvis/voice/quality')) return Response.json({
      schema_version: 'leozops_voice_quality_v1', candidate_status: candidateStatus, live_acceptance: 'not_inferred',
      quality_hash: `sha256:${'e'.repeat(64)}`, sessions: { requested: 5 },
      turns: { grounding_completed: 10 }, reviews: { reviewed: 5 },
    });
    if (url.includes('/jarvis/readiness')) return Response.json({
      schema_version: 'leozops_jarvis_readiness_v1', grants_action_authority: false,
      checkpoints: Array.from({ length: 8 }, (_, index) => ({ checkpoint: `J${index + 1}` })),
      readiness_hash: `sha256:${'f'.repeat(64)}`,
    });
    if (url.endsWith('/cockpit/')) return new Response('<html></html>', {
      headers: { 'content-security-policy': "default-src 'none'; connect-src 'self' https://api.openai.com" },
    });
    return new Response('', { status: 404 });
  };
  const result = await qualifyJarvisDeployment({
    publicBaseUrl: 'https://jarvis.repositoryrealms.com', tenantKey: 'repositoryrealms-staging',
    readCredential: 'qualification-secret', expectedDeploymentFingerprint: deploymentFingerprint,
  }, fetchImpl);
  assert.equal(result.ok, true, result.issues.join('\n'));
  assert.equal(result.code, 'candidate_ready_for_ceo_acceptance');
  assert.equal(JSON.stringify(result).includes('qualification-secret'), false);
  assert.equal(result.evidence.live_acceptance, 'not_inferred');
  candidateStatus = 'insufficient_sample';
  const blocked = await qualifyJarvisDeployment({
    publicBaseUrl: 'https://jarvis.repositoryrealms.com', tenantKey: 'repositoryrealms-staging',
    readCredential: 'qualification-secret', expectedDeploymentFingerprint: deploymentFingerprint,
  }, fetchImpl);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.issues.includes('voice candidate thresholds are not met'));
});
