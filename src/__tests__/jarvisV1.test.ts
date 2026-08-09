import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import type { Server } from 'node:http';
import config from '../../knexfile';
import { JARVIS_V1_TABLES, JarvisV1Error } from '../domain/jarvisV1';
import { createApp } from '../http/app';
import { signTenantReadToken } from '../http/integrationReadAuth';
import { DeterministicAdvisorProvider } from '../integrations/advisor/deterministicAdvisorProvider';
import { AdvisorConversationRepository } from '../repositories/advisorConversationRepository';
import { AmbientJarvisRepository } from '../repositories/ambientJarvisRepository';
import { JarvisV1Repository } from '../repositories/jarvisV1Repository';
import { AdvisorEvidenceService } from '../services/advisorEvidenceService';
import { AdvisorConversationService, DEFAULT_ADVISOR_LIMITS } from '../services/advisorConversationService';
import { EgoricBriefService } from '../services/egoricBriefService';
import { JarvisV1Service } from '../services/jarvisV1Service';
import { seedEgoricMemory } from './support/egoricMemoryScenario';

const db = knexFactory(config.test);
const NOW = new Date('2026-08-09T12:00:00.000Z');
const clock = () => new Date(NOW);
const AUTH = { secret: 'jarvis-v1-test-secret', adminKey: 'jarvis-v1-admin' };

before(async () => { await db.migrate.latest(); });
after(async () => { await db.destroy(); });

async function harness(tenantKey: string) {
  const seeded = await seedEgoricMemory(db, { tenantKey, displayName: `Realm ${tenantKey}` });
  const advisorRepository = new AdvisorConversationRepository(db, clock);
  const advisor = new AdvisorConversationService(
    seeded.repository,
    advisorRepository,
    new AdvisorEvidenceService(seeded.repository, new EgoricBriefService(seeded.repository), advisorRepository),
    new DeterministicAdvisorProvider(),
    DEFAULT_ADVISOR_LIMITS,
    clock,
  );
  const repository = new JarvisV1Repository(db, clock);
  const preferences = new AmbientJarvisRepository(db, clock);
  return {
    seeded, advisor, repository,
    service: new JarvisV1Service(repository, seeded.repository, preferences, clock),
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

test('evaluation reports measured quality, citations, latency, cost, and honest sample limits', async () => {
  const run = await harness('jarvis-evaluation');
  const conversation = await run.advisor.createConversation('jarvis-evaluation', 'Evaluation');
  const answer = await run.advisor.ask('jarvis-evaluation', {
    conversationId: conversation.id,
    idempotencyKey: 'evaluation-answer-1',
    question: 'How many total leads are there?',
  });
  await run.advisor.recordFeedback('jarvis-evaluation', { runId: answer.run.id, rating: 'useful' });
  const evaluation = await run.service.evaluation('jarvis-evaluation', 30);
  assert.equal(evaluation.answers.runs, 1);
  assert.equal(evaluation.answers.completed, 1);
  assert.equal(evaluation.answers.reviewed, 1);
  assert.equal(evaluation.answers.useful_rate, 1);
  assert.equal(evaluation.answers.citation_coverage_rate, 1);
  assert.equal(evaluation.answers.cost_microunits, 0);
  assert.equal(evaluation.safety.candidate_status, 'no_recorded_blocker');
  assert.match(evaluation.evaluation_hash, /^sha256:[0-9a-f]{64}$/);
  await assert.rejects(
    () => run.service.evaluation('jarvis-evaluation', 0),
    (error: unknown) => error instanceof JarvisV1Error && error.code === 'invalid_evaluation_window',
  );
});

test('J1-J8 readiness never converts repository evidence into live acceptance', async () => {
  const run = await harness('jarvis-readiness');
  const readiness = await run.service.readiness('jarvis-readiness');
  assert.equal(readiness.overall, 'blocked_external');
  assert.equal(readiness.grants_action_authority, false);
  assert.equal(readiness.checkpoints.length, 8);
  assert.ok(readiness.checkpoints.every((checkpoint) => checkpoint.live_status === 'blocked_external'));
  assert.ok(readiness.checkpoints.find((checkpoint) => checkpoint.checkpoint === 'J8')?.blockers.includes('30_day_live_report_absent'));
  assert.equal(readiness.operator_truth.external_action_registry_enabled_by_default, false);
});

test('confirmed export is sanitized while delete remains an immutable blocked request', async () => {
  const run = await harness('jarvis-governance');
  await assert.rejects(
    () => run.service.requestData('jarvis-governance', {
      kind: 'export', scope: 'tenant_leozops_data', confirmation: 'EXPORT wrong-tenant',
    }, 'export-wrong'),
    (error: unknown) => error instanceof JarvisV1Error && error.code === 'invalid_data_request_confirmation',
  );
  const requested = await run.service.requestData('jarvis-governance', {
    kind: 'export', scope: 'tenant_leozops_data', confirmation: 'EXPORT jarvis-governance',
  }, 'export-1');
  assert.equal(requested.replayed, false);
  assert.equal(requested.request.status, 'ready_for_export');
  const replay = await run.service.requestData('jarvis-governance', {
    kind: 'export', scope: 'tenant_leozops_data', confirmation: 'EXPORT jarvis-governance',
  }, 'export-1');
  assert.equal(replay.replayed, true);
  const exported = await run.service.export('jarvis-governance', requested.request.id);
  const serialized = JSON.stringify(exported);
  assert.equal(serialized.includes('"payload_json":'), false);
  assert.equal(serialized.includes('"credential_sha256":'), false);
  assert.equal(serialized.includes('"external_id":'), false);
  assert.deepEqual(exported.exclusions, [
    'raw_source_payload_json', 'credentials_and_secret_references', 'command_payload_json',
    'provider_request_and_response_bodies', 'cross_tenant_data',
  ]);
  assert.match(exported.export_hash, /^sha256:[0-9a-f]{64}$/);

  const deletion = await run.service.requestData('jarvis-governance', {
    kind: 'delete', scope: 'tenant_leozops_data', confirmation: 'DELETE jarvis-governance',
  }, 'delete-1');
  assert.equal(deletion.request.status, 'blocked_pending_retention_policy');
  assert.match(deletion.request.limitation, /No data was deleted/);
  const row = await db(JARVIS_V1_TABLES.dataRequests).where({ id: deletion.request.id }).first();
  await assert.rejects(() => db(JARVIS_V1_TABLES.dataRequests).where({ id: row.id }).delete());
  await assert.rejects(() => run.service.export('jarvis-governance', deletion.request.id));
});

test('Jarvis v1 HTTP routes are tenant-scoped and export requires a confirmed request', async () => {
  await harness('jarvis-http');
  const app = createApp({
    profile: 'egoric-readonly', knex: db, integrationReadAuth: AUTH,
    advisorProvider: new DeterministicAdvisorProvider(), advisorClock: clock,
  });
  const server = app.listen(0);
  const base = await listen(server);
  const prefix = '/v1/tenants/jarvis-http/jarvis';
  try {
    assert.equal((await fetch(`${base}${prefix}/evaluation`)).status, 401);
    const wrong = { Authorization: `Bearer ${signTenantReadToken('other', AUTH.secret)}` };
    assert.equal((await fetch(`${base}${prefix}/readiness`, { headers: wrong })).status, 403);
    const auth = { Authorization: `Bearer ${signTenantReadToken('jarvis-http', AUTH.secret)}` };
    assert.equal((await fetch(`${base}${prefix}/evaluation?days=0`, { headers: auth })).status, 400);
    assert.equal((await fetch(`${base}${prefix}/evaluation?days=30`, { headers: auth })).status, 200);
    assert.equal((await fetch(`${base}${prefix}/readiness`, { headers: auth })).status, 200);
    const policy = await fetch(`${base}${prefix}/data-policy`, { headers: auth });
    assert.equal(policy.status, 200);
    assert.equal(((await policy.json()) as any).automatic_deletion_enabled, false);
    const create = await fetch(`${base}${prefix}/data-requests`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': 'http-export-1' },
      body: JSON.stringify({ kind: 'export', scope: 'tenant_leozops_data', confirmation: 'EXPORT jarvis-http' }),
    });
    assert.equal(create.status, 201);
    const request = (await create.json()) as any;
    const exported = await fetch(`${base}${prefix}/exports/${request.request.id}`, { headers: auth });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition') ?? '', /sanitized-export\.json/);
    assert.equal(((await exported.json()) as any).tenant.tenant_key, 'jarvis-http');
    assert.equal((await fetch(`${base}${prefix}/exports/00000000-0000-4000-8000-000000000000`, { headers: auth })).status, 404);
  } finally {
    await closeServer(server);
  }
});

test('Jarvis v1 governance migration rolls back and reapplies', async () => {
  await db.migrate.rollback();
  assert.equal(await db.schema.hasTable(JARVIS_V1_TABLES.dataRequests), false);
  await db.migrate.latest();
  assert.equal(await db.schema.hasTable(JARVIS_V1_TABLES.dataRequests), true);
});
