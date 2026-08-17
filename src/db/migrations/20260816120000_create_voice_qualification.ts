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
  const consents = VOICE_SESSION_TABLES.consents;
  const reviews = VOICE_SESSION_TABLES.reviews;

  await knex.schema.createTable(consents, (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('session_id').notNullable();
    t.string('schema_version', 64).notNullable();
    t.string('privacy_notice_version', 64).notNullable();
    t.string('capability_profile', 64).notNullable();
    t.boolean('granted').notNullable();
    t.string('granted_by', 64).notNullable();
    t.timestamp('granted_at').notNullable();
    t.string('consent_fingerprint', 80).notNullable().unique();
    t.foreign(['tenant_id', 'session_id'])
      .references(['tenant_id', 'id']).inTable(sessions).onDelete('RESTRICT');
    t.unique(['tenant_id', 'session_id'], { indexName: 'uq_jarvis_voice_consent_session' });
    t.index(['tenant_id', 'granted_at'], 'idx_jarvis_voice_consent_timeline');
  });
  await immutable(knex, consents);

  await knex.schema.createTable(reviews, (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('session_id').notNullable();
    t.string('schema_version', 64).notNullable();
    t.string('idempotency_key', 128).notNullable();
    t.string('request_hash', 80).notNullable();
    t.string('rating', 24).notNullable();
    t.boolean('privacy_concern').notNullable();
    t.string('session_fingerprint', 80).notNullable();
    t.string('event_chain_hash', 80).notNullable();
    t.timestamp('reviewed_at').notNullable();
    t.string('review_fingerprint', 80).notNullable().unique();
    t.foreign(['tenant_id', 'session_id'])
      .references(['tenant_id', 'id']).inTable(sessions).onDelete('RESTRICT');
    t.unique(['tenant_id', 'session_id'], { indexName: 'uq_jarvis_voice_review_session' });
    t.unique(['tenant_id', 'idempotency_key'], { indexName: 'uq_jarvis_voice_review_idempotency' });
    t.index(['tenant_id', 'reviewed_at'], 'idx_jarvis_voice_review_timeline');
  });
  await immutable(knex, reviews);
}

export async function down(knex: Knex): Promise<void> {
  await dropImmutable(knex, VOICE_SESSION_TABLES.reviews);
  await knex.schema.dropTableIfExists(VOICE_SESSION_TABLES.reviews);
  await dropImmutable(knex, VOICE_SESSION_TABLES.consents);
  await knex.schema.dropTableIfExists(VOICE_SESSION_TABLES.consents);
}
