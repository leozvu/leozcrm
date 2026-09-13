import { randomBytes, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { HumanSessionConfig, HumanSessionError, HumanScope, humanHash, humanTrustFingerprint, verifyHumanHandoff } from '../domain/humanSession';

const opaque = (): string => randomBytes(32).toString('base64url');
export const csrfForHumanSession = (token: string): string => humanHash(`csrf:${token}`);
export interface HumanSession {
  id: string; tenant_key: string; user_id: string; binding_id: string; key_id: string;
  trust_fingerprint: string; scopes_json: string; expires_at: string; revoked_at: string | null;
}

export class HumanSessionRepository {
  constructor(private readonly db: Knex, private readonly clock: () => Date = () => new Date()) {}

  async start() {
    const now = this.clock();
    const challenge = opaque(), nonce = opaque();
    await this.db.transaction(async tx => {
      await tx('human_login_challenges').where('expires_at', '<=', now.toISOString()).delete();
      await tx('human_login_challenges').insert({ challenge_hash: humanHash(`challenge:${challenge}`), nonce_hash: humanHash(nonce), expires_at: new Date(now.getTime() + 120000).toISOString(), used_at: null });
    });
    return { challenge, nonce };
  }

  async exchange(token: unknown, challenge: string, config: HumanSessionConfig, previousToken?: string) {
    const now = this.clock();
    const verified = verifyHumanHandoff(token, config, now);
    const rawSession = opaque();
    const row = {
      id: randomUUID(), session_hash: humanHash(`session:${rawSession}`), jti_hash: verified.jtiHash,
      tenant_key: verified.binding.tenantKey, user_id: verified.binding.userId,
      binding_id: verified.binding.id, key_id: verified.keyId, trust_fingerprint: verified.trustFingerprint,
      scopes_json: JSON.stringify(verified.scopes), created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + config.sessionSeconds * 1000).toISOString(), revoked_at: null,
    };
    try {
      await this.db.transaction(async tx => {
        if (!await tx('tenants').where({ tenant_key: row.tenant_key }).first('id')) throw new HumanSessionError('human_subject_not_authorized', 403);
        const changed = await tx('human_login_challenges').where({ challenge_hash: humanHash(`challenge:${challenge}`), nonce_hash: humanHash(verified.nonce) }).whereNull('used_at').where('expires_at', '>', now.toISOString()).update({ used_at: now.toISOString() });
        if (changed !== 1) throw new HumanSessionError('human_login_challenge_invalid');
        await tx('human_sessions').insert(row);
        if (previousToken) await tx('human_sessions').where({ session_hash: humanHash(`session:${previousToken}`) }).whereNull('revoked_at').update({ revoked_at: now.toISOString() });
      });
    } catch (error) {
      if (error instanceof HumanSessionError) throw error;
      const code = (error as { code?: string }).code || '';
      if (code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HumanSessionError('human_handoff_replayed', 409);
      throw error;
    }
    return { token: rawSession, session: row };
  }

  async authenticate(token: string, config: HumanSessionConfig): Promise<HumanSession | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = await this.db<HumanSession>('human_sessions').where({ session_hash: humanHash(`session:${token}`) }).whereNull('revoked_at').where('expires_at', '>', this.clock().toISOString()).first();
    if (!row || !Object.hasOwn(config.issuer.keys, row.key_id)) return null;
    const binding = config.bindings.find(item => item.id === row.binding_id);
    if (!binding || row.tenant_key !== binding.tenantKey || row.user_id !== binding.userId || row.trust_fingerprint !== humanTrustFingerprint(config, binding, row.key_id)) return null;
    return row;
  }

  async revoke(id: string): Promise<void> {
    await this.db('human_sessions').where({ id }).whereNull('revoked_at').update({ revoked_at: this.clock().toISOString() });
  }

  async revokeSubject(tenantKey: string, userId: string): Promise<number> {
    return this.db('human_sessions').where({ tenant_key: tenantKey, user_id: userId }).whereNull('revoked_at').update({ revoked_at: this.clock().toISOString() });
  }
}

export function humanSessionView(session: HumanSession, token: string) {
  return { authenticated: true, tenantKey: session.tenant_key, userId: session.user_id,
    scopes: JSON.parse(session.scopes_json) as HumanScope[], expiresAt: session.expires_at,
    csrfToken: csrfForHumanSession(token), action_authority: 'none' };
}
