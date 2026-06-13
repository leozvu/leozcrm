import type { Knex } from 'knex';

/**
 * Task Engine schema (Milestone #9): `tasks` and `task_status_events`.
 *
 * Rollback-safe: `down()` drops both tables in strict reverse dependency order,
 * returning the DB to its prior state with no orphaned objects.
 *
 * Portability: written entirely with Knex's schema builder and app-generated
 * UUID keys, so the same file runs unchanged on SQLite (dev/test) and
 * PostgreSQL (production) — consistent with the initial CRM migration.
 */

export async function up(knex: Knex): Promise<void> {
  // ---- tasks : a tracked unit of work owned by a client/tenant ----
  await knex.schema.createTable('tasks', (t) => {
    t.uuid('id').primary();
    t.uuid('client_id').notNullable()
      .references('id').inTable('clients').onDelete('CASCADE');
    t.string('title').notNullable();
    t.text('description').nullable();
    t.string('status').notNullable().defaultTo('open');     // open|in_progress|done|cancelled
    t.string('priority').notNullable().defaultTo('medium'); // low|medium|high
    t.string('assignee').nullable();                        // free-text label (no users table)
    t.string('source_recommendation_code').nullable();      // traceability to a recommendation/brief
    t.timestamp('due_at').nullable();
    t.timestamps(true, true); // created_at, updated_at

    t.index(['client_id'], 'idx_tasks_client_id');
    t.index(['status'], 'idx_tasks_status');
    // Hot path: a client's open work — "tasks for client X by status".
    t.index(['client_id', 'status'], 'idx_tasks_client_status');
    // Target for the audit table's composite FK (same-tenant integrity).
    t.unique(['client_id', 'id'], { indexName: 'uq_tasks_client_id_id' });
  });

  // ---- task_status_events : append-only audit of STATUS changes only ----
  await knex.schema.createTable('task_status_events', (t) => {
    t.uuid('id').primary();
    // Deleting a task removes its audit trail.
    t.uuid('task_id').notNullable()
      .references('id').inTable('tasks').onDelete('CASCADE');
    t.uuid('client_id').notNullable();
    t.string('from_status').nullable(); // null for the initial create event
    t.string('to_status').notNullable();
    t.string('changed_by').nullable();  // 'admin' or the tenant/client id
    t.text('note').nullable();
    // Per-task monotonic order-of-record: the authoritative audit-trail order,
    // independent of `created_at` ties (rapid events can share a millisecond, so
    // a timestamp alone cannot order them — and the initial create event must
    // always sort first). Assigned in app code, 1-based, contiguous per task.
    t.integer('seq').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.index(['task_id'], 'idx_task_events_task_id');
    t.index(['client_id'], 'idx_task_events_client_id');
    // One sequence value per task — makes the trail order explicit and unique.
    t.unique(['task_id', 'seq'], { indexName: 'uq_task_events_task_seq' });
    // Same-tenant integrity: an event's (client_id, task_id) must match a task's
    // (client_id, id) — mirrors the leads→campaigns composite FK pattern.
    t.foreign(['client_id', 'task_id'], 'fk_task_events_same_client')
      .references(['client_id', 'id'])
      .inTable('tasks');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Reverse dependency order so FKs never block a drop.
  await knex.schema.dropTableIfExists('task_status_events');
  await knex.schema.dropTableIfExists('tasks');
}
