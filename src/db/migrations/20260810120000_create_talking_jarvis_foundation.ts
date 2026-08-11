import type { Knex } from 'knex';
import { VOICE_SESSION_TABLES } from '../../domain/voiceSession';

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
  const sessions = VOICE_SESSION_TABLES.sessions;
  const events = VOICE_SESSION_TABLES.events;
  await knex.schema.createTable(sessions, (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.string('schema_version', 64).notNullable();
    t.string('idempotency_key', 128).notNullable();
    t.string('request_hash', 80).notNullable();
    t.string('locale', 8).notNullable();
    t.string('provider', 32).notNullable();
    t.string('model', 64).notNullable();
    t.string('voice', 32).notNullable();
    t.string('transport', 16).notNullable();
    t.string('action_authority', 16).notNullable();
    t.string('raw_audio_retention', 16).notNullable();
    t.timestamp('session_deadline_at').notNullable();
    t.string('session_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_jarvis_voice_session_tenant_id' });
    t.unique(['tenant_id', 'idempotency_key'], { indexName: 'uq_jarvis_voice_session_idempotency' });
    t.index(['tenant_id', 'created_at'], 'idx_jarvis_voice_session_timeline');
  });
  await immutable(knex, sessions);

  await knex.schema.createTable(events, (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('session_id').notNullable();
    t.string('schema_version', 64).notNullable();
    t.integer('sequence').notNullable();
    t.string('event_key', 128).notNullable();
    t.string('event_type', 64).notNullable();
    t.string('source', 16).notNullable();
    t.string('from_state', 32).notNullable();
    t.string('to_state', 32).notNullable();
    t.timestamp('provider_credential_expires_at').nullable();
    t.string('failure_code', 64).nullable();
    t.timestamp('occurred_at').notNullable();
    t.string('event_fingerprint', 80).notNullable().unique();
    t.foreign(['tenant_id', 'session_id'])
      .references(['tenant_id', 'id']).inTable(sessions).onDelete('RESTRICT');
    t.unique(['tenant_id', 'session_id', 'sequence'], { indexName: 'uq_jarvis_voice_event_sequence' });
    t.unique(['tenant_id', 'session_id', 'event_key'], { indexName: 'uq_jarvis_voice_event_key' });
    t.index(['tenant_id', 'session_id', 'occurred_at'], 'idx_jarvis_voice_event_timeline');
  });
  await immutable(knex, events);
}

export async function down(knex: Knex): Promise<void> {
  await dropImmutable(knex, VOICE_SESSION_TABLES.events);
  await knex.schema.dropTableIfExists(VOICE_SESSION_TABLES.events);
  await dropImmutable(knex, VOICE_SESSION_TABLES.sessions);
  await knex.schema.dropTableIfExists(VOICE_SESSION_TABLES.sessions);
}
