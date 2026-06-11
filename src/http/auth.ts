import { createHmac, timingSafeEqual } from 'node:crypto';
import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Authentication + tenant isolation for the HTTP layer (Milestone #7, Phase A).
 *
 * The product had no auth and no tenant boundary beyond the `client_id` column.
 * This adds both WITHOUT a schema change:
 *
 *   - A request authenticates with a bearer token (Authorization: Bearer <t>, or
 *     the `x-api-key` header).
 *   - A per-client token is `"<clientId>.<hmac>"` where the HMAC is signed with a
 *     server secret. Verifying it yields the tenant (client_id) the caller may
 *     act within — so the "tenant" is the client itself; no users table needed.
 *   - A separate admin key grants cross-tenant access for internal/operator use
 *     (e.g. listing all clients, the dashboard picker).
 *
 * The middleware fails closed: a missing/invalid token is 401, and every route
 * mounted after it is protected. Tenant scope is then enforced per route with
 * `enforceClientScope` (explicit client id → 403 on mismatch) or `scopeAllows`
 * (resource lookups → 404 on cross-tenant, so existence is not leaked).
 */

export interface AuthConfig {
  /** Server secret used to sign/verify per-client tokens. */
  secret: string;
  /** Optional admin key granting cross-tenant access. */
  adminKey?: string;
}

export interface AuthContext {
  /** The tenant (client) this caller is scoped to, or `null` for an admin. */
  clientId: string | null;
  /** True when authenticated with the admin key (cross-tenant access). */
  admin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** Constant-time comparison of two UTF-8 strings (length-safe). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

function hmac(clientId: string, secret: string): string {
  return createHmac('sha256', secret).update(clientId).digest('hex');
}

/** Mint a per-client bearer token: `<clientId>.<hmac(secret, clientId)>`. */
export function signClientToken(clientId: string, secret: string): string {
  return `${clientId}.${hmac(clientId, secret)}`;
}

/** Verify a per-client token; returns the clientId, or `null` if invalid. */
export function verifyClientToken(token: string, secret: string): string | null {
  if (!secret) return null;
  const idx = token.lastIndexOf('.');
  if (idx <= 0 || idx === token.length - 1) return null;
  const clientId = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  return safeEqual(sig, hmac(clientId, secret)) ? clientId : null;
}

/** Pull the bearer token from `Authorization: Bearer` or `x-api-key`. */
function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const t = header.slice('Bearer '.length).trim();
    if (t) return t;
  }
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim()) return apiKey.trim();
  return null;
}

/**
 * Authentication middleware. Sets `req.auth` on success; responds 401 otherwise.
 * Every data route is mounted after this, so there is no unauthenticated path.
 */
export function authenticate(config: AuthConfig): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'authentication required', code: 'unauthenticated' });
      return;
    }
    if (config.adminKey && safeEqual(token, config.adminKey)) {
      req.auth = { clientId: null, admin: true };
      return next();
    }
    const clientId = verifyClientToken(token, config.secret);
    if (!clientId) {
      res.status(401).json({ error: 'invalid token', code: 'invalid_token' });
      return;
    }
    req.auth = { clientId, admin: false };
    next();
  };
}

/** Whether the caller may act on `clientId` (admin, or own tenant). Pure. */
export function scopeAllows(req: Request, clientId: string): boolean {
  const auth = req.auth;
  if (!auth) return false;
  return auth.admin || auth.clientId === clientId;
}

/**
 * Enforce that the caller may act on an explicitly-named `clientId`. Returns
 * true when allowed; otherwise writes the error response (401 unauthenticated /
 * 403 cross-tenant) and returns false.
 */
export function enforceClientScope(req: Request, res: Response, clientId: string): boolean {
  if (!req.auth) {
    res.status(401).json({ error: 'authentication required', code: 'unauthenticated' });
    return false;
  }
  if (scopeAllows(req, clientId)) return true;
  res.status(403).json({ error: 'forbidden: client scope mismatch', code: 'forbidden_tenant' });
  return false;
}

/** Require an admin caller. Returns true, or writes 401/403 and returns false. */
export function requireAdmin(req: Request, res: Response): boolean {
  if (!req.auth) {
    res.status(401).json({ error: 'authentication required', code: 'unauthenticated' });
    return false;
  }
  if (req.auth.admin) return true;
  res.status(403).json({ error: 'forbidden: admin access required', code: 'forbidden_admin' });
  return false;
}

/**
 * Resolve the auth config createApp/server should use. Explicit config wins;
 * otherwise read from the environment. With neither a secret nor an admin key,
 * the app fails closed (every request 401s) rather than silently allowing all.
 */
export function resolveAuthConfig(explicit?: AuthConfig): AuthConfig {
  if (explicit) return explicit;
  return {
    secret: process.env.AUTH_SECRET ?? '',
    adminKey: process.env.ADMIN_API_KEY,
  };
}
