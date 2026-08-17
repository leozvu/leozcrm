import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { validateLiveObserverDeployment } from './domain/liveObserver';
import {
  jarvisSecretEnvironmentName,
  validateJarvisReleaseManifest,
} from './domain/jarvisRelease';
import { inspectLiveObserverPreflight } from './liveObserverPreflight';

dotenv.config();

export interface JarvisReleasePreflightResult {
  ok: boolean;
  code: 'ready' | 'blocked';
  issues: string[];
  release_fingerprint?: string;
  live_observer_fingerprint?: string;
  target?: { environment: 'staging' | 'production'; public_base_url: string; container_image: string };
}

export function inspectJarvisReleasePreflight(
  releaseRaw: unknown,
  liveObserverRaw: unknown,
  env: NodeJS.ProcessEnv,
  scope: 'server' | 'observer' = 'observer',
): JarvisReleasePreflightResult {
  const release = validateJarvisReleaseManifest(releaseRaw);
  const live = validateLiveObserverDeployment(liveObserverRaw);
  const issues = [...release.issues.map((issue) => `release: ${issue}`), ...live.issues.map((issue) => `live_observer: ${issue}`)];
  if (!release.ok || !release.value || !release.fingerprint || !live.ok || !live.value || !live.fingerprint) {
    return { ok: false, code: 'blocked', issues };
  }
  if (release.value.environment !== live.value.environment) issues.push('release environment does not match live observer environment');
  if (release.value.release.live_observer_fingerprint !== live.fingerprint) issues.push('release live observer fingerprint does not match the accepted manifest');
  if (env.NODE_ENV !== 'production') issues.push('NODE_ENV must equal production');
  if (env.INTEGRATION_MODE !== 'egoric-readonly') issues.push('INTEGRATION_MODE must equal egoric-readonly');
  if (env.LEOZOPS_ADVISOR_PROVIDER !== release.value.intelligence.advisor_provider) issues.push('LEOZOPS_ADVISOR_PROVIDER does not match the release');
  if (env.LEOZOPS_VOICE_PROVIDER !== release.value.intelligence.voice_provider) issues.push('LEOZOPS_VOICE_PROVIDER does not match the release');
  if (env.LEOZOPS_RUNTIME_SOURCE_REVISION !== release.value.release.source_revision) issues.push('runtime source revision does not match the release');
  if (env.LEOZOPS_CONTAINER_IMAGE_DIGEST !== release.value.release.image_digest) issues.push('runtime image digest does not match the release');
  if (env.LEOZOPS_PUBLIC_BASE_URL !== release.value.endpoint.public_base_url) issues.push('public base URL does not match the release');
  const livePreflight = inspectLiveObserverPreflight(liveObserverRaw, env, scope);
  issues.push(...livePreflight.issues.map((issue) => `live_preflight: ${issue}`));
  for (const reference of Object.values(release.value.secret_bindings)) {
    const name = jarvisSecretEnvironmentName(reference);
    if (!name || !env[name]) issues.push(`${reference} is not injected`);
  }
  const openaiName = jarvisSecretEnvironmentName(release.value.secret_bindings.openai_api_key);
  const readAuthName = jarvisSecretEnvironmentName(release.value.secret_bindings.integration_read_auth_secret);
  if (openaiName === readAuthName || (env[openaiName] && env[openaiName] === env[readAuthName])) {
    issues.push('OpenAI and tenant read-auth credentials must be distinct');
  }
  return {
    ok: issues.length === 0,
    code: issues.length === 0 ? 'ready' : 'blocked',
    issues,
    release_fingerprint: release.fingerprint,
    live_observer_fingerprint: live.fingerprint,
    target: {
      environment: release.value.environment,
      public_base_url: release.value.endpoint.public_base_url,
      container_image: release.value.release.container_image,
    },
  };
}

function main(): void {
  const releasePath = process.env.LEOZOPS_JARVIS_RELEASE_MANIFEST;
  const livePath = process.env.LEOZOPS_LIVE_DEPLOYMENT_MANIFEST;
  if (!releasePath || !livePath) throw new Error('both Jarvis and live observer manifests are required');
  const releaseRaw = JSON.parse(fs.readFileSync(path.resolve(releasePath), 'utf8')) as unknown;
  const liveRaw = JSON.parse(fs.readFileSync(path.resolve(livePath), 'utf8')) as unknown;
  const result = inspectJarvisReleasePreflight(releaseRaw, liveRaw, process.env);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

if (require.main === module) {
  try { main(); } catch {
    console.error(JSON.stringify({ ok: false, code: 'blocked', issues: ['Jarvis release preflight input is missing or invalid'] }));
    process.exitCode = 2;
  }
}
