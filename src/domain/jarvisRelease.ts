import { createHash } from 'node:crypto';
import { canonicalStringify } from './businessMemory';
import { VOICE_PRIVACY_NOTICE_VERSION, VOICE_SESSION_MODEL, VOICE_SESSION_VOICE } from './voiceSession';
import { OPENAI_ADVISOR_MODEL } from '../integrations/advisor/openaiResponsesAdvisorProvider';

export const JARVIS_RELEASE_SCHEMA = 'leozops_jarvis_release_v1' as const;

export interface JarvisReleaseManifest {
  schema_version: typeof JARVIS_RELEASE_SCHEMA;
  status: 'accepted';
  environment: 'staging' | 'production';
  release: {
    source_repository: 'leozvu/leozcrm';
    source_revision: string;
    container_image: string;
    image_digest: string;
    live_observer_fingerprint: string;
  };
  endpoint: { public_base_url: string; cockpit_path: '/cockpit' };
  intelligence: {
    advisor_provider: 'openai';
    advisor_model: typeof OPENAI_ADVISOR_MODEL;
    voice_provider: 'openai_realtime';
    voice_model: typeof VOICE_SESSION_MODEL;
    voice: typeof VOICE_SESSION_VOICE;
    transport: 'webrtc';
    privacy_notice_version: typeof VOICE_PRIVACY_NOTICE_VERSION;
  };
  secret_bindings: {
    openai_api_key: string;
    integration_read_auth_secret: string;
  };
  operations: {
    dashboard_id: string;
    alert_route_id: string;
    backup_policy_id: string;
    key_rotation_runbook_id: string;
    incident_runbook_id: string;
    evidence_store_id: string;
  };
  acceptance: {
    ceo_owner: string;
    runtime_owner: string;
    qualification_window_days: 30;
    required_checkpoints: ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8'];
  };
  safety: {
    action_authority: 'none';
    raw_audio_retention: 'none';
    transcript_retention: 'none';
    production_acceptance_inferred: false;
    waivers_allowed: false;
  };
}

export interface JarvisReleaseValidation {
  ok: boolean;
  issues: string[];
  value?: JarvisReleaseManifest;
  fingerprint?: string;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,191}$/;
const ENV_REF = /^env:\/\/[A-Z][A-Z0-9_]{2,127}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function exact(value: Record<string, unknown>, fields: readonly string[], path: string, issues: string[]): void {
  const allowed = new Set(fields);
  Object.keys(value).forEach((key) => { if (!allowed.has(key)) issues.push(`${path}.${key} is not allowed`); });
  fields.forEach((key) => { if (!(key in value)) issues.push(`${path}.${key} is required`); });
}

function safe(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)
    || /(^|[._:/-])(pending|placeholder|example)([._:/-]|$)/i.test(value)) {
    issues.push(`${path} must be a non-secret stable identifier`);
    return '';
  }
  return value;
}

function sha(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== 'string' || !SHA256.test(value) || value === `sha256:${'0'.repeat(64)}`) {
    issues.push(`${path} must be a lowercase SHA-256 digest`);
    return '';
  }
  return value;
}

function envRef(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== 'string' || !ENV_REF.test(value)) {
    issues.push(`${path} must be an env:// reference; raw secrets are forbidden`);
    return '';
  }
  return value;
}

export function jarvisReleaseFingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

export function jarvisSecretEnvironmentName(reference: string): string {
  return reference.startsWith('env://') ? reference.slice(6) : '';
}

export function validateJarvisReleaseManifest(raw: unknown): JarvisReleaseValidation {
  const issues: string[] = [];
  const root = object(raw);
  if (!root) return { ok: false, issues: ['release manifest must be a JSON object'] };
  exact(root, ['schema_version', 'status', 'environment', 'release', 'endpoint', 'intelligence', 'secret_bindings', 'operations', 'acceptance', 'safety'], 'manifest', issues);
  if (root.schema_version !== JARVIS_RELEASE_SCHEMA) issues.push(`schema_version must equal ${JARVIS_RELEASE_SCHEMA}`);
  if (root.status !== 'accepted') issues.push('status must equal accepted');
  if (root.environment !== 'staging' && root.environment !== 'production') issues.push('environment must equal staging or production');

  const release = object(root.release) ?? {};
  exact(release, ['source_repository', 'source_revision', 'container_image', 'image_digest', 'live_observer_fingerprint'], 'release', issues);
  if (release.source_repository !== 'leozvu/leozcrm') issues.push('release.source_repository must equal leozvu/leozcrm');
  if (typeof release.source_revision !== 'string' || !REVISION.test(release.source_revision)
    || release.source_revision === '0'.repeat(40)) issues.push('release.source_revision must be a full non-placeholder lowercase Git revision');
  const parsedRelease = {
    source_repository: 'leozvu/leozcrm' as const,
    source_revision: typeof release.source_revision === 'string' ? release.source_revision : '',
    container_image: safe(release.container_image, 'release.container_image', issues),
    image_digest: sha(release.image_digest, 'release.image_digest', issues),
    live_observer_fingerprint: sha(release.live_observer_fingerprint, 'release.live_observer_fingerprint', issues),
  };

  const endpoint = object(root.endpoint) ?? {};
  exact(endpoint, ['public_base_url', 'cockpit_path'], 'endpoint', issues);
  let publicBaseUrl = '';
  if (typeof endpoint.public_base_url !== 'string') issues.push('endpoint.public_base_url must be a credential-free HTTPS origin');
  else {
    try {
      const url = new URL(endpoint.public_base_url);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/'
        || url.hostname === 'example.com' || url.hostname.endsWith('.example') || url.hostname.endsWith('.example.com')) {
        issues.push('endpoint.public_base_url must be a credential-free HTTPS origin');
      } else publicBaseUrl = url.origin;
    } catch { issues.push('endpoint.public_base_url must be a credential-free HTTPS origin'); }
  }
  if (endpoint.cockpit_path !== '/cockpit') issues.push('endpoint.cockpit_path must equal /cockpit');

  const intelligence = object(root.intelligence) ?? {};
  exact(intelligence, ['advisor_provider', 'advisor_model', 'voice_provider', 'voice_model', 'voice', 'transport', 'privacy_notice_version'], 'intelligence', issues);
  const expectedIntelligence = {
    advisor_provider: 'openai', advisor_model: OPENAI_ADVISOR_MODEL,
    voice_provider: 'openai_realtime', voice_model: VOICE_SESSION_MODEL,
    voice: VOICE_SESSION_VOICE, transport: 'webrtc', privacy_notice_version: VOICE_PRIVACY_NOTICE_VERSION,
  } as const;
  Object.entries(expectedIntelligence).forEach(([key, value]) => {
    if (intelligence[key] !== value) issues.push(`intelligence.${key} must equal ${value}`);
  });

  const bindings = object(root.secret_bindings) ?? {};
  exact(bindings, ['openai_api_key', 'integration_read_auth_secret'], 'secret_bindings', issues);
  const parsedBindings = {
    openai_api_key: envRef(bindings.openai_api_key, 'secret_bindings.openai_api_key', issues),
    integration_read_auth_secret: envRef(bindings.integration_read_auth_secret, 'secret_bindings.integration_read_auth_secret', issues),
  };
  if (parsedBindings.openai_api_key !== 'env://OPENAI_API_KEY') issues.push('secret_bindings.openai_api_key must equal env://OPENAI_API_KEY');
  if (parsedBindings.integration_read_auth_secret !== 'env://LEOZOPS_OUTPUT_AUTH_SECRET') issues.push('secret_bindings.integration_read_auth_secret must equal env://LEOZOPS_OUTPUT_AUTH_SECRET');
  if (parsedBindings.openai_api_key === parsedBindings.integration_read_auth_secret) issues.push('Jarvis secret bindings must be distinct');

  const operations = object(root.operations) ?? {};
  const operationKeys = ['dashboard_id', 'alert_route_id', 'backup_policy_id', 'key_rotation_runbook_id', 'incident_runbook_id', 'evidence_store_id'] as const;
  exact(operations, operationKeys, 'operations', issues);
  const parsedOperations = Object.fromEntries(operationKeys.map((key) => [key, safe(operations[key], `operations.${key}`, issues)])) as JarvisReleaseManifest['operations'];

  const acceptance = object(root.acceptance) ?? {};
  exact(acceptance, ['ceo_owner', 'runtime_owner', 'qualification_window_days', 'required_checkpoints'], 'acceptance', issues);
  const requiredCheckpoints = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8'];
  if (acceptance.qualification_window_days !== 30) issues.push('acceptance.qualification_window_days must equal 30');
  if (!Array.isArray(acceptance.required_checkpoints)
    || acceptance.required_checkpoints.length !== requiredCheckpoints.length
    || acceptance.required_checkpoints.some((value, index) => value !== requiredCheckpoints[index])) {
    issues.push('acceptance.required_checkpoints must contain J1 through J8 in order');
  }
  const parsedAcceptanceOwners = {
    ceo_owner: safe(acceptance.ceo_owner, 'acceptance.ceo_owner', issues),
    runtime_owner: safe(acceptance.runtime_owner, 'acceptance.runtime_owner', issues),
  };

  const safety = object(root.safety) ?? {};
  exact(safety, ['action_authority', 'raw_audio_retention', 'transcript_retention', 'production_acceptance_inferred', 'waivers_allowed'], 'safety', issues);
  if (safety.action_authority !== 'none') issues.push('safety.action_authority must equal none');
  if (safety.raw_audio_retention !== 'none') issues.push('safety.raw_audio_retention must equal none');
  if (safety.transcript_retention !== 'none') issues.push('safety.transcript_retention must equal none');
  if (safety.production_acceptance_inferred !== false) issues.push('safety.production_acceptance_inferred must equal false');
  if (safety.waivers_allowed !== false) issues.push('safety.waivers_allowed must equal false');

  if (issues.length) return { ok: false, issues };
  const value: JarvisReleaseManifest = {
    schema_version: JARVIS_RELEASE_SCHEMA,
    status: 'accepted',
    environment: root.environment as JarvisReleaseManifest['environment'],
    release: parsedRelease,
    endpoint: { public_base_url: publicBaseUrl, cockpit_path: '/cockpit' },
    intelligence: expectedIntelligence,
    secret_bindings: parsedBindings,
    operations: parsedOperations,
    acceptance: {
      ...parsedAcceptanceOwners,
      qualification_window_days: 30,
      required_checkpoints: requiredCheckpoints as JarvisReleaseManifest['acceptance']['required_checkpoints'],
    },
    safety: {
      action_authority: 'none', raw_audio_retention: 'none', transcript_retention: 'none',
      production_acceptance_inferred: false, waivers_allowed: false,
    },
  };
  return { ok: true, issues: [], value, fingerprint: jarvisReleaseFingerprint(value) };
}
