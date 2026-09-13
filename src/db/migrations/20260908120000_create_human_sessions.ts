import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('human_login_challenges', table => {
    table.string('challenge_hash', 64).primary();
    table.string('nonce_hash', 64).notNullable();
    table.string('expires_at', 32).notNullable();
    table.string('used_at', 32).nullable();
  });
  await knex.schema.createTable('human_sessions', table => {
    table.uuid('id').primary();
    table.string('session_hash', 64).notNullable().unique();
    table.string('jti_hash', 64).notNullable().unique();
    table.string('tenant_key', 64).notNullable().references('tenant_key').inTable('tenants').onDelete('RESTRICT');
    table.string('user_id', 128).notNullable();
    table.string('binding_id', 128).notNullable();
    table.string('key_id', 128).notNullable();
    table.string('trust_fingerprint', 64).notNullable();
    table.text('scopes_json').notNullable();
    table.string('created_at', 32).notNullable();
    table.string('expires_at', 32).notNullable();
    table.string('revoked_at', 32).nullable();
    table.index(['tenant_key', 'user_id'], 'human_sessions_subject_scope');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('human_sessions');
  await knex.schema.dropTableIfExists('human_login_challenges');
}
