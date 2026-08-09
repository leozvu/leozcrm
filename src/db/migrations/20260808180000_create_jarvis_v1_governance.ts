import type { Knex } from 'knex';
import { JARVIS_V1_TABLES } from '../../domain/jarvisV1';

function sqlite(knex: Knex): boolean { return String(knex.client.config.client).includes('sqlite'); }

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
  const table = JARVIS_V1_TABLES.dataRequests;
  await knex.schema.createTable(table, (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.string('schema_version', 64).notNullable();
    t.string('kind', 16).notNullable();
    t.string('scope', 64).notNullable();
    t.string('idempotency_key', 128).notNullable();
    t.string('request_hash', 80).notNullable();
    t.string('confirmation_hash', 80).notNullable();
    t.string('status', 64).notNullable();
    t.string('requested_by', 32).notNullable();
    t.timestamp('requested_at').notNullable();
    t.string('request_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_jarvis_data_request_tenant_id' });
    t.unique(['tenant_id', 'idempotency_key'], { indexName: 'uq_jarvis_data_request_idempotency' });
    t.index(['tenant_id', 'requested_at'], 'idx_jarvis_data_request_timeline');
  });
  await immutable(knex, table);
}

export async function down(knex: Knex): Promise<void> {
  const table = JARVIS_V1_TABLES.dataRequests;
  await dropImmutable(knex, table);
  await knex.schema.dropTableIfExists(table);
}
