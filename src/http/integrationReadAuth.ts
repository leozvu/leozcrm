import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, RequestHandler, Response } from 'express';

export interface IntegrationReadAuthConfig {
  secret: string;
  adminKey?: string;
}

export interface IntegrationReadAuthContext {
  tenantKey: string | null;
  admin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      integrationReadAuth?: IntegrationReadAuthContext;
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function signature(tenantKey: string, secret: string): string {
  return createHmac('sha256', secret).update(`egoric-readonly:${tenantKey}`).digest('hex');
}

export function signTenantReadToken(tenantKey: string, secret: string): string {
  return `${tenantKey}.${signature(tenantKey, secret)}`;
}

export function verifyTenantReadToken(token: string, secret: string): string | null {
  if (!secret) return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0 || separator === token.length - 1) return null;
  const tenantKey = token.slice(0, separator);
  const presented = token.slice(separator + 1);
  return safeEqual(presented, signature(tenantKey, secret)) ? tenantKey : null;
}

function extractToken(req: Request): string | null {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    const value = authorization.slice('Bearer '.length).trim();
    if (value) return value;
  }
  const apiKey = req.headers['x-api-key'];
  return typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : null;
}

export function authenticateIntegrationRead(config: IntegrationReadAuthConfig): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'authentication required', code: 'unauthenticated' });
      return;
    }
    if (config.adminKey && safeEqual(token, config.adminKey)) {
      req.integrationReadAuth = { tenantKey: null, admin: true };
      next();
      return;
    }
    const tenantKey = verifyTenantReadToken(token, config.secret);
    if (!tenantKey) {
      res.status(401).json({ error: 'invalid token', code: 'invalid_token' });
      return;
    }
    req.integrationReadAuth = { tenantKey, admin: false };
    next();
  };
}

export function enforceTenantReadScope(req: Request, res: Response, tenantKey: string): boolean {
  const auth = req.integrationReadAuth;
  if (!auth) {
    res.status(401).json({ error: 'authentication required', code: 'unauthenticated' });
    return false;
  }
  if (auth.admin || auth.tenantKey === tenantKey) return true;
  res.status(403).json({ error: 'forbidden: tenant scope mismatch', code: 'forbidden_tenant' });
  return false;
}

export function resolveIntegrationReadAuthConfig(
  explicit?: IntegrationReadAuthConfig,
): IntegrationReadAuthConfig {
  if (explicit) return explicit;
  const config = {
    secret: process.env.LEOZOPS_OUTPUT_AUTH_SECRET ?? '',
    adminKey: process.env.LEOZOPS_OUTPUT_ADMIN_KEY,
  };
  if (
    (process.env.NODE_ENV ?? 'development') === 'production'
    && !config.secret
    && !config.adminKey
  ) {
    throw new Error(
      'LEOZOPS_OUTPUT_AUTH_SECRET or LEOZOPS_OUTPUT_ADMIN_KEY is required in egoric-readonly production mode.',
    );
  }
  return config;
}
