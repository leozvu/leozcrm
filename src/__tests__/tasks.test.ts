/**
 * Task Engine repository + service tests (Milestone #9). Run against an in-memory
 * SQLite database: prove task creation/validation, lifecycle transitions (valid
 * and rejected), the status-change audit trail, ownership-reassignment blocking,
 * and migration reversibility.
 *
 * Run: npm test
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import { ClientRepository } from '../repositories/clientRepository';
import { TaskRepository } from '../repositories/taskRepository';
import { TaskService } from '../services/taskService';
import { ValidationError } from '../errors';

const db = knexFactory(config.test);
const service = new TaskService(new TaskRepository(db));
const repo = new TaskRepository(db);

let clientId: string;

const isValidation = (status: number, code: string) => (err: unknown) =>
  err instanceof ValidationError && err.status === status && err.code === code;

before(async () => {
  await db.migrate.latest();
  clientId = (await new ClientRepository(db).create({ name: 'Acme', email: 'acme-tasks@example.com' })).id;
});

after(async () => {
  await db.destroy();
});

test('create defaults to open and records the initial status as the first audit event', async () => {
  const task = await service.create(clientId, { title: 'Follow up with lead' }, 'admin');
  assert.equal(task.client_id, clientId);
  assert.equal(task.status, 'open');
  assert.equal(task.priority, 'medium');

  const events = await service.statusEvents(task.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].from_status, null);
  assert.equal(events[0].to_status, 'open');
  assert.equal(events[0].changed_by, 'admin');
});

test('create rejects malformed input cleanly (400)', async () => {
  await assert.rejects(service.create(clientId, { title: '' }), isValidation(400, 'invalid_title'));
  await assert.rejects(service.create(clientId, { title: 'x', priority: 'urgent' }), isValidation(400, 'invalid_priority'));
  await assert.rejects(service.create(clientId, { title: 'x', due_at: 'not-a-date' }), isValidation(400, 'invalid_due_at'));
  // A malformed client id is rejected by shape (invalid_client); a well-formed
  // but nonexistent one is rejected by the FK front-door (unknown_client).
  await assert.rejects(service.create('does-not-exist', { title: 'x' }), isValidation(400, 'invalid_client'));
  await assert.rejects(service.create('99999999-9999-4999-8999-999999999999', { title: 'x' }), isValidation(400, 'unknown_client'));
  // A task may not be created already-terminal.
  await assert.rejects(service.create(clientId, { title: 'x', status: 'done' }), isValidation(400, 'invalid_status'));
});

test('a full legal lifecycle transitions and appends an audit event per change', async () => {
  const task = await service.create(clientId, { title: 'Lifecycle', priority: 'high' });

  const inProgress = await service.transition(task, 'in_progress', { actor: 'admin', note: 'starting' });
  assert.equal(inProgress!.status, 'in_progress');

  const done = await service.transition(inProgress!, 'done', { actor: 'admin' });
  assert.equal(done!.status, 'done');

  const events = await service.statusEvents(task.id);
  assert.deepEqual(
    events.map((e) => ({ from: e.from_status, to: e.to_status })),
    [
      { from: null, to: 'open' },
      { from: 'open', to: 'in_progress' },
      { from: 'in_progress', to: 'done' },
    ],
  );
  // The note was captured on the relevant event.
  assert.equal(events[1].note, 'starting');
});

test('illegal transitions are rejected (409) and write no audit event', async () => {
  const task = await service.create(clientId, { title: 'No skipping' });

  // open → done is not a legal transition.
  await assert.rejects(service.transition(task, 'done'), isValidation(409, 'invalid_transition'));
  // unknown status value is a clean 400.
  await assert.rejects(service.transition(task, 'archived'), isValidation(400, 'invalid_status'));

  // Cancel it (terminal), then prove terminal states have no exits.
  const cancelled = await service.transition(task, 'cancelled');
  assert.equal(cancelled!.status, 'cancelled');
  await assert.rejects(service.transition(cancelled!, 'open'), isValidation(409, 'invalid_transition'));

  // Audit trail recorded only the create + the one legal cancel.
  const events = await service.statusEvents(task.id);
  assert.deepEqual(events.map((e) => e.to_status), ['open', 'cancelled']);
});

test('field updates do not change status and do not write audit events', async () => {
  const task = await service.create(clientId, { title: 'Editable' });
  const updated = await service.updateFields(task.id, { title: 'Edited title', priority: 'low' });
  assert.equal(updated!.title, 'Edited title');
  assert.equal(updated!.priority, 'low');
  assert.equal(updated!.status, 'open');

  const events = await service.statusEvents(task.id);
  assert.equal(events.length, 1, 'editing fields must not append a status event');
});

test('status and ownership cannot be changed through the field-update path', async () => {
  const task = await service.create(clientId, { title: 'Guarded' });
  await assert.rejects(repo.update(task.id, { status: 'done' } as any), isValidation(400, 'status_change_not_allowed'));
  await assert.rejects(repo.update(task.id, { client_id: 'other' } as any), isValidation(409, 'ownership_reassignment'));
});

test('a malformed (non-string / non-UUID) client_id is a clean 400 before any DB query', async () => {
  await assert.rejects(repo.create({ title: 'x', client_id: 12345 } as any), isValidation(400, 'invalid_client'));
  await assert.rejects(repo.create({ title: 'x', client_id: { id: 'x' } } as any), isValidation(400, 'invalid_client'));
  await assert.rejects(repo.create({ title: 'x', client_id: 'not-a-uuid' } as any), isValidation(400, 'invalid_client'));
});

test('field-update validation rejects malformed input (covers the update path)', async () => {
  const task = await service.create(clientId, { title: 'Editable' });
  await assert.rejects(service.updateFields(task.id, { priority: 'urgent' as any }), isValidation(400, 'invalid_priority'));
  await assert.rejects(service.updateFields(task.id, { due_at: 'nope' }), isValidation(400, 'invalid_due_at'));
});

test('a malformed audit note is rejected (400) and never written', async () => {
  const task = await service.create(clientId, { title: 'Noted' });
  await assert.rejects(service.transition(task, 'in_progress', { note: 123 as any }), isValidation(400, 'invalid_note'));
  await assert.rejects(service.transition(task, 'in_progress', { note: 'x'.repeat(1001) }), isValidation(400, 'invalid_note'));
  // The rejected transition wrote no event — only the initial create event exists.
  const events = await service.statusEvents(task.id);
  assert.equal(events.length, 1);
});

test('audit events are deterministically ordered on a timestamp tie (created_at, then id)', async () => {
  const task = await service.create(clientId, { title: 'Tie-break' });
  const sameTs = '2999-01-01T00:00:00.000Z'; // later than the create event
  // Insert out of id order (the "2…" row first) at an identical timestamp.
  await db('task_status_events').insert([
    { id: '22222222-2222-4222-8222-222222222222', task_id: task.id, client_id: clientId, from_status: 'open', to_status: 'in_progress', changed_by: null, note: null, created_at: sameTs },
    { id: '11111111-1111-4111-8111-111111111111', task_id: task.id, client_id: clientId, from_status: 'in_progress', to_status: 'done', changed_by: null, note: null, created_at: sameTs },
  ]);

  const events = await service.statusEvents(task.id);
  // create event first, then the two tied events ordered by id ascending —
  // independent of insertion order, so the trail is fully deterministic.
  assert.equal(events[0].to_status, 'open');
  assert.deepEqual(
    events.slice(1).map((e) => e.id),
    ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
  );
});

test('the task migration is reversible (down drops both tables cleanly)', async () => {
  const fresh = knexFactory(config.test);
  try {
    await fresh.migrate.latest();
    for (const t of ['tasks', 'task_status_events']) {
      assert.ok(await fresh.schema.hasTable(t), `expected ${t} to exist`);
    }
    await fresh.migrate.rollback();
    for (const t of ['tasks', 'task_status_events']) {
      assert.equal(await fresh.schema.hasTable(t), false, `expected ${t} to be dropped`);
    }
  } finally {
    await fresh.destroy();
  }
});
