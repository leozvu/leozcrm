import type { Knex } from 'knex';
import { AMBIENT_JARVIS_TABLES } from '../../domain/ambientJarvis';

function sqlite(knex: Knex): boolean {
  return String(knex.client.config.client).includes('sqlite');
}

async function immutable(knex: Knex, table: string): Promise<void> {
  if (sqlite(knex)) {
    await knex.raw(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END`);
    await knex.raw(`CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END`);
    return;
  }
  await knex.raw(`CREATE FUNCTION leozops_reject_${table}_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION '${table} is immutable'; END; $$ LANGUAGE plpgsql`);
  await knex.raw(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION leozops_reject_${table}_mutation()`);
  await knex.raw(`CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION leozops_reject_${table}_mutation()`);
}

async function dropImmutable(knex: Knex, table: string): Promise<void> {
  if (sqlite(knex)) {
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_delete`);
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_update`);
    return;
  }
  await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_delete ON ${table}`);
  await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_update ON ${table}`);
  await knex.raw(`DROP FUNCTION IF EXISTS leozops_reject_${table}_mutation()`);
}

export async function up(knex: Knex): Promise<void> {
  const table = AMBIENT_JARVIS_TABLES.preferences;
  await knex.schema.createTable(table, (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.integer('version').notNullable();
    t.uuid('previous_revision_id').nullable().references('id').inTable(table).onDelete('RESTRICT');
    t.string('idempotency_key', 128).notNullable();
    t.string('request_hash', 80).notNullable();
    t.text('preferences_json').notNullable();
    t.string('preferences_hash', 80).notNullable();
    t.string('created_by', 32).notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_jarvis_preference_tenant_id' });
    t.foreign(['tenant_id', 'previous_revision_id'])
      .references(['tenant_id', 'id']).inTable(table).onDelete('RESTRICT');
    t.unique(['tenant_id', 'version'], { indexName: 'uq_jarvis_preference_version' });
    t.unique(['tenant_id', 'idempotency_key'], { indexName: 'uq_jarvis_preference_idempotency' });
    t.unique(['tenant_id', 'previous_revision_id'], { indexName: 'uq_jarvis_preference_successor' });
    t.index(['tenant_id', 'created_at'], 'idx_jarvis_preference_timeline');
  });
  await immutable(knex, table);
}

export async function down(knex: Knex): Promise<void> {
  const table = AMBIENT_JARVIS_TABLES.preferences;
  await dropImmutable(knex, table);
  await knex(table).update({ previous_revision_id: null });
  await knex.schema.dropTableIfExists(table);
}
