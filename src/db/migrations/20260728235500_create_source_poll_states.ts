import type { Knex } from 'knex';

/**
 * S2.A reliability state for the read-only source poller.
 *
 * Kept one-to-one beside source_connections so adding/rolling back the
 * reliability core never rebuilds the existing identity/ETag table on SQLite.
 * Raw credentials and source payloads are intentionally absent.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('source_poll_states', (t) => {
    t.uuid('source_connection_id').primary();
    t.uuid('tenant_id').notNullable();
    t.string('circuit_state', 16).notNullable().defaultTo('closed');
    t.integer('consecutive_failures').notNullable().defaultTo(0);
    t.timestamp('last_attempt_at').nullable();
    t.timestamp('next_attempt_at').nullable();
    t.timestamp('circuit_opened_at').nullable();
    t.string('last_error_code', 64).nullable();
    t.integer('last_http_status').nullable();
    t.uuid('lease_id').nullable();
    t.timestamp('lease_expires_at').nullable();
    t.integer('revision').notNullable().defaultTo(0);
    t.timestamps(true, true);

    t.foreign(
      ['tenant_id', 'source_connection_id'],
      'fk_source_poll_states_tenant_connection',
    ).references(['tenant_id', 'id']).inTable('source_connections').onDelete('CASCADE');
    t.index(['tenant_id', 'next_attempt_at'], 'idx_source_poll_states_due');
    t.index(['lease_expires_at'], 'idx_source_poll_states_lease');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('source_poll_states');
}
