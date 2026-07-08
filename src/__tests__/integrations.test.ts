/**
 * Integration adapter tests (Milestone #6, updated for #8A/#8B/#8C). The
 * connector layer still exposes five channels and `execute` is a no-op for ALL
 * of them (it never sends or posts). AI media remains placeholder/advisory;
 * email is the live Resend adapter (M8A), facebook/instagram are the live Meta
 * Graph adapters (M8B), and tiktok is the live Content Posting adapter (M8C) —
 * their real publishing is a separate, explicit path, not `execute`.
 *
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { IntegrationRegistry } from '../integrations/registry';
import { createDefaultAdapters } from '../integrations/channels';
import { ValidationError } from '../errors';

const registry = new IntegrationRegistry();

test('registry exposes five channels: AI media placeholder, email + facebook + instagram + tiktok live', () => {
  const infos = registry.listInfo();
  assert.deepEqual(
    infos.map((i) => i.channel),
    ['facebook', 'tiktok', 'instagram', 'email', 'ai_media'],
  );
  const byChannel = Object.fromEntries(infos.map((i) => [i.channel, i]));
  assert.equal(byChannel.ai_media.mode, 'placeholder');
  assert.equal(byChannel.ai_media.advisory_only, true);
  assert.ok(byChannel.ai_media.capabilities.length > 0);
  // Live channels can act, but only via their explicit publish paths.
  assert.equal(byChannel.email.mode, 'live');
  assert.equal(byChannel.email.advisory_only, false);
  assert.deepEqual(byChannel.email.capabilities, ['send_email']);
  for (const ch of ['facebook', 'instagram', 'tiktok']) {
    assert.equal(byChannel[ch].mode, 'live');
    assert.equal(byChannel[ch].advisory_only, false);
    assert.deepEqual(byChannel[ch].capabilities, ['publish_post']);
  }
});

test('every adapter execute is a no-op: performed:false, no_op:true (live adapters included)', () => {
  for (const adapter of registry.list()) {
    const capability = adapter.capabilities[0];
    const result = adapter.execute({ capability, payload: {} });
    assert.equal(result.channel, adapter.channel);
    assert.equal(result.mode, adapter.mode);
    assert.equal(result.performed, false);
    assert.equal(result.no_op, true);
  }
});

test('execute echoes payload key names only — never payload values (no secret leakage)', () => {
  // Facebook (live as of M8B) — same no-secret-echo guarantee as before.
  const facebook = registry.get('facebook')!;
  const result = facebook.execute({
    capability: 'publish_post',
    payload: { to: 'lead@example.com', api_key: 'super-secret-token', body: 'hello' },
  });
  // Only key names are retained...
  assert.deepEqual(result.request.payload_keys.sort(), ['api_key', 'body', 'to']);
  // ...and no value appears anywhere in the serialised result.
  const serialised = JSON.stringify(result);
  assert.ok(!serialised.includes('super-secret-token'));
  assert.ok(!serialised.includes('lead@example.com'));
  assert.ok(!serialised.includes('hello'));
});

test('execute rejects a capability the adapter does not declare', () => {
  const facebook = registry.get('facebook')!;
  assert.throws(
    () => facebook.execute({ capability: 'send_email' }),
    (err: unknown) =>
      err instanceof ValidationError && err.status === 400 && err.code === 'unsupported_capability',
  );
});

test('execute performs NO network I/O even when every egress path is armed to throw', () => {
  // Arm every outbound network primitive to throw. A real call would surface as
  // a thrown error; a true no-op stays silent.
  const originals = {
    fetch: (globalThis as any).fetch,
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
    netConnect: net.connect,
    netCreate: net.createConnection,
  };
  const boom = () => {
    throw new Error('network egress attempted — adapters must not make external calls');
  };
  try {
    (globalThis as any).fetch = boom;
    (http as any).request = boom;
    (http as any).get = boom;
    (https as any).request = boom;
    (https as any).get = boom;
    (net as any).connect = boom;
    (net as any).createConnection = boom;

    // execute() must touch no network for ANY adapter — including the live email
    // and social adapters (they acknowledge but never send/post; real publishing
    // is a separate path).
    for (const adapter of createDefaultAdapters()) {
      const result = adapter.execute({
        capability: adapter.capabilities[0],
        payload: { caption: 'x', url: 'https://example.com/should-not-be-fetched' },
      });
      assert.equal(result.performed, false);
      assert.equal(result.no_op, true);
    }
  } finally {
    (globalThis as any).fetch = originals.fetch;
    (http as any).request = originals.httpRequest;
    (http as any).get = originals.httpGet;
    (https as any).request = originals.httpsRequest;
    (https as any).get = originals.httpsGet;
    (net as any).connect = originals.netConnect;
    (net as any).createConnection = originals.netCreate;
  }
});

test('get/has resolve known channels and reject unknown ones', () => {
  assert.ok(registry.has('instagram'));
  assert.ok(registry.get('instagram'));
  assert.equal(registry.has('linkedin'), false);
  assert.equal(registry.get('linkedin'), undefined);
});
