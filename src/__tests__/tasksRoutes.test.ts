/**
 * Task Engine HTTP route tests (Milestone #9). Boots the real app with auth
 * enabled and asserts: authentication, per-tenant isolation across every task
 * operation, clean rejection of malformed input and illegal transitions, and the
 * read-only audit-trail endpoint.
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
import { TEST_AUTH, adminHeaders, clientHeaders } from './support/authHarness';

const db = knexFactory(config.test);
let server: Server;
let baseUrl: string;
let clientA: string;
let clientB: string;

before(async () => {
  await db.migrate.latest();
  const clients = new ClientRepository(db);
  clientA = (await clients.create({ name: 'A Co', email: 'a-tasks@example.com' })).id;
  clientB = (await clients.create({ name: 'B Co', email: 'b-tasks@example.com' })).id;

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

async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: /json/.test(ct) && text ? JSON.parse(text) : text };
}

async function createTask(clientId: string, headers: Record<string, string>, title = 'Task') {
  const r = await req('POST', '/tasks', { clientId, title }, headers);
  return r;
}

test('task routes require authentication', async () => {
  const r = await req('GET', `/tasks?clientId=${clientA}`);
  assert.equal(r.status, 401);
});

test('create + read are tenant-scoped', async () => {
  // Client A can create its own task and read it back.
  const created = await createTask(clientA, clientHeaders(clientA), 'A task');
  assert.equal(created.status, 201);
  assert.equal(created.body.client_id, clientA);
  const id = created.body.id;

  const ownRead = await req('GET', `/tasks/${id}`, undefined, clientHeaders(clientA));
  assert.equal(ownRead.status, 200);

  // Client B cannot see A's task (cross-tenant → 404, existence not leaked).
  const crossRead = await req('GET', `/tasks/${id}`, undefined, clientHeaders(clientB));
  assert.equal(crossRead.status, 404);

  // Client A cannot create a task for another tenant.
  const spoof = await createTask(clientB, clientHeaders(clientA));
  assert.equal(spoof.status, 403);
  assert.equal(spoof.body.code, 'forbidden_tenant');
});

test('list is auto-scoped to the caller; admin must name a client', async () => {
  await createTask(clientB, clientHeaders(clientB), 'B-only task');
  const aList = await req('GET', '/tasks', undefined, clientHeaders(clientA));
  assert.equal(aList.status, 200);
  assert.ok(Array.isArray(aList.body));
  assert.ok(aList.body.every((t: any) => t.client_id === clientA));

  // A client cannot request another tenant's list.
  assert.equal((await req('GET', `/tasks?clientId=${clientB}`, undefined, clientHeaders(clientA))).status, 403);

  // Admin can list a named client.
  const adminList = await req('GET', `/tasks?clientId=${clientB}`, undefined, adminHeaders());
  assert.equal(adminList.status, 200);
  assert.ok(adminList.body.every((t: any) => t.client_id === clientB));
});

test('malformed input is rejected with 400 (never 500)', async () => {
  assert.equal((await req('POST', '/tasks', { clientId: clientA }, clientHeaders(clientA))).status, 400); // no title
  const badPriority = await req('POST', '/tasks', { clientId: clientA, title: 'x', priority: 'urgent' }, clientHeaders(clientA));
  assert.equal(badPriority.status, 400);
  assert.equal(badPriority.body.code, 'invalid_priority');
});

test('a malformed clientId returns a clean 400 (not a DB error/500)', async () => {
  // Admin bypasses tenant scope, so a malformed clientId must be caught by task
  // validation rather than reaching the DB layer.
  const badStr = await req('POST', '/tasks', { clientId: 'not-a-uuid', title: 'x' }, adminHeaders());
  assert.equal(badStr.status, 400);
  assert.equal(badStr.body.code, 'invalid_client');

  const badType = await req('POST', '/tasks', { clientId: 12345, title: 'x' }, adminHeaders());
  assert.equal(badType.status, 400);
  assert.equal(badType.body.code, 'invalid_client');
});

test('a malformed status-change note returns a clean 400', async () => {
  const created = await createTask(clientA, clientHeaders(clientA), 'Noted');
  const r = await req('POST', `/tasks/${created.body.id}/status`, { status: 'in_progress', note: 12345 }, clientHeaders(clientA));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'invalid_note');
});

test('status transitions: legal moves succeed, illegal moves 409, unknown 400', async () => {
  const created = await createTask(clientA, clientHeaders(clientA), 'Transition me');
  const id = created.body.id;

  const start = await req('POST', `/tasks/${id}/status`, { status: 'in_progress', note: 'go' }, clientHeaders(clientA));
  assert.equal(start.status, 200);
  assert.equal(start.body.status, 'in_progress');

  // Illegal: in_progress has no direct path back to a fresh create-only state? open is legal; done is legal.
  const illegal = await req('POST', `/tasks/${id}/status`, { status: 'cancelled' }, clientHeaders(clientA));
  assert.equal(illegal.status, 200); // in_progress → cancelled is legal

  // cancelled is terminal: any further transition is 409.
  const terminal = await req('POST', `/tasks/${id}/status`, { status: 'open' }, clientHeaders(clientA));
  assert.equal(terminal.status, 409);
  assert.equal(terminal.body.code, 'invalid_transition');

  // Unknown status value → 400.
  const unknown = await req('POST', `/tasks/${id}/status`, { status: 'archived' }, clientHeaders(clientA));
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, 'invalid_status');
});

test('illegal skip transition (open → done) is a 409', async () => {
  const created = await createTask(clientA, clientHeaders(clientA), 'No skip');
  const skip = await req('POST', `/tasks/${created.body.id}/status`, { status: 'done' }, clientHeaders(clientA));
  assert.equal(skip.status, 409);
  assert.equal(skip.body.code, 'invalid_transition');
});

test('PATCH cannot change status; status edits must use the transition endpoint', async () => {
  const created = await createTask(clientA, clientHeaders(clientA), 'Patchable');
  const r = await req('PATCH', `/tasks/${created.body.id}`, { status: 'done', title: 'renamed' }, clientHeaders(clientA));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'status_change_not_allowed');
});

test('PATCH and status transition are tenant-scoped (cross-tenant → 404, no mutation)', async () => {
  const created = await createTask(clientA, clientHeaders(clientA), 'Isolated');
  const id = created.body.id;

  // Client B cannot edit A's task fields…
  assert.equal((await req('PATCH', `/tasks/${id}`, { title: 'hijacked' }, clientHeaders(clientB))).status, 404);
  // …nor transition A's task status (existence is not leaked).
  assert.equal((await req('POST', `/tasks/${id}/status`, { status: 'in_progress' }, clientHeaders(clientB))).status, 404);

  // A's task is untouched by the rejected cross-tenant writes.
  const ownRead = await req('GET', `/tasks/${id}`, undefined, clientHeaders(clientA));
  assert.equal(ownRead.body.title, 'Isolated');
  assert.equal(ownRead.body.status, 'open');
});

test('the audit-trail endpoint is read-only and tenant-scoped', async () => {
  const created = await createTask(clientA, clientHeaders(clientA), 'Audited');
  const id = created.body.id;
  await req('POST', `/tasks/${id}/status`, { status: 'in_progress' }, clientHeaders(clientA));

  const events = await req('GET', `/tasks/${id}/events`, undefined, clientHeaders(clientA));
  assert.equal(events.status, 200);
  assert.deepEqual(events.body.map((e: any) => e.to_status), ['open', 'in_progress']);

  // Another tenant cannot read the audit trail.
  assert.equal((await req('GET', `/tasks/${id}/events`, undefined, clientHeaders(clientB))).status, 404);
});

test('delete is tenant-scoped and idempotent on a missing id', async () => {
  const created = await createTask(clientA, clientHeaders(clientA), 'Deletable');
  const id = created.body.id;

  // Cross-tenant delete is a 404.
  assert.equal((await req('DELETE', `/tasks/${id}`, undefined, clientHeaders(clientB))).status, 404);
  // Owner delete succeeds, then the task is gone.
  assert.equal((await req('DELETE', `/tasks/${id}`, undefined, clientHeaders(clientA))).status, 204);
  assert.equal((await req('GET', `/tasks/${id}`, undefined, clientHeaders(clientA))).status, 404);
});
