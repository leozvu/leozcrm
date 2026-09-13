import { createHash, createPublicKey, verify } from 'node:crypto';

export const HUMAN_SCOPES = ['cockpit:read', 'advisory:write', 'voice:use'] as const;
export type HumanScope = typeof HUMAN_SCOPES[number];
export interface HumanBinding {
  id: string;
  subject: string;
  sourceTenant: string;
  tenantKey: string;
  userId: string;
  scopes: HumanScope[];
}
export interface HumanSessionConfig {
  enabled: true;
  origin: string;
  audience: string;
  issuer: { id: string; authorizeUrl: string; keys: Record<string, string> };
  bindings: HumanBinding[];
  sessionSeconds: number;
  allowLocalHttp?: boolean;
}
export class HumanSessionError extends Error {
  constructor(public readonly code: string, public readonly status = 401) {
    super(code);
  }
}
export const humanHash = (value: string): string => createHash('sha256').update(value).digest('hex');
function fail(code = 'human_handoff_invalid', status = 401): never { throw new HumanSessionError(code, status); }
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
const nonce = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{32,96}$/.test(value);
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function validUrl(raw: string, config: { allowLocalHttp?: boolean }, originOnly: boolean): URL {
  const url = new URL(raw);
  const local = config.allowLocalHttp && process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || (originOnly && raw !== url.origin)) fail('human_sso_configuration_invalid', 503);
  return url;
}

/** No issuer discovery, shared signing secret, or inferred tenant membership. */
export function resolveHumanSessionConfig(explicit?: HumanSessionConfig | null): HumanSessionConfig | null {
  let raw: unknown = explicit;
  try {
    if (raw === undefined) raw = process.env.LEOZOPS_HUMAN_SSO_CONFIG ? JSON.parse(process.env.LEOZOPS_HUMAN_SSO_CONFIG) : null;
    if (raw === null) return null;
    if (!object(raw) || raw.enabled !== true || !identifier(raw.audience) || !object(raw.issuer)
      || !identifier(raw.issuer.id) || !object(raw.issuer.keys) || !Array.isArray(raw.bindings)
      || raw.bindings.length === 0 || raw.bindings.length > 1000
      || (raw.allowLocalHttp !== undefined && typeof raw.allowLocalHttp !== 'boolean')
      || !Number.isInteger(raw.sessionSeconds) || Number(raw.sessionSeconds) < 300 || Number(raw.sessionSeconds) > 3600) fail();
    const config = raw as unknown as HumanSessionConfig;
    validUrl(config.origin, config, true);
    validUrl(config.issuer.authorizeUrl, config, false);
    const keys = Object.entries(config.issuer.keys);
    if (keys.length === 0 || keys.length > 3) fail();
    for (const [kid, pem] of keys) {
      if (!identifier(kid) || typeof pem !== 'string' || !pem.startsWith('-----BEGIN PUBLIC KEY-----') || pem.length > 2048 || createPublicKey(pem).asymmetricKeyType !== 'ed25519') fail();
    }
    const ids = new Set<string>(), subjects = new Set<string>();
    for (const binding of config.bindings) {
      if (!object(binding) || !identifier(binding.id) || !identifier(binding.subject) || !identifier(binding.sourceTenant)
        || !identifier(binding.userId) || typeof binding.tenantKey !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(binding.tenantKey)
        || !Array.isArray(binding.scopes) || !binding.scopes.includes('cockpit:read')
        || binding.scopes.some(scope => !HUMAN_SCOPES.includes(scope)) || new Set(binding.scopes).size !== binding.scopes.length) fail();
      const subject = `${binding.sourceTenant}:${binding.subject}`;
      if (ids.has(binding.id) || subjects.has(subject)) fail();
      ids.add(binding.id); subjects.add(subject);
    }
    return structuredClone(config);
  } catch { return fail('human_sso_configuration_invalid', 503); }
}

export function humanTrustFingerprint(config: HumanSessionConfig, binding: HumanBinding, keyId: string): string {
  return humanHash(JSON.stringify([config.origin, config.audience, config.issuer.id, keyId, config.issuer.keys[keyId], binding.id, binding.subject, binding.sourceTenant, binding.tenantKey, binding.userId, [...binding.scopes].sort(), config.sessionSeconds]));
}

export function verifyHumanHandoff(token: unknown, config: HumanSessionConfig, now: Date) {
  try {
    if (typeof token !== 'string' || token.length > 8192) fail();
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) fail();
    const [encodedHeader, encodedClaims, encodedSignature] = parts;
    const header: unknown = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    const claims: unknown = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8'));
    if (!object(header) || !exact(header, ['alg', 'typ', 'kid']) || header.alg !== 'EdDSA' || header.typ !== 'leozops-human-handoff+jwt'
      || !identifier(header.kid) || !Object.hasOwn(config.issuer.keys, header.kid)) fail();
    const signature = Buffer.from(encodedSignature, 'base64url');
    if (signature.length !== 64 || signature.toString('base64url') !== encodedSignature
      || !verify(null, Buffer.from(`${encodedHeader}.${encodedClaims}`), createPublicKey(config.issuer.keys[header.kid]), signature)) fail();
    if (!object(claims) || !exact(claims, ['schema_version', 'iss', 'aud', 'sub', 'source_tenant', 'nonce', 'jti', 'iat', 'exp', 'scopes'])
      || claims.schema_version !== 'leozops_human_handoff_v1' || claims.iss !== config.issuer.id || claims.aud !== config.audience
      || !identifier(claims.sub) || !identifier(claims.source_tenant) || !nonce(claims.nonce) || !nonce(claims.jti)
      || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || !Array.isArray(claims.scopes)) fail();
    const seconds = Math.floor(now.getTime() / 1000);
    if (Number(claims.iat) > seconds + 5 || Number(claims.exp) <= seconds || Number(claims.exp) <= Number(claims.iat)
      || Number(claims.exp) - Number(claims.iat) > 120 || seconds - Number(claims.iat) > 120) fail('human_handoff_expired');
    const binding = config.bindings.find(item => item.subject === claims.sub && item.sourceTenant === claims.source_tenant);
    if (!binding || !claims.scopes.includes('cockpit:read') || new Set(claims.scopes).size !== claims.scopes.length
      || claims.scopes.some(scope => !binding.scopes.includes(scope as HumanScope))) fail('human_subject_not_authorized', 403);
    return { binding, keyId: header.kid, nonce: claims.nonce, jtiHash: humanHash(`${claims.iss}:${claims.jti}`), scopes: claims.scopes as HumanScope[], trustFingerprint: humanTrustFingerprint(config, binding, header.kid) };
  } catch (error) {
    if (error instanceof HumanSessionError) throw error;
    return fail();
  }
}
