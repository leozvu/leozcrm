/**
 * Validation-hardening contract tests (Milestone #7, Phase B). Boots the real
 * app (admin-authenticated, so these focus on input validation rather than
 * tenant scope) and proves malformed input is rejected cleanly — a 400/409,
 * never a 500 — across clients, campaigns, and leads. Also proves the
 * repository-level ownership-reassignment guard.
 *
 * Run: npm test
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import config from '../../knexfile';
import { createApp } from '../http/app';
import { seedFunnelStages } from '../db/fixtures';
import { ClientRepository } from '../repositories/clientRepository';
import { CampaignRepository } from '../repositories/campaignRepository';
import { LeadRepository } from '../repositories/leadRepository';
import { FunnelStageRepository } from '../repositories/funnelStageRepository';
import { ValidationError } from '../errors';
import { TEST_AUTH, adminHeaders } from './support/authHarness';

const db = knexFactory(config.test);
let server: Server;
let baseUrl: string;

let clientX: string;
let clientY: string;
let campaignX: string;
let campaignY: string;
let leadX: string;
let trafficStage: string;

before(async () => {
  await db.migrate.latest();
  await seedFunnelStages(db);
  const clients = new ClientRepository(db);
  const campaigns = new CampaignRepository(db);
  const leads = new LeadRepository(db);
  const stages = new FunnelStageRepository(db);

  clientX = (await clients.create({ name: 'X Co', email: 'x@example.com' })).id;
  clientY = (await clients.create({ name: 'Y Co', email: 'y@example.com' })).id;
  campaignX = (await campaigns.create({ client_id: clientX, name: 'X Camp' })).id;
  campaignY = (await campaigns.create({ client_id: clientY, name: 'Y Camp' })).id;
  trafficStage = (await stages.findByKey('traffic'))!.id;
  leadX = (await leads.create({ client_id: clientX, funnel_stage_id: trafficStage })).id;

  const app = createApp({ knex: db, auth: TEST_AUTH });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await db.destroy();
});

async function send(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...adminHeaders(), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: /json/.test(ct) && text ? JSON.parse(text) : text };
}

// ---- client validation ----

test('client create rejects a malformed email (400, not 500)', async () => {
  const { status, body } = await send('POST', '/clients', { name: 'Bad', email: 'not-an-email' });
  assert.equal(status, 400);
  assert.equal(body.code, 'invalid_email');
});

test('client create rejects an unknown status enum', async () => {
  const { status, body } = await send('POST', '/clients', { name: 'Bad', email: 'ok@example.com', status: 'vip' });
  assert.equal(status, 400);
  assert.equal(body.code, 'invalid_status');
});

// ---- campaign validation ----

test('campaign create rejects an unknown channel and a negative/ non-integer budget', async () => {
  assert.equal((await send('POST', '/campaigns', { client_id: clientX, name: 'C', channel: 'myspace' })).body.code, 'invalid_channel');
  assert.equal((await send('POST', '/campaigns', { client_id: clientX, name: 'C', status: 'archived' })).body.code, 'invalid_status');
  const neg = await send('POST', '/campaigns', { client_id: clientX, name: 'C', budget_cents: -100 });
  assert.equal(neg.status, 400);
  assert.equal(neg.body.code, 'invalid_budget');
  const nonInt = await send('POST', '/campaigns', { client_id: clientX, name: 'C', budget_cents: 'lots' });
  assert.equal(nonInt.status, 400);
  assert.equal(nonInt.body.code, 'invalid_budget');
});

// ---- lead validation ----

test('lead create rejects out-of-range / non-integer score', async () => {
  for (const score of [150, -5, 3.5]) {
    const { status, body } = await send('POST', '/leads', {
      client_id: clientX, funnel_stage_id: trafficStage, score,
    });
    assert.equal(status, 400, `score=${score}`);
    assert.equal(body.code, 'invalid_score');
  }
});

test('lead create rejects a malformed email and unknown status', async () => {
  assert.equal((await send('POST', '/leads', { client_id: clientX, funnel_stage_id: trafficStage, email: 'nope' })).body.code, 'invalid_email');
  assert.equal((await send('POST', '/leads', { client_id: clientX, funnel_stage_id: trafficStage, status: 'banana' })).body.code, 'invalid_status');
});

test('lead create with a cross-client campaign is a clean 409', async () => {
  const { status, body } = await send('POST', '/leads', {
    client_id: clientX, funnel_stage_id: trafficStage, campaign_id: campaignY,
  });
  assert.equal(status, 409);
  assert.equal(body.code, 'campaign_client_mismatch');
});

// ---- bad ids never 500 ----

test('unknown ids return 404, not 500', async () => {
  assert.equal((await send('GET', '/clients/not-a-real-id')).status, 404);
  assert.equal((await send('PATCH', '/campaigns/not-a-real-id', { name: 'x' })).status, 404);
  assert.equal((await send('DELETE', '/leads/not-a-real-id')).status, 404);
});

// ---- ownership reassignment is blocked at the repository (defense in depth) ----

test('repository blocks reassigning a campaign or lead to another client (409)', async () => {
  const campaigns = new CampaignRepository(db);
  const leads = new LeadRepository(db);
  await assert.rejects(
    campaigns.update(campaignX, { client_id: clientY }),
    (e: unknown) => e instanceof ValidationError && e.status === 409 && e.code === 'ownership_reassignment',
  );
  await assert.rejects(
    leads.update(leadX, { client_id: clientY }),
    (e: unknown) => e instanceof ValidationError && e.status === 409 && e.code === 'ownership_reassignment',
  );
});
