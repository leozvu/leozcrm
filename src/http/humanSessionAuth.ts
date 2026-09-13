import { timingSafeEqual } from 'node:crypto';
import { Router, json, Request, Response, RequestHandler } from 'express';
import { HumanSessionConfig, HumanSessionError } from '../domain/humanSession';
import { HumanSessionRepository, csrfForHumanSession, humanSessionView } from '../repositories/humanSessionRepository';
import { asyncHandler } from './asyncHandler';

const secure = (config: HumanSessionConfig): boolean => config.origin.startsWith('https:');
const sessionName = (config: HumanSessionConfig): string => secure(config) ? '__Host-leozops-human' : 'leozops-human-local';
const challengeName = (config: HumanSessionConfig): string => secure(config) ? '__Host-leozops-login' : 'leozops-login-local';
function cookie(req: Request, name: string): string {
  const values = (req.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  if (values.length !== 1) return '';
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
}
const cookieOptions = (config: HumanSessionConfig, maxAge: number) => ({ httpOnly: true, secure: secure(config), sameSite: 'strict' as const, path: '/', maxAge });
function exactOrigin(req: Request, config: HumanSessionConfig): void {
  if (req.header('Origin') !== config.origin) throw new HumanSessionError('human_origin_rejected', 403);
}
function validCsrf(req: Request, token: string): void {
  const expected = Buffer.from(csrfForHumanSession(token));
  const actual = Buffer.from(req.header('X-Leozops-CSRF') || '');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new HumanSessionError('human_csrf_rejected', 403);
}
function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

export function createHumanSessionRouter(repository: HumanSessionRepository, config: HumanSessionConfig | null): Router {
  const router = Router();
  const attempts = new Map<string, { count: number; until: number }>();
  router.use((_req, res, next) => { noStore(res); next(); });
  router.get('/session', asyncHandler(async (req, res) => {
    if (!config) { res.json({ enabled: false, authenticated: false, code: 'human_sso_not_configured', action_authority: 'none' }); return; }
    const token = cookie(req, sessionName(config));
    const session = token ? await repository.authenticate(token, config) : null;
    res.json(session ? { enabled: true, ...humanSessionView(session, token) } : { enabled: true, authenticated: false, action_authority: 'none' });
  }));
  router.post('/start', json({ limit: '1kb' }), asyncHandler(async (req, res) => {
    if (!config) throw new HumanSessionError('human_sso_not_configured', 503);
    exactOrigin(req, config);
    if (req.header('X-Leozops-Login') !== '1') throw new HumanSessionError('human_origin_rejected', 403);
    const now = Date.now(), address = req.socket.remoteAddress || 'unknown';
    for (const [key, attempt] of attempts) if (attempt.until <= now) attempts.delete(key);
    if (!attempts.has(address) && attempts.size >= 10000) throw new HumanSessionError('human_login_rate_limited', 429);
    const attempt = attempts.get(address) || { count: 0, until: now + 900000 };
    attempt.count += 1; attempts.set(address, attempt);
    if (attempt.count > 20) throw new HumanSessionError('human_login_rate_limited', 429);
    const started = await repository.start();
    const authorize = new URL(config.issuer.authorizeUrl);
    authorize.searchParams.set('audience', config.audience);
    authorize.searchParams.set('nonce', started.nonce);
    authorize.searchParams.set('redirect_uri', `${config.origin}/cockpit/`);
    res.cookie(challengeName(config), started.challenge, cookieOptions(config, 120000));
    res.json({ authorizeUrl: authorize.toString() });
  }));
  router.post('/exchange', json({ limit: '12kb', strict: true }), asyncHandler(async (req, res) => {
    if (!config) throw new HumanSessionError('human_sso_not_configured', 503);
    exactOrigin(req, config);
    const challenge = cookie(req, challengeName(config));
    if (!challenge || !req.body || typeof req.body !== 'object' || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'handoff')) throw new HumanSessionError('human_login_challenge_invalid');
    const previous = cookie(req, sessionName(config));
    const result = await repository.exchange(req.body.handoff, challenge, config, previous);
    res.cookie(sessionName(config), result.token, cookieOptions(config, config.sessionSeconds * 1000));
    res.clearCookie(challengeName(config), cookieOptions(config, 0));
    res.json(humanSessionView(result.session, result.token));
  }));
  router.post('/logout', asyncHandler(async (req, res) => {
    if (!config) throw new HumanSessionError('human_sso_not_configured', 503);
    exactOrigin(req, config);
    const token = cookie(req, sessionName(config));
    if (token) {
      validCsrf(req, token);
      const session = await repository.authenticate(token, config);
      if (session) await repository.revoke(session.id);
    }
    res.clearCookie(sessionName(config), cookieOptions(config, 0));
    res.clearCookie(challengeName(config), cookieOptions(config, 0));
    res.json({ authenticated: false });
  }));
  return router;
}

/** Bearer service callers retain their existing boundary. Cookie callers never
 * inherit admin scope and must prove origin + CSRF for LeozOps-owned writes. */
export function authenticateHumanSession(repository: HumanSessionRepository, config: HumanSessionConfig | null): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    if (!config || req.headers.authorization || req.headers['x-api-key']) { next(); return; }
    const token = cookie(req, sessionName(config));
    if (!token) { next(); return; }
    const session = await repository.authenticate(token, config);
    if (!session) throw new HumanSessionError('human_session_expired');
    const scopes: string[] = JSON.parse(session.scopes_json);
    if (!scopes.includes('cockpit:read')) throw new HumanSessionError('human_scope_rejected', 403);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      exactOrigin(req, config); validCsrf(req, token);
      if (!scopes.includes('advisory:write') || (req.path.includes('/jarvis/voice/') && !scopes.includes('voice:use'))) throw new HumanSessionError('human_scope_rejected', 403);
    }
    req.integrationReadAuth = { tenantKey: session.tenant_key, admin: false, humanUserId: session.user_id, humanSessionId: session.id, scopes };
    noStore(res);
    next();
  });
}
