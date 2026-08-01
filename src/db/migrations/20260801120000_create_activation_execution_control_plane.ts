import type { Knex } from 'knex';

const TABLES = [
  'activation_execution_policies',
  'activation_execution_kill_switch_events',
  'activation_execution_previews',
  'activation_execution_releases',
  'activation_execution_claims',
  'activation_execution_outcomes',
  'activation_execution_observations',
  'activation_execution_rollbacks',
  'activation_execution_incidents',
  'activation_execution_events',
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
  await knex.schema.createTable('activation_execution_policies', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('source_connection_id').notNullable().references('id').inTable('source_connections').onDelete('RESTRICT');
    t.uuid('phase7_policy_record_id').notNullable().references('id').inTable('activation_ceremony_policies').onDelete('RESTRICT');
    t.uuid('phase7_handoff_id').notNullable().references('id').inTable('activation_ceremony_handoffs').onDelete('RESTRICT');
    t.string('policy_id', 80).notNullable().unique();
    t.string('environment', 16).notNullable();
    t.string('phase7_policy_fingerprint', 80).notNullable();
    t.string('phase7_handoff_fingerprint', 80).notNullable();
    t.string('target_fingerprint', 80).notNullable();
    t.string('adapter_id', 128).notNullable();
    t.string('adapter_version', 128).notNullable();
    t.timestamp('valid_from').notNullable();
    t.timestamp('valid_until').notNullable();
    t.string('policy_fingerprint', 80).notNullable().unique();
    t.text('manifest_json').notNullable();
    t.timestamp('accepted_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['phase7_handoff_id'], { indexName: 'uq_p8_phase7_handoff' });
    t.index(['tenant_id', 'source_connection_id'], 'idx_p8_policy_tenant_source');
  });

  await knex.schema.createTable('activation_execution_kill_switch_events', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('activation_execution_policies').onDelete('RESTRICT');
    t.integer('sequence').notNullable();
    t.string('state', 16).notNullable();
    t.string('actor', 128).notNullable();
    t.string('reason_code', 128).notNullable();
    t.string('evidence_fingerprint', 80).notNullable();
    t.timestamp('occurred_at').notNullable();
    t.string('event_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'sequence'], { indexName: 'uq_p8_kill_sequence' });
  });

  await knex.schema.createTable('activation_execution_previews', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('activation_execution_policies').onDelete('RESTRICT');
    t.string('preview_key', 192).notNullable();
    t.string('adapter_id', 128).notNullable();
    t.string('adapter_version', 128).notNullable();
    t.text('preview_json').notNullable();
    t.string('preview_fingerprint', 80).notNullable().unique();
    t.string('requested_by', 128).notNullable();
    t.timestamp('recorded_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id'], { indexName: 'uq_p8_policy_preview' });
    t.unique(['policy_record_id', 'preview_key'], { indexName: 'uq_p8_preview_key' });
  });

  await knex.schema.createTable('activation_execution_releases', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('activation_execution_policies').onDelete('RESTRICT');
    t.uuid('preview_id').notNullable().references('id').inTable('activation_execution_previews').onDelete('RESTRICT');
    t.string('release_key', 192).notNullable();
    t.string('preview_fingerprint', 80).notNullable();
    t.string('released_by', 128).notNullable();
    t.string('observed_by', 128).notNullable();
    t.string('reason_code', 128).notNullable();
    t.timestamp('released_at').notNullable();
    t.timestamp('expires_at').notNullable();
    t.string('release_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id'], { indexName: 'uq_p8_policy_release' });
    t.unique(['policy_record_id', 'release_key'], { indexName: 'uq_p8_release_key' });
  });

  await knex.schema.createTable('activation_execution_claims', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('activation_execution_policies').onDelete('RESTRICT');
    t.uuid('release_id').notNullable().references('id').inTable('activation_execution_releases').onDelete('RESTRICT');
    t.uuid('preview_id').notNullable().references('id').inTable('activation_execution_previews').onDelete('RESTRICT');
    t.string('activation_key', 192).notNullable();
    t.string('release_fingerprint', 80).notNullable();
    t.string('preview_fingerprint', 80).notNullable();
    t.string('claimed_by', 128).notNullable();
    t.timestamp('claimed_at').notNullable();
    t.timestamp('lease_expires_at').notNullable();
    t.string('claim_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id'], { indexName: 'uq_p8_policy_claim' });
    t.unique(['policy_record_id', 'activation_key'], { indexName: 'uq_p8_activation_key' });
  });

  await knex.schema.createTable('activation_execution_outcomes', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('activation_execution_policies').onDelete('RESTRICT');
    t.uuid('claim_id').notNullable().references('id').inTable('activation_execution_claims').onDelete('RESTRICT');
    t.string('outcome', 16).notNullable();
    t.text('result_json').notNullable();
    t.string('result_fingerprint', 80).notNullable();
    t.timestamp('recorded_at').notNullable();
    t.string('outcome_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['claim_id'], { indexName: 'uq_p8_claim_outcome' });
  });

  await knex.schema.createTable('activation_execution_observations', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('activation_execution_policies').onDelete('RESTRICT');
    t.uuid('outcome_id').notNullable().references('id').inTable('activation_execution_outcomes').onDelete('RESTRICT');
    t.string('observation_key', 192).notNullable();
    t.string('verdict', 16).notNullable();
    t.text('observation_json').notNullable();
    t.string('observation_fingerprint', 80).notNullable();
    t.string('observed_by', 128).notNullable();
    t.timestamp('recorded_at').notNullable();
    t.string('record_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['outcome_id'], { indexName: 'uq_p8_outcome_observation' });
    t.unique(['policy_record_id', 'observation_key'], { indexName: 'uq_p8_observation_key' });
  });

  await knex.schema.createTable('activation_execution_rollbacks', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('activation_execution_policies').onDelete('RESTRICT');
    t.uuid('outcome_id').notNullable().references('id').inTable('activation_execution_outcomes').onDelete('RESTRICT');
    t.string('rollback_key', 192).notNullable();
    t.string('outcome', 16).notNullable();
    t.text('rollback_json').notNullable();
    t.string('rollback_fingerprint', 80).notNullable();
    t.string('authorized_by', 128).notNullable();
    t.string('operated_by', 128).notNullable();
    t.string('reason_code', 128).notNullable();
    t.timestamp('recorded_at').notNullable();
    t.string('record_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['outcome_id'], { indexName: 'uq_p8_outcome_rollback' });
    t.unique(['policy_record_id', 'rollback_key'], { indexName: 'uq_p8_rollback_key' });
  });

  await knex.schema.createTable('activation_execution_incidents', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('activation_execution_policies').onDelete('RESTRICT');
    t.string('incident_key', 192).notNullable();
    t.string('reason_code', 128).notNullable();
    t.string('evidence_fingerprint', 80).notNullable();
    t.string('opened_by', 128).notNullable();
    t.timestamp('opened_at').notNullable();
    t.string('incident_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'incident_key'], { indexName: 'uq_p8_incident_key' });
  });

  await knex.schema.createTable('activation_execution_events', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('activation_execution_policies').onDelete('RESTRICT');
    t.integer('sequence').notNullable();
    t.string('event_type', 40).notNullable();
    t.string('actor', 128).notNullable();
    t.string('reason_code', 128).notNullable();
    t.string('evidence_fingerprint', 80).notNullable();
    t.timestamp('occurred_at').notNullable();
    t.string('event_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'sequence'], { indexName: 'uq_p8_event_sequence' });
  });

  for (const table of TABLES) await addImmutableGuards(knex, table);
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [...TABLES].reverse()) await dropImmutableGuards(knex, table);
  for (const table of [...TABLES].reverse()) await knex.schema.dropTableIfExists(table);
}
