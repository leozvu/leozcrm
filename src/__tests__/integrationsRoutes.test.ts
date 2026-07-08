/**
 * HTTP route-level contract tests for the placeholder integration registry
 * (Milestone #6). Boots the real Express app via createApp() over an ephemeral
 * port and asserts the read-only metadata surface — and that there is NO
 * action/publish endpoint, so the HTTP layer cannot trigger an external action.
 *
 * The registry has no DB dependency, so this suite needs no seeded connection.
 *
 * Run: npm test
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../http/app';
import { TEST_AUTH, adminHeaders } from './support/authHarness';

let server: Server;
let baseUrl: string;

before(async () => {
  const app = createApp({ auth: TEST_AUTH });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

async function req(
  path: string,
  method = 'GET',
): Promise<{ status: number; contentType: string; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: adminHeaders() });
  const text = await res.text();
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    body: text.length && /application\/json/.test(res.headers.get('content-type') ?? '')
      ? JSON.parse(text)
      : text,
  };
}

test('GET /integrations — lists channels with per-adapter mode/advisory flags', async () => {
  const { status, contentType, body } = await req('/integrations');
  assert.equal(status, 200);
  assert.match(contentType, /application\/json/);

  assert.deepEqual(
    body.integrations.map((i: any) => i.channel),
    ['facebook', 'tiktok', 'instagram', 'email', 'ai_media'],
  );
  const byChannel = Object.fromEntries(body.integrations.map((i: any) => [i.channel, i]));
  for (const ch of ['tiktok', 'ai_media']) {
    assert.equal(byChannel[ch].mode, 'placeholder');
    assert.equal(byChannel[ch].advisory_only, true);
  }
  // Email is live as of M8A; facebook/instagram are live as of M8B.
  for (const ch of ['email', 'facebook', 'instagram']) {
    assert.equal(byChannel[ch].mode, 'live');
    assert.equal(byChannel[ch].advisory_only, false);
  }
});

test('GET /integrations/:channel — returns one adapter info (live email/social)', async () => {
  const fb = await req('/integrations/facebook');
  assert.equal(fb.status, 200);
  assert.equal(fb.body.mode, 'live');
  assert.equal(fb.body.advisory_only, false);

  const tiktok = await req('/integrations/tiktok');
  assert.equal(tiktok.status, 200);
  assert.equal(tiktok.body.mode, 'placeholder');
  assert.equal(tiktok.body.advisory_only, true);

  const email = await req('/integrations/email');
  assert.equal(email.status, 200);
  assert.equal(email.body.channel, 'email');
  assert.equal(email.body.mode, 'live');
  assert.equal(email.body.advisory_only, false);
  assert.deepEqual(email.body.capabilities, ['send_email']);
});

test('GET /integrations/:channel — 404 for an unknown channel', async () => {
  const { status, body } = await req('/integrations/linkedin');
  assert.equal(status, 404);
  assert.match(body.error, /integration not found/);
});

test('placeholder channels have no publish endpoint (email + social publish are the only action surfaces)', async () => {
  // Email publishes via POST /integrations/email/send (M8A) and facebook/
  // instagram via POST /integrations/social/publish (M8B). Everything else —
  // including per-channel paths that were never mounted — falls through to
  // Express's default 404, so no placeholder action is routed.
  assert.equal((await req('/integrations/facebook/publish', 'POST')).status, 404);
  assert.equal((await req('/integrations/tiktok/publish', 'POST')).status, 404);
  assert.equal((await req('/integrations/ai_media/generate', 'POST')).status, 404);
});

test('GET /integrations — 401 without authentication (no unauthenticated bypass)', async () => {
  const res = await fetch(`${baseUrl}/integrations`); // no Authorization header
  assert.equal(res.status, 401);
  const body = JSON.parse(await res.text());
  assert.equal(body.code, 'unauthenticated');
});

test('GET /integrations — metadata contract exposes no credential-like fields', async () => {
  const { body } = await req('/integrations');
  const serialised = JSON.stringify(body).toLowerCase();
  for (const forbidden of ['token', 'secret', 'client_secret', 'password', 'api_key']) {
    assert.ok(!serialised.includes(forbidden), `integration metadata must not expose "${forbidden}"`);
  }
});
