import type { Knex } from 'knex';

const TABLES = [
  'advisor_conversations',
  'advisor_context_entries',
  'advisor_messages',
  'advisor_runs',
  'advisor_run_results',
  'advisor_citations',
  'advisor_feedback',
] as const;

function isSqlite(knex: Knex): boolean {
  return String(knex.client.config.client).includes('sqlite');
}

async function addImmutableGuards(knex: Knex, table: string): Promise<void> {
  if (isSqlite(knex)) {
    await knex.raw(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END`);
    await knex.raw(`CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END`);
    return;
  }
  await knex.raw(`CREATE FUNCTION leozops_reject_${table}_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION '${table} is immutable'; END; $$ LANGUAGE plpgsql`);
  await knex.raw(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION leozops_reject_${table}_mutation()`);
  await knex.raw(`CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION leozops_reject_${table}_mutation()`);
}

async function dropImmutableGuards(knex: Knex, table: string): Promise<void> {
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
  await knex.schema.createTable('advisor_conversations', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.string('title', 160).nullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_adv_conversation_tenant_id' });
    t.index(['tenant_id', 'created_at'], 'idx_adv_conversation_tenant_created');
  });

  await knex.schema.createTable('advisor_context_entries', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.string('kind', 24).notNullable();
    t.string('context_key', 128).notNullable();
    t.text('content').notNullable();
    t.uuid('replaces_entry_id').nullable();
    t.timestamp('effective_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_adv_context_tenant_id' });
    t.foreign(
      ['tenant_id', 'replaces_entry_id'],
      'fk_adv_context_tenant_replaces',
    ).references(['tenant_id', 'id']).inTable('advisor_context_entries').onDelete('RESTRICT');
    t.index(['tenant_id', 'kind', 'context_key', 'created_at'], 'idx_adv_context_active');
  });

  await knex.schema.createTable('advisor_messages', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('conversation_id').notNullable();
    t.integer('sequence').notNullable();
    t.string('role', 16).notNullable();
    t.text('content').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_adv_message_tenant_id' });
    t.unique(['tenant_id', 'conversation_id', 'sequence'], { indexName: 'uq_adv_message_sequence' });
    t.foreign(
      ['tenant_id', 'conversation_id'],
      'fk_adv_message_tenant_conversation',
    ).references(['tenant_id', 'id']).inTable('advisor_conversations').onDelete('RESTRICT');
    t.index(['tenant_id', 'conversation_id', 'created_at'], 'idx_adv_message_thread');
  });

  await knex.schema.createTable('advisor_runs', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('conversation_id').notNullable();
    t.uuid('user_message_id').notNullable();
    t.string('idempotency_key', 128).notNullable();
    t.string('request_hash', 80).notNullable();
    t.string('provider_key', 128).notNullable();
    t.string('provider_version', 128).notNullable();
    t.timestamp('started_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_adv_run_tenant_id' });
    t.unique(
      ['tenant_id', 'conversation_id', 'idempotency_key'],
      { indexName: 'uq_adv_run_idempotency' },
    );
    t.foreign(
      ['tenant_id', 'conversation_id'],
      'fk_adv_run_tenant_conversation',
    ).references(['tenant_id', 'id']).inTable('advisor_conversations').onDelete('RESTRICT');
    t.foreign(
      ['tenant_id', 'user_message_id'],
      'fk_adv_run_tenant_user_message',
    ).references(['tenant_id', 'id']).inTable('advisor_messages').onDelete('RESTRICT');
    t.index(['tenant_id', 'conversation_id', 'created_at'], 'idx_adv_run_thread');
  });

  await knex.schema.createTable('advisor_run_results', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('run_id').notNullable();
    t.uuid('assistant_message_id').nullable();
    t.string('status', 16).notNullable();
    t.string('evidence_pack_hash', 80).nullable();
    t.string('answer_hash', 80).nullable();
    t.string('failure_code', 128).nullable();
    t.integer('input_units').notNullable().defaultTo(0);
    t.integer('output_units').notNullable().defaultTo(0);
    t.bigInteger('cost_microunits').notNullable().defaultTo(0);
    t.timestamp('completed_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_adv_result_tenant_id' });
    t.unique(['tenant_id', 'run_id'], { indexName: 'uq_adv_result_run' });
    t.foreign(
      ['tenant_id', 'run_id'],
      'fk_adv_result_tenant_run',
    ).references(['tenant_id', 'id']).inTable('advisor_runs').onDelete('RESTRICT');
    t.foreign(
      ['tenant_id', 'assistant_message_id'],
      'fk_adv_result_tenant_assistant',
    ).references(['tenant_id', 'id']).inTable('advisor_messages').onDelete('RESTRICT');
  });

  await knex.schema.createTable('advisor_citations', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('run_id').notNullable();
    t.uuid('assistant_message_id').notNullable();
    t.string('evidence_key', 128).notNullable();
    t.string('source_type', 32).notNullable();
    t.string('source_id', 128).notNullable();
    t.string('source_path', 256).notNullable();
    t.string('value_hash', 80).notNullable();
    t.string('label', 256).notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_adv_citation_tenant_id' });
    t.unique(['tenant_id', 'run_id', 'evidence_key'], { indexName: 'uq_adv_citation_evidence' });
    t.foreign(
      ['tenant_id', 'run_id'],
      'fk_adv_citation_tenant_run',
    ).references(['tenant_id', 'id']).inTable('advisor_runs').onDelete('RESTRICT');
    t.foreign(
      ['tenant_id', 'assistant_message_id'],
      'fk_adv_citation_tenant_message',
    ).references(['tenant_id', 'id']).inTable('advisor_messages').onDelete('RESTRICT');
    t.index(['tenant_id', 'assistant_message_id'], 'idx_adv_citation_message');
  });

  await knex.schema.createTable('advisor_feedback', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('run_id').notNullable();
    t.string('rating', 24).notNullable();
    t.text('note').nullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_adv_feedback_tenant_id' });
    t.unique(['tenant_id', 'run_id'], { indexName: 'uq_adv_feedback_run' });
    t.foreign(
      ['tenant_id', 'run_id'],
      'fk_adv_feedback_tenant_run',
    ).references(['tenant_id', 'id']).inTable('advisor_runs').onDelete('RESTRICT');
  });

  for (const table of TABLES) await addImmutableGuards(knex, table);
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [...TABLES].reverse()) await dropImmutableGuards(knex, table);
  for (const table of [...TABLES].reverse()) await knex.schema.dropTableIfExists(table);
}
