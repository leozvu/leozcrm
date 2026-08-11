import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import knexFactory from 'knex';
import config from '../../knexfile';
import {
  VOICE_SESSION_EVENT_SCHEMA,
  VOICE_SESSION_REQUEST_SCHEMA,
  VOICE_SESSION_TABLES,
  VoiceSessionError,
  voiceTransition,
} from '../domain/voiceSession';
import { createApp } from '../http/app';
import { signTenantReadToken } from '../http/integrationReadAuth';
import { DeterministicAdvisorProvider } from '../integrations/advisor/deterministicAdvisorProvider';
import {
  DisabledVoiceClientSecretProvider,
  OpenAIRealtimeClientSecretProvider,
  VoiceClientSecretProvider,
} from '../integrations/voice/realtimeClientSecretProvider';
import { VoiceSessionRepository } from '../repositories/voiceSessionRepository';
import { VoiceSessionService } from '../services/voiceSessionService';
import { seedEgoricMemory } from './support/egoricMemoryScenario';

const db = knexFactory(config.test);
const AUTH = { secret: 'phase17-voice-test-secret', adminKey: 'phase17-admin' };
const CLOCK = new Date('2026-08-10T12:00:00.000Z');

class StubVoiceProvider implements VoiceClientSecretProvider {
  readonly issued: Array<{ locale: string; safetyIdentifier: string }> = [];

  configuration() {
    return { provider: 'openai_realtime' as const, model: 'gpt-realtime-2.1' as const, voice: 'marin' as const };
  }

  async issue(input: { locale: 'en' | 'vi'; safetyIdentifier: string }) {
    this.issued.push(input);
    return {
      value: 'ek_phase17_short_lived_test_credential',
      expires_at: Math.floor((CLOCK.getTime() + 60_000) / 1000),
    };
  }
}

before(async () => { await db.migrate.latest(); });
after(async () => { await db.destroy(); });

async function harness(tenantKey: string, provider: VoiceClientSecretProvider = new StubVoiceProvider()) {
  const seeded = await seedEgoricMemory(db, { tenantKey });
  const repository = new VoiceSessionRepository(db, () => new Date(CLOCK));
  return {
    seeded,
    repository,
    provider,
    service: new VoiceSessionService(repository, seeded.repository, provider, () => new Date(CLOCK)),
  };
}

function request(locale: 'en' | 'vi' = 'vi') {
  return { schema_version: VOICE_SESSION_REQUEST_SCHEMA, locale };
}

function event(eventType: string, clientEventId: string) {
  return {
    schema_version: VOICE_SESSION_EVENT_SCHEMA,
    event_type: eventType,
    client_event_id: clientEventId,
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

test('voice lifecycle permits exact barge-in transitions and rejects invalid authority changes', () => {
  assert.equal(voiceTransition('authorizing', 'credential_issued'), 'connecting');
  assert.equal(voiceTransition('connecting', 'connected'), 'listening');
  assert.equal(voiceTransition('listening', 'user_turn_committed'), 'thinking');
  assert.equal(voiceTransition('thinking', 'user_turn_started'), 'interrupted');
  assert.equal(voiceTransition('thinking', 'assistant_response_started'), 'speaking');
  assert.equal(voiceTransition('speaking', 'user_turn_started'), 'interrupted');
  assert.equal(voiceTransition('interrupted', 'user_turn_committed'), 'thinking');
  assert.throws(
    () => voiceTransition('listening', 'assistant_response_started'),
    (error: unknown) => error instanceof VoiceSessionError && error.code === 'invalid_voice_transition',
  );
  assert.throws(
    () => voiceTransition('ended', 'credential_reissued'),
    (error: unknown) => error instanceof VoiceSessionError && error.code === 'voice_session_terminal',
  );
});

test('session and lifecycle evidence are immutable while audio and ephemeral credentials are never persisted', async () => {
  const run = await harness('phase17-evidence');
  const created = await run.service.create('phase17-evidence', request(), 'voice-session-1');
  assert.equal(created.session.state, 'connecting');
  assert.equal(created.session.policy.action_authority, 'none');
  assert.equal(created.session.policy.raw_audio_retention, 'none');
  assert.equal(created.client_secret.value.startsWith('ek_'), true);
  assert.equal((run.provider as StubVoiceProvider).issued[0].safetyIdentifier.length, 64);

  const replay = await run.service.create('phase17-evidence', request(), 'voice-session-1');
  assert.equal(replay.replayed, true);
  assert.equal(replay.session.id, created.session.id);
  assert.equal(replay.session.state, 'connecting');
  await assert.rejects(
    () => run.service.create('phase17-evidence', request(), 'voice-session-1'),
    (error: unknown) => error instanceof VoiceSessionError
      && error.code === 'voice_credential_reissue_exhausted',
  );
  assert.equal((run.provider as StubVoiceProvider).issued.length, 2);

  await run.service.recordClientEvent('phase17-evidence', created.session.id, event('connected', 'client-connected'));
  await run.service.recordClientEvent('phase17-evidence', created.session.id, event('user_turn_started', 'client-speech-1'));
  await run.service.recordClientEvent('phase17-evidence', created.session.id, event('user_turn_committed', 'client-commit-1'));
  await run.service.recordClientEvent('phase17-evidence', created.session.id, event('assistant_response_started', 'client-response-1'));
  const interrupted = await run.service.recordClientEvent(
    'phase17-evidence', created.session.id, event('user_turn_started', 'client-barge-in-1'),
  );
  assert.equal(interrupted.session.state, 'interrupted');
  assert.equal(interrupted.session.event_count, 7);

  const stored = JSON.stringify({
    sessions: await db(VOICE_SESSION_TABLES.sessions).where({ tenant_id: run.seeded.tenant.id }),
    events: await db(VOICE_SESSION_TABLES.events).where({ tenant_id: run.seeded.tenant.id }),
  });
  assert.equal(stored.includes('ek_phase17'), false);
  assert.equal(stored.toLowerCase().includes('audio_payload'), false);
  assert.equal(stored.toLowerCase().includes('transcript'), false);
  await assert.rejects(() => db(VOICE_SESSION_TABLES.sessions)
    .where({ id: created.session.id }).update({ action_authority: 'write' }));
  await assert.rejects(() => db(VOICE_SESSION_TABLES.events)
    .where({ session_id: created.session.id }).delete());
});

test('strict request, event idempotency, terminal sessions, and tenant isolation fail closed', async () => {
  const run = await harness('phase17-isolation');
  const other = await harness('phase17-other');
  await assert.rejects(
    () => run.service.create('phase17-isolation', { ...request(), retain_audio: true }, 'unsupported-audio'),
    (error: unknown) => error instanceof VoiceSessionError && error.code === 'invalid_voice_request',
  );
  const created = await run.service.create('phase17-isolation', request('en'), 'isolated-session');
  await assert.rejects(
    () => other.service.get('phase17-other', created.session.id),
    (error: unknown) => error instanceof VoiceSessionError && error.code === 'voice_session_not_found',
  );
  await run.service.recordClientEvent('phase17-isolation', created.session.id, event('connected', 'same-event'));
  const replay = await run.service.recordClientEvent('phase17-isolation', created.session.id, event('connected', 'same-event'));
  assert.equal(replay.replayed, true);
  await assert.rejects(
    () => run.service.recordClientEvent('phase17-isolation', created.session.id, event('disconnected', 'same-event')),
    (error: unknown) => error instanceof VoiceSessionError && error.code === 'voice_event_idempotency_conflict',
  );
  await run.service.recordClientEvent('phase17-isolation', created.session.id, event('disconnected', 'end-event'));
  await assert.rejects(
    () => run.service.recordClientEvent('phase17-isolation', created.session.id, event('connected', 'after-end')),
    (error: unknown) => error instanceof VoiceSessionError && error.code === 'voice_session_terminal',
  );
});

test('OpenAI client-secret provider uses the current Realtime contract and sanitizes rejection bodies', async () => {
  let captured: { url?: string; init?: RequestInit } = {};
  const expires = Math.floor((Date.now() + 60_000) / 1000);
  const provider = new OpenAIRealtimeClientSecretProvider({
    apiKey: 'server-only-openai-key',
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ value: 'ek_current_realtime_secret_1234', expires_at: expires }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  const issued = await provider.issue({ locale: 'vi', safetyIdentifier: 'privacy-preserving-user-id' });
  assert.equal(issued.expires_at, expires);
  assert.equal(captured.url, 'https://api.openai.com/v1/realtime/client_secrets');
  const headers = captured.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer server-only-openai-key');
  assert.equal(headers['OpenAI-Safety-Identifier'], 'privacy-preserving-user-id');
  const body = JSON.parse(String(captured.init?.body));
  assert.equal(body.session.model, 'gpt-realtime-2.1');
  assert.equal(body.session.audio.output.voice, 'marin');
  assert.equal(body.session.audio.input.turn_detection.interrupt_response, true);
  assert.equal(body.session.instructions.includes('không có quyền thực thi'), true);

  const rejected = new OpenAIRealtimeClientSecretProvider({
    apiKey: 'must-never-leak',
    fetchImpl: async () => new Response('must-never-leak and provider internals', { status: 401 }),
  });
  await assert.rejects(
    () => rejected.issue({ locale: 'en', safetyIdentifier: 'safe-id' }),
    (error: unknown) => error instanceof VoiceSessionError
      && error.code === 'voice_provider_rejected'
      && !error.message.includes('must-never-leak'),
  );
});

test('tenant-authenticated voice API returns no-store secrets and disabled composition fails honestly', async () => {
  const run = await harness('phase17-http');
  const app = createApp({
    profile: 'egoric-readonly',
    knex: db,
    integrationReadAuth: AUTH,
    advisorProvider: new DeterministicAdvisorProvider(),
    voiceClientSecretProvider: run.provider,
    voiceClock: () => new Date(CLOCK),
  });
  const server = app.listen(0);
  const base = await listen(server);
  const path = '/v1/tenants/phase17-http/jarvis/voice/sessions';
  try {
    assert.equal((await fetch(base + path, { method: 'POST' })).status, 401);
    const wrong = { Authorization: `Bearer ${signTenantReadToken('phase17-other', AUTH.secret)}` };
    assert.equal((await fetch(base + path, {
      method: 'POST', headers: { ...wrong, 'Content-Type': 'application/json' }, body: JSON.stringify(request()),
    })).status, 403);
    const auth = { Authorization: `Bearer ${signTenantReadToken('phase17-http', AUTH.secret)}` };
    assert.equal((await fetch(base + path, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(request()),
    })).status, 400);
    const created = await fetch(base + path, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': 'http-voice-1' },
      body: JSON.stringify(request()),
    });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get('cache-control'), 'no-store');
    const payload = await created.json() as any;
    assert.equal(payload.client_secret.value.startsWith('ek_'), true);
    assert.equal(JSON.stringify(payload).includes('tenant_id'), false);
    for (let index = 2; index <= 5; index += 1) {
      const extra = await fetch(base + path, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': `http-voice-${index}` },
        body: JSON.stringify(request()),
      });
      assert.equal(extra.status, 201);
    }
    const rateLimited = await fetch(base + path, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': 'http-voice-6' },
      body: JSON.stringify(request()),
    });
    assert.equal(rateLimited.status, 429);
    assert.equal(rateLimited.headers.get('retry-after'), '60');
    assert.equal(((await rateLimited.json()) as any).code, 'voice_session_rate_limited');
    assert.equal((run.provider as StubVoiceProvider).issued.length, 5);
    assert.equal((await fetch(`${base}/ready`)).status, 200);
    const shell = await fetch(`${base}/cockpit/`);
    const csp = shell.headers.get('content-security-policy') ?? '';
    assert.equal(csp.includes("connect-src 'self' https://api.openai.com"), true);
    assert.equal((await shell.text()).includes('Start Talking Mode'), true);
  } finally {
    await closeServer(server);
  }

  const disabledRun = await harness('phase17-disabled', new DisabledVoiceClientSecretProvider());
  const disabledApp = createApp({
    profile: 'egoric-readonly', knex: db, integrationReadAuth: AUTH,
    advisorProvider: new DeterministicAdvisorProvider(), voiceClientSecretProvider: disabledRun.provider,
    voiceClock: () => new Date(CLOCK),
  });
  const disabledServer = disabledApp.listen(0);
  const disabledBase = await listen(disabledServer);
  try {
    const response = await fetch(`${disabledBase}/v1/tenants/phase17-disabled/jarvis/voice/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${signTenantReadToken('phase17-disabled', AUTH.secret)}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'disabled-voice-1',
      },
      body: JSON.stringify(request()),
    });
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as any).code, 'voice_provider_disabled');
    const failed = await db(VOICE_SESSION_TABLES.events)
      .where({ tenant_id: disabledRun.seeded.tenant.id, event_type: 'provider_failed' }).first();
    assert.equal(failed.failure_code, 'voice_provider_disabled');
  } finally {
    await closeServer(disabledServer);
  }
});

test('Phase 17 migration rolls back and reapplies both immutable evidence tables', async () => {
  await db.migrate.rollback();
  assert.equal(await db.schema.hasTable(VOICE_SESSION_TABLES.sessions), false);
  assert.equal(await db.schema.hasTable(VOICE_SESSION_TABLES.events), false);
  await db.migrate.latest();
  assert.equal(await db.schema.hasTable(VOICE_SESSION_TABLES.sessions), true);
  assert.equal(await db.schema.hasTable(VOICE_SESSION_TABLES.events), true);
});
