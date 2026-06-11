/**
 * Tenant isolation route tests (Milestone #7, Phase A). Boots the real app with
 * auth enabled and proves: no unauthenticated bypass, and a client-scoped caller
 * can only ever reach its own client's data across every protected surface
 * (metrics/brief/recommendations/dashboard, clients, campaigns, leads).
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
import { ClientRepository } from '../repositories/clientRepository';
import { LeadRepository } from '../repositories/leadRepository';
import { FunnelStageRepository } from '../repositories/funnelStageRepository';
import { seedBriefScenario } from './support/briefScenario';
import { TEST_AUTH, adminHeaders, clientHeaders } from './support/authHarness';

const db = knexFactory(config.test);
let server: Server;
let baseUrl: string;
let clientA: string;
let asOf: string;
let clientB: string;
let leadBId: string;

before(async () => {
  ({ clientId: clientA, asOf } = await seedBriefScenario(db));

  // A second tenant with one lead, to prove cross-tenant access is blocked.
  const b = await new ClientRepository(db).create({ name: 'Other Co', email: 'other@example.com' });
  clientB = b.id;
  const traffic = await new FunnelStageRepository(db).findByKey('traffic');
  const lead = await new LeadRepository(db).create({ client_id: clientB, funnel_stage_id: traffic!.id });
  leadBId = lead.id;

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

async function get(path: string, headers?: Record<string, string>) {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  const text = await res.text();
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: /json/.test(ct) && text ? JSON.parse(text) : text };
}

// ---- authentication ----

test('no token is 401 on a protected route', async () => {
  const { status, body } = await get(`/metrics/funnel?clientId=${clientA}`);
  assert.equal(status, 401);
  assert.equal(body.code, 'unauthenticated');
});

test('an invalid token is 401', async () => {
  const { status, body } = await get(`/metrics/funnel?clientId=${clientA}`, {
    authorization: 'Bearer not-a-real-token',
  });
  assert.equal(status, 401);
  assert.equal(body.code, 'invalid_token');
});

test('health stays public (no token required)', async () => {
  const { status, body } = await get('/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

// ---- client-scoped access is limited to its own tenant ----

test('a client token reads its own KPIs but not another tenant’s', async () => {
  const own = await get(`/metrics/funnel?clientId=${clientA}`, clientHeaders(clientA));
  assert.equal(own.status, 200);
  assert.equal(own.body.client_id, clientA);

  const cross = await get(`/metrics/funnel?clientId=${clientB}`, clientHeaders(clientA));
  assert.equal(cross.status, 403);
  assert.equal(cross.body.code, 'forbidden_tenant');
});

test('brief and recommendations enforce the same client scope', async () => {
  assert.equal((await get(`/brief?clientId=${clientB}`, clientHeaders(clientA))).status, 403);
  assert.equal((await get(`/recommendations?clientId=${clientB}`, clientHeaders(clientA))).status, 403);
  assert.equal((await get(`/brief?clientId=${clientA}&asOf=${asOf}`, clientHeaders(clientA))).status, 200);
});

test('listing all clients is admin-only', async () => {
  assert.equal((await get('/clients', clientHeaders(clientA))).status, 403);
  const admin = await get('/clients', adminHeaders());
  assert.equal(admin.status, 200);
  assert.ok(Array.isArray(admin.body));
});

test('a client can read its own client record but not another', async () => {
  assert.equal((await get(`/clients/${clientA}`, clientHeaders(clientA))).status, 200);
  const cross = await get(`/clients/${clientB}`, clientHeaders(clientA));
  assert.equal(cross.status, 403);
  assert.equal(cross.body.code, 'forbidden_tenant');
});

test('a cross-tenant resource is reported as 404 (existence not leaked)', async () => {
  // Client A asking for client B's lead: not found for this tenant.
  assert.equal((await get(`/leads/${leadBId}`, clientHeaders(clientA))).status, 404);
  // Client B can read its own lead.
  const ownerView = await get(`/leads/${leadBId}`, clientHeaders(clientB));
  assert.equal(ownerView.status, 200);
  assert.equal(ownerView.body.client_id, clientB);
});

test('the lead/campaign list is auto-scoped to the caller’s tenant', async () => {
  const aLeads = await get('/leads', clientHeaders(clientA));
  assert.equal(aLeads.status, 200);
  assert.ok(aLeads.body.every((l: any) => l.client_id === clientA));
  assert.ok(!aLeads.body.some((l: any) => l.id === leadBId), 'must not include another tenant’s lead');

  // Explicitly requesting another tenant’s id is forbidden, not silently merged.
  assert.equal((await get(`/leads?clientId=${clientB}`, clientHeaders(clientA))).status, 403);
});

test('the dashboard picker is admin-only; clients see only their own dashboard', async () => {
  assert.equal((await get('/dashboard', clientHeaders(clientA))).status, 403);
  assert.equal((await get(`/dashboard?clientId=${clientB}`, clientHeaders(clientA))).status, 403);
  assert.equal((await get(`/dashboard?clientId=${clientA}&asOf=${asOf}`, clientHeaders(clientA))).status, 200);
  assert.equal((await get('/dashboard', adminHeaders())).status, 200);
});
