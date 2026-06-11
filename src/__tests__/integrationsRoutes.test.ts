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

let server: Server;
let baseUrl: string;

before(async () => {
  const app = createApp();
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
  const res = await fetch(`${baseUrl}${path}`, { method });
  const text = await res.text();
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    body: text.length && /application\/json/.test(res.headers.get('content-type') ?? '')
      ? JSON.parse(text)
      : text,
  };
}

test('GET /integrations — lists all placeholder adapters as advisory-only', async () => {
  const { status, contentType, body } = await req('/integrations');
  assert.equal(status, 200);
  assert.match(contentType, /application\/json/);

  assert.equal(body.mode, 'placeholder');
  assert.equal(body.advisory_only, true);
  assert.deepEqual(
    body.integrations.map((i: any) => i.channel),
    ['facebook', 'tiktok', 'instagram', 'email', 'ai_media'],
  );
  for (const i of body.integrations) {
    assert.equal(i.mode, 'placeholder');
    assert.equal(i.advisory_only, true);
  }
});

test('GET /integrations/:channel — returns one adapter info', async () => {
  const { status, body } = await req('/integrations/facebook');
  assert.equal(status, 200);
  assert.equal(body.channel, 'facebook');
  assert.equal(body.display_name, 'Facebook');
  assert.deepEqual(body.capabilities, ['publish_post']);
  assert.equal(body.mode, 'placeholder');
  assert.equal(body.advisory_only, true);
});

test('GET /integrations/:channel — 404 for an unknown channel', async () => {
  const { status, body } = await req('/integrations/linkedin');
  assert.equal(status, 404);
  assert.match(body.error, /integration not found/);
});

test('there is no action/publish endpoint — POST to an integration is not routed', async () => {
  // No execute/publish route exists, so a POST falls through to Express's
  // default 404. The HTTP surface cannot trigger any (even no-op) channel action.
  const { status } = await req('/integrations/facebook/publish', 'POST');
  assert.equal(status, 404);
});
