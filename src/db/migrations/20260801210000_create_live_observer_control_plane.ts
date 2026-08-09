import type { Knex } from 'knex';

export const PHASE12_TABLES = {
  events: 'live_observer_events',
  recoveryDrills: 'live_recovery_drills',
} as const;

function isSqlite(knex: Knex): boolean {
  return String(knex.client.config.client).includes('sqlite');
}

async function immutable(knex: Knex, table: string): Promise<void> {
  if (isSqlite(knex)) {
    await knex.raw(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END`);
    await knex.raw(`CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END`);
    return;
  }
  await knex.raw(`CREATE FUNCTION leozops_reject_${table}_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION '${table} is immutable'; END; $$ LANGUAGE plpgsql`);
  await knex.raw(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION leozops_reject_${table}_mutation()`);
  await knex.raw(`CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION leozops_reject_${table}_mutation()`);
}

async function dropImmutable(knex: Knex, table: string): Promise<void> {
  if (isSqlite(knex)) {
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_delete`);
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_update`);
    return;
  }
  await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_delete ON ${table}`);
  await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_update ON ${table}`);
  await knex.raw(`DROP FUNCTION IF EXISTS leozops_reject_${table}_mutation()`);
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable(PHASE12_TABLES.events, (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('source_connection_id').notNullable().references('id').inTable('source_connections').onDelete('RESTRICT');
    t.uuid('cycle_id').notNullable();
    t.integer('sequence').notNullable();
    t.string('invocation_key', 128).notNullable();
    t.string('event_type', 48).notNullable();
    t.string('outcome', 24).notNullable();
    t.string('reason_code', 128).notNullable();
    t.string('correlation_id', 128).notNullable();
    t.string('deployment_fingerprint', 80).notNullable();
    t.string('evidence_fingerprint', 80).notNullable().unique();
    t.timestamp('occurred_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['cycle_id', 'sequence'], { indexName: 'uq_live_observer_cycle_sequence' });
    t.unique(['tenant_id', 'invocation_key', 'event_type'], { indexName: 'uq_live_observer_invocation_event' });
    t.index(['tenant_id', 'occurred_at'], 'idx_live_observer_timeline');
  });

  await knex.schema.createTable(PHASE12_TABLES.recoveryDrills, (t) => {
    t.uuid('id').primary();
    t.string('drill_key', 128).notNullable().unique();
    t.string('kind', 24).notNullable();
    t.string('target_class', 32).notNullable();
    t.string('status', 24).notNullable();
    t.string('artifact_sha256', 80).nullable();
    t.bigInteger('artifact_bytes').nullable();
    t.string('tool_version', 80).notNullable();
    t.string('reason_code', 128).notNullable();
    t.string('deployment_fingerprint', 80).notNullable();
    t.string('evidence_fingerprint', 80).notNullable().unique();
    t.timestamp('started_at').notNullable();
    t.timestamp('completed_at').notNullable();
    t.timestamp('created_at').notNullable();
  });

  await immutable(knex, PHASE12_TABLES.events);
  await immutable(knex, PHASE12_TABLES.recoveryDrills);
}

export async function down(knex: Knex): Promise<void> {
  await dropImmutable(knex, PHASE12_TABLES.recoveryDrills);
  await dropImmutable(knex, PHASE12_TABLES.events);
  await knex.schema.dropTableIfExists(PHASE12_TABLES.recoveryDrills);
  await knex.schema.dropTableIfExists(PHASE12_TABLES.events);
}
