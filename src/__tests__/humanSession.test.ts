import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { Server } from 'node:http';
import knexFactory from 'knex';
import config from '../../knexfile';
import { createApp } from '../http/app';
import { HumanSessionConfig, resolveHumanSessionConfig, verifyHumanHandoff } from '../domain/humanSession';
import { HumanSessionRepository } from '../repositories/humanSessionRepository';
import { seedEgoricMemory } from './support/egoricMemoryScenario';
import { COCKPIT_SCRIPT } from '../http/cockpitScript';

const db = knexFactory(config.test);
const keys = generateKeyPairSync('ed25519');
const initialNow = new Date('2026-09-08T12:00:00Z');
let now = initialNow;
const clock = () => now;
const cfg: HumanSessionConfig = {
  enabled: true, origin: 'http://127.0.0.1:34333', audience: 'leozops-local', sessionSeconds: 900, allowLocalHttp: true,
  issuer: { id: 'egoric-local', authorizeUrl: 'http://127.0.0.1:34334/human/authorize', keys: { test_key: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() } },
  bindings: [{ id: 'founder-binding', subject: 'issuer-human-1', sourceTenant: 'egoric-source', tenantKey: 'sso-company', userId: 'founder-1', scopes: ['cockpit:read', 'advisory:write'] }],
};
const opaque = () => randomBytes(32).toString('base64url');
function handoff(nonce = opaque(), changes: Record<string, unknown> = {}, headerChanges: Record<string, unknown> = {}) {
  const header = { alg: 'EdDSA', typ: 'leozops-human-handoff+jwt', kid: 'test_key', ...headerChanges };
  const seconds = Math.floor(now.getTime() / 1000);
  const claims = { schema_version: 'leozops_human_handoff_v1', iss: cfg.issuer.id, aud: cfg.audience, sub: 'issuer-human-1', source_tenant: 'egoric-source', nonce, jti: opaque(), iat: seconds, exp: seconds + 60, scopes: ['cockpit:read', 'advisory:write'], ...changes };
  const data = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  return `${data}.${sign(null, Buffer.from(data), keys.privateKey).toString('base64url')}`;
}
async function server(options: HumanSessionConfig | null = cfg) {
  const app = createApp({ profile: 'egoric-readonly', knex: db, integrationReadAuth: { secret: 'separate-service-secret' }, humanSession: options, humanSessionClock: clock });
  const instance = app.listen(0);
  await new Promise<void>(resolve => instance.once('listening', resolve));
  const address = instance.address();
  if (!address || typeof address === 'string') throw new Error('test server missing port');
  return { instance, base: `http://127.0.0.1:${address.port}` };
}
async function close(instance: Server) {
  await new Promise<void>((resolve, reject) => { instance.close(error => error ? reject(error) : resolve()); instance.closeAllConnections(); });
}
function cookie(response: Response, name: string): string {
  const header = response.headers.getSetCookie().find(value => value.startsWith(`${name}=`));
  assert.ok(header, `missing cookie ${name}`);
  return header.split(';')[0];
}
async function start(base: string) {
  const response = await fetch(`${base}/auth/human/start`, { method: 'POST', headers: { Origin: cfg.origin, 'X-Leozops-Login': '1', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  const output = await response.json() as { authorizeUrl: string };
  const authorize = new URL(output.authorizeUrl);
  assert.equal(authorize.searchParams.get('redirect_uri'), `${cfg.origin}/cockpit/`);
  return { challenge: cookie(response, 'leozops-login-local'), nonce: authorize.searchParams.get('nonce')! };
}
async function exchange(base: string, challenge: string, token: string) {
  return fetch(`${base}/auth/human/exchange`, { method: 'POST', headers: { Origin: cfg.origin, Cookie: challenge, 'Content-Type': 'application/json' }, body: JSON.stringify({ handoff: token }) });
}
async function login(base: string, changes: Record<string, unknown> = {}) {
  const started = await start(base);
  const response = await exchange(base, started.challenge, handoff(started.nonce, changes));
  assert.equal(response.status, 200);
  const output = await response.json() as { tenantKey: string; userId: string; csrfToken: string; scopes: string[] };
  return { response, output, cookie: cookie(response, 'leozops-human-local') };
}

before(async () => { await db.migrate.latest(); await seedEgoricMemory(db, { tenantKey: 'sso-company' }); });
after(async () => { await db.destroy(); });

test('pinned issuer configuration fails closed and does not infer tenant membership', () => {
  assert.equal(resolveHumanSessionConfig(null), null);
  assert.equal(resolveHumanSessionConfig(cfg)?.bindings[0].userId, 'founder-1');
  for (const change of [{ origin: 'http://external.example' }, { bindings: [] }, { sessionSeconds: 86400 }, { issuer: { ...cfg.issuer, keys: { bad: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() } } }]) {
    assert.throws(() => resolveHumanSessionConfig({ ...cfg, ...change } as HumanSessionConfig), /human_sso_configuration_invalid/);
  }
});

test('handoff rejects wrong issuer/audience/subject/tenant/scopes, algorithm confusion, tampering and invalid lifetimes', () => {
  for (const change of [{ iss: 'attacker' }, { aud: 'other' }, { sub: 'not-approved' }, { source_tenant: 'other-company' }, { scopes: ['cockpit:read', 'command:execute'] }, { scopes: ['cockpit:read', 'voice:use'] }, { exp: Math.floor(now.getTime() / 1000) }, { iat: Math.floor(now.getTime() / 1000) + 30 }, { exp: Math.floor(now.getTime() / 1000) + 1000 }]) {
    assert.throws(() => verifyHumanHandoff(handoff(opaque(), change), cfg, now));
  }
  for (const change of [{ alg: 'HS256' }, { kid: 'unknown' }, { jku: 'https://attacker.example/keys' }]) assert.throws(() => verifyHumanHandoff(handoff(opaque(), {}, change), cfg, now));
  const signed = handoff();
  assert.throws(() => verifyHumanHandoff(signed.slice(0, -4) + 'abcd', cfg, now));
});

test('unconfigured installation serves a disabled human entry without creating sessions or broadening API access', async () => {
  const { instance, base } = await server(null);
  try {
    const output = await (await fetch(`${base}/auth/human/session`)).json() as { enabled: boolean };
    assert.equal(output.enabled, false);
    assert.equal((await fetch(`${base}/auth/human/start`, { method: 'POST' })).status, 503);
    assert.equal((await fetch(`${base}/v1/tenants/sso-company/cockpit`)).status, 401);
    const shell = await (await fetch(`${base}/cockpit`)).text();
    assert.ok(shell.includes('human-signin-button'));
    assert.equal(shell.includes('founder-1'), false);
  } finally { await close(instance); }
});

test('one-time handoff establishes an opaque HttpOnly session, survives repository recreation, and enforces tenant/CSRF scopes', async () => {
  const { instance, base } = await server();
  try {
    const session = await login(base);
    const setCookie = session.response.headers.getSetCookie().find(value => value.startsWith('leozops-human-local='))!;
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/); assert.match(setCookie, /Path=\//);
    assert.equal(session.output.tenantKey, 'sso-company'); assert.equal(session.output.userId, 'founder-1');
    assert.equal(JSON.stringify(session.output).includes('session_hash'), false);
    const raw = session.cookie.split('=')[1];
    const stored = await db('human_sessions').where({ user_id: 'founder-1' }).select('*');
    assert.equal(JSON.stringify(stored).includes(raw), false);
    assert.ok(await new HumanSessionRepository(db, clock).authenticate(raw, cfg));
    const headers = { Cookie: session.cookie };
    assert.equal((await fetch(`${base}/v1/tenants/sso-company/cockpit`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/v1/tenants/other-company/cockpit`, { headers })).status, 403);
    const post = (extra: Record<string, string>) => fetch(`${base}/v1/tenants/sso-company/conversations`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', ...extra }, body: '{}' });
    assert.equal((await post({ Origin: 'https://attacker.example', 'X-Leozops-CSRF': session.output.csrfToken })).status, 403);
    assert.equal((await post({ Origin: cfg.origin })).status, 403);
    assert.equal((await post({ Origin: cfg.origin, 'X-Leozops-CSRF': session.output.csrfToken })).status, 201);
    assert.equal((await fetch(`${base}/v1/tenants/sso-company/jarvis/voice/sessions`, { method: 'POST', headers: { ...headers, Origin: cfg.origin, 'X-Leozops-CSRF': session.output.csrfToken, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${base}/v1/tenants/sso-company/tasks`, { method: 'POST', headers: { ...headers, Origin: cfg.origin, 'X-Leozops-CSRF': session.output.csrfToken } })).status, 404);
  } finally { await close(instance); }
});

test('login CSRF, wrong nonce and replay are rejected; concurrent exchange creates exactly one session', async () => {
  const { instance, base } = await server();
  try {
    assert.equal((await fetch(`${base}/auth/human/start`, { method: 'POST', headers: { Origin: 'https://attacker.example', 'X-Leozops-Login': '1' } })).status, 403);
    const challenge = await start(base);
    assert.equal((await exchange(base, challenge.challenge, handoff())).status, 401);
    const token = handoff(challenge.nonce);
    const count = Number((await db('human_sessions').count({ count: '*' }).first())!.count);
    const responses = await Promise.all([exchange(base, challenge.challenge, token), exchange(base, challenge.challenge, token)]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 401]);
    assert.equal(Number((await db('human_sessions').count({ count: '*' }).first())!.count), count + 1);
    assert.equal((await exchange(base, challenge.challenge, token)).status, 401);
  } finally { await close(instance); }
});

test('HTTPS composition issues host-only Secure cookies and a recreated HTTP app restores only session metadata', async () => {
  const https = structuredClone(cfg);
  https.origin = 'https://cockpit.example'; https.issuer.authorizeUrl = 'https://issuer.example/human/authorize';
  const secureApp = await server(https);
  try {
    const started = await fetch(`${secureApp.base}/auth/human/start`, { method: 'POST', headers: { Origin: https.origin, 'X-Leozops-Login': '1' } });
    const output = await started.json() as { authorizeUrl: string };
    const nonce = new URL(output.authorizeUrl).searchParams.get('nonce')!;
    const response = await fetch(`${secureApp.base}/auth/human/exchange`, { method: 'POST', headers: { Origin: https.origin, Cookie: cookie(started, '__Host-leozops-login'), 'Content-Type': 'application/json' }, body: JSON.stringify({ handoff: handoff(nonce) }) });
    assert.equal(response.status, 200);
    const header = response.headers.getSetCookie().find(value => value.startsWith('__Host-leozops-human='))!;
    assert.match(header, /; Secure/); assert.match(header, /; HttpOnly/); assert.match(header, /SameSite=Strict/);
    assert.equal(header.includes('Domain='), false);
  } finally { await close(secureApp.instance); }
  const first = await server();
  const session = await login(first.base);
  await close(first.instance);
  const restarted = await server();
  try {
    const response = await fetch(`${restarted.base}/auth/human/session`, { headers: { Cookie: session.cookie } });
    const restored = await response.json() as { authenticated: boolean; csrfToken: string; userId: string };
    assert.equal(restored.authenticated, true);
    assert.equal(restored.csrfToken, session.output.csrfToken);
    assert.equal(restored.userId, session.output.userId);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { await close(restarted.instance); }
});

test('expired browser challenge and issuer JTI reuse on a new challenge are rejected', async () => {
  const repository = new HumanSessionRepository(db, clock);
  const expired = await repository.start();
  now = new Date(initialNow.getTime() + 121000);
  try { await assert.rejects(repository.exchange(handoff(expired.nonce), expired.challenge, cfg), /human_login_challenge_invalid/); }
  finally { now = initialNow; }
  const jti = opaque();
  const first = await repository.start();
  await repository.exchange(handoff(first.nonce, { jti }), first.challenge, cfg);
  const second = await repository.start();
  await assert.rejects(repository.exchange(handoff(second.nonce, { jti }), second.challenge, cfg), /human_handoff_replayed/);
});

test('read-only human scope cannot write advisory records, and expiry/revoke/logout invalidate the session', async () => {
  const { instance, base } = await server();
  try {
    const readOnly = await login(base, { scopes: ['cockpit:read'] });
    assert.equal((await fetch(`${base}/v1/tenants/sso-company/conversations`, { method: 'POST', headers: { Cookie: readOnly.cookie, Origin: cfg.origin, 'X-Leozops-CSRF': readOnly.output.csrfToken, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const session = await login(base);
    assert.equal((await fetch(`${base}/auth/human/logout`, { method: 'POST', headers: { Cookie: session.cookie, Origin: cfg.origin } })).status, 403);
    assert.equal((await fetch(`${base}/auth/human/logout`, { method: 'POST', headers: { Cookie: session.cookie, Origin: cfg.origin, 'X-Leozops-CSRF': session.output.csrfToken } })).status, 200);
    assert.equal((await fetch(`${base}/v1/tenants/sso-company/cockpit`, { headers: { Cookie: session.cookie } })).status, 401);
    const expiring = await login(base);
    now = new Date(initialNow.getTime() + 901000);
    assert.equal((await fetch(`${base}/v1/tenants/sso-company/cockpit`, { headers: { Cookie: expiring.cookie } })).status, 401);
    now = initialNow;
    const revoked = await login(base);
    await new HumanSessionRepository(db, clock).revokeSubject('sso-company', 'founder-1');
    assert.equal((await fetch(`${base}/v1/tenants/sso-company/cockpit`, { headers: { Cookie: revoked.cookie } })).status, 401);
  } finally { now = initialNow; await close(instance); }
});

test('key removal and subject mapping changes invalidate existing sessions; database failure leaves challenge retryable', async () => {
  const repository = new HumanSessionRepository(db, clock);
  const challenge = await repository.start();
  const token = handoff(challenge.nonce);
  const first = await repository.exchange(token, challenge.challenge, cfg);
  const changed = structuredClone(cfg); changed.bindings[0].userId = 'other-user';
  assert.equal(await repository.authenticate(first.token, changed), null);
  const removed = structuredClone(cfg); removed.issuer.keys = {};
  assert.equal(await repository.authenticate(first.token, removed), null);
  const next = await repository.start();
  const retry = handoff(next.nonce);
  await db.raw("CREATE TRIGGER test_human_session_failure BEFORE INSERT ON human_sessions BEGIN SELECT RAISE(ABORT, 'injected write failure'); END");
  try { await assert.rejects(repository.exchange(retry, next.challenge, cfg)); }
  finally { await db.raw('DROP TRIGGER test_human_session_failure'); }
  assert.ok((await repository.exchange(retry, next.challenge, cfg)).token);
});

test('browser entry clears handoff history before exchange and uses no durable credential storage', () => {
  assert.equal(/localStorage|sessionStorage|\.innerHTML|eval\s*\(/.test(COCKPIT_SCRIPT), false);
  assert.ok(COCKPIT_SCRIPT.indexOf('history.replaceState') < COCKPIT_SCRIPT.indexOf("humanRequest('exchange'"));
  assert.match(COCKPIT_SCRIPT, /X-Leozops-CSRF/);
  assert.match(COCKPIT_SCRIPT, /credentials: state\.humanSession \? 'same-origin' : 'omit'/);
});
