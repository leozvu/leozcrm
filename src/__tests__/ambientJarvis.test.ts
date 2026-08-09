import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import type { Server } from 'node:http';
import config from '../../knexfile';
import {
  AMBIENT_JARVIS_PREFERENCE_SCHEMA,
  AMBIENT_JARVIS_TABLES,
  AmbientJarvisError,
  defaultAmbientJarvisPreferences,
} from '../domain/ambientJarvis';
import { createApp } from '../http/app';
import { signTenantReadToken } from '../http/integrationReadAuth';
import { DeterministicAdvisorProvider } from '../integrations/advisor/deterministicAdvisorProvider';
import { AmbientJarvisRepository } from '../repositories/ambientJarvisRepository';
import { AmbientJarvisService } from '../services/ambientJarvisService';
import { seedEgoricMemory } from './support/egoricMemoryScenario';

const db = knexFactory(config.test);
const AUTH = { secret: 'ambient-jarvis-test-secret', adminKey: 'ambient-jarvis-admin' };

before(async () => { await db.migrate.latest(); });
after(async () => { await db.destroy(); });

async function harness(tenantKey: string) {
  const seeded = await seedEgoricMemory(db, { tenantKey });
  const repository = new AmbientJarvisRepository(db, () => new Date('2026-08-08T15:00:00.000Z'));
  return { seeded, repository, service: new AmbientJarvisService(repository, seeded.repository) };
}

function vietnamesePreferences() {
  return {
    schema_version: AMBIENT_JARVIS_PREFERENCE_SCHEMA,
    locale: 'vi' as const,
    briefing_cadence: 'weekdays' as const,
    timezone: 'Asia/Ho_Chi_Minh',
    quiet_hours: { start: '22:30', end: '06:30' },
    voice_output: 'on_demand' as const,
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

test('preferences start with explicit safe defaults and advance as immutable revisions', async () => {
  const run = await harness('ambient-revisions');
  const defaults = await run.service.current('ambient-revisions');
  assert.deepEqual(defaults, {
    preferences: defaultAmbientJarvisPreferences(), revision: null, source: 'defaults',
  });

  const first = await run.service.update('ambient-revisions', vietnamesePreferences(), 'preference-1');
  assert.equal(first.replayed, false);
  assert.equal(first.view.revision.version, 1);
  assert.equal(first.view.preferences.locale, 'vi');
  const replay = await run.service.update('ambient-revisions', vietnamesePreferences(), 'preference-1');
  assert.equal(replay.replayed, true);
  assert.equal(replay.view.revision.id, first.view.revision.id);

  const secondPreferences = { ...vietnamesePreferences(), briefing_cadence: 'daily' as const };
  const second = await run.service.update('ambient-revisions', secondPreferences, 'preference-2');
  assert.equal(second.replayed, false);
  assert.equal(second.view.revision.version, 2);
  assert.notEqual(second.view.revision.fingerprint, first.view.revision.fingerprint);
  const rows = await db(AMBIENT_JARVIS_TABLES.preferences)
    .where({ tenant_id: run.seeded.tenant.id }).orderBy('version');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].previous_revision_id, rows[0].id);
  await assert.rejects(() => db(AMBIENT_JARVIS_TABLES.preferences)
    .where({ id: rows[0].id }).update({ version: 99 }));
  await assert.rejects(() => db(AMBIENT_JARVIS_TABLES.preferences)
    .where({ id: rows[0].id }).delete());
});

test('validation and idempotency fail closed without leaking tenant state', async () => {
  const run = await harness('ambient-validation');
  await run.service.update('ambient-validation', vietnamesePreferences(), 'stable-key');
  await assert.rejects(
    () => run.service.update('ambient-validation', { ...vietnamesePreferences(), locale: 'en' }, 'stable-key'),
    (error: unknown) => error instanceof AmbientJarvisError && error.code === 'preference_idempotency_conflict',
  );
  await assert.rejects(
    () => run.service.update('ambient-validation', { ...vietnamesePreferences(), timezone: 'Not/A_Zone' }, 'bad-zone'),
    (error: unknown) => error instanceof AmbientJarvisError && error.code === 'invalid_preferences',
  );
  await assert.rejects(
    () => run.service.current('missing-ambient-tenant'),
    (error: unknown) => error instanceof AmbientJarvisError && error.code === 'tenant_not_found',
  );
});

test('authenticated preference API is tenant-scoped, strict, idempotent, and PII-minimized', async () => {
  const run = await harness('ambient-http');
  const app = createApp({
    profile: 'egoric-readonly',
    knex: db,
    integrationReadAuth: AUTH,
    advisorProvider: new DeterministicAdvisorProvider(),
  });
  const server = app.listen(0);
  const base = await listen(server);
  const path = '/v1/tenants/ambient-http/jarvis/preferences';
  try {
    assert.equal((await fetch(base + path)).status, 401);
    const wrong = { Authorization: `Bearer ${signTenantReadToken('another-tenant', AUTH.secret)}` };
    assert.equal((await fetch(base + path, { headers: wrong })).status, 403);
    const auth = { Authorization: `Bearer ${signTenantReadToken('ambient-http', AUTH.secret)}` };
    const initial = await fetch(base + path, { headers: auth });
    assert.equal(initial.status, 200);
    assert.equal(((await initial.json()) as any).source, 'defaults');
    assert.equal((await fetch(base + path, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(vietnamesePreferences()),
    })).status, 400);
    const headers = { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': 'http-preferences-1' };
    const created = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(vietnamesePreferences()) });
    assert.equal(created.status, 201);
    const payload = await created.json() as any;
    assert.equal(payload.view.preferences.locale, 'vi');
    assert.equal(JSON.stringify(payload).includes('tenant_id'), false);
    assert.equal((await fetch(base + path, {
      method: 'POST', headers, body: JSON.stringify(vietnamesePreferences()),
    })).status, 200);
    assert.equal((await fetch(base + path, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'unsupported-field' },
      body: JSON.stringify({ ...vietnamesePreferences(), execute_actions: true }),
    })).status, 400);
    assert.equal((await fetch(`${base}/ready`)).status, 200);
  } finally {
    await closeServer(server);
  }
});

test('ambient migration rolls back and reapplies with its immutable guard', async () => {
  await db.migrate.rollback();
  assert.equal(await db.schema.hasTable(AMBIENT_JARVIS_TABLES.preferences), false);
  await db.migrate.latest();
  assert.equal(await db.schema.hasTable(AMBIENT_JARVIS_TABLES.preferences), true);
});
