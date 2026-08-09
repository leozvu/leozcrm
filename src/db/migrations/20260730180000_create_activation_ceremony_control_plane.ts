import type { Knex } from 'knex';

const TABLES = [
  'activation_ceremony_policies',
  'activation_ceremony_dossiers',
  'activation_ceremony_verifications',
  'activation_ceremony_handoffs',
  'activation_ceremony_recalls',
  'activation_ceremony_events',
] as const;

function isSqlite(knex: Knex): boolean {
  return String(knex.client.config.client).includes('sqlite');
}

async function addImmutableGuards(knex: Knex, table: string): Promise<void> {
  if (isSqlite(knex)) {
    await knex.raw(`
      CREATE TRIGGER ${table}_no_update
      BEFORE UPDATE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} is immutable');
      END
    `);
    await knex.raw(`
      CREATE TRIGGER ${table}_no_delete
      BEFORE DELETE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} is immutable');
      END
    `);
    return;
  }
  await knex.raw(`
    CREATE FUNCTION leozops_reject_${table}_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION '${table} is immutable';
    END;
    $$ LANGUAGE plpgsql
  `);
  await knex.raw(`
    CREATE TRIGGER ${table}_no_update
    BEFORE UPDATE ON ${table}
    FOR EACH ROW EXECUTE FUNCTION leozops_reject_${table}_mutation()
  `);
  await knex.raw(`
    CREATE TRIGGER ${table}_no_delete
    BEFORE DELETE ON ${table}
    FOR EACH ROW EXECUTE FUNCTION leozops_reject_${table}_mutation()
  `);
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
  await knex.schema.createTable('activation_ceremony_policies', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('source_connection_id').notNullable().references('id').inTable('source_connections').onDelete('RESTRICT');
    t.uuid('phase6_policy_record_id').notNullable().references('id').inTable('external_evidence_policies').onDelete('RESTRICT');
    t.string('policy_id', 80).notNullable().unique();
    t.string('environment', 16).notNullable();
    t.string('phase6_policy_fingerprint', 80).notNullable();
    t.string('phase6_assessment_fingerprint', 80).notNullable();
    t.string('target_fingerprint', 80).notNullable();
    t.timestamp('valid_from').notNullable();
    t.timestamp('valid_until').notNullable();
    t.string('policy_fingerprint', 80).notNullable().unique();
    t.text('manifest_json').notNullable();
    t.timestamp('accepted_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['phase6_policy_record_id', 'phase6_assessment_fingerprint'], { indexName: 'uq_p7_phase6_assessment' });
    t.index(['tenant_id', 'source_connection_id'], 'idx_p7_policy_tenant_source');
  });

  await knex.schema.createTable('activation_ceremony_dossiers', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('activation_ceremony_policies').onDelete('RESTRICT');
    t.string('dossier_key', 192).notNullable();
    t.string('policy_fingerprint', 80).notNullable();
    t.string('phase6_assessment_fingerprint', 80).notNullable();
    t.text('facts_json').notNullable();
    t.string('facts_fingerprint', 80).notNullable();
    t.string('status', 16).notNullable();
    t.string('created_by', 128).notNullable();
    t.timestamp('created_at').notNullable();
    t.string('dossier_fingerprint', 80).notNullable().unique();
    t.unique(['policy_record_id', 'dossier_key'], { indexName: 'uq_p7_dossier_key' });
    t.index(['policy_record_id', 'created_at'], 'idx_p7_dossier_policy_time');
  });

  await knex.schema.createTable('activation_ceremony_verifications', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('activation_ceremony_policies').onDelete('RESTRICT');
    t.uuid('dossier_id').notNullable().references('id').inTable('activation_ceremony_dossiers').onDelete('RESTRICT');
    t.string('verification_key', 192).notNullable();
    t.string('dossier_fingerprint', 80).notNullable();
    t.string('decision', 16).notNullable();
    t.string('reason_code', 128).notNullable();
    t.string('verified_by', 128).notNullable();
    t.timestamp('verified_at').notNullable();
    t.timestamp('expires_at').notNullable();
    t.string('verification_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'verification_key'], { indexName: 'uq_p7_verification_key' });
    t.unique(['dossier_id'], { indexName: 'uq_p7_dossier_verification' });
  });

  await knex.schema.createTable('activation_ceremony_handoffs', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('activation_ceremony_policies').onDelete('RESTRICT');
    t.uuid('dossier_id').notNullable().references('id').inTable('activation_ceremony_dossiers').onDelete('RESTRICT');
    t.uuid('verification_id').notNullable().references('id').inTable('activation_ceremony_verifications').onDelete('RESTRICT');
    t.string('handoff_key', 192).notNullable();
    t.string('policy_fingerprint', 80).notNullable();
    t.string('dossier_fingerprint', 80).notNullable();
    t.string('verification_fingerprint', 80).notNullable();
    t.string('phase6_evidence_set_fingerprint', 80).notNullable();
    t.string('handoff_status', 64).notNullable();
    t.string('activation_status', 24).notNullable();
    t.boolean('external_execution_required').notNullable();
    t.string('sealed_by', 128).notNullable();
    t.timestamp('sealed_at').notNullable();
    t.string('handoff_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'handoff_key'], { indexName: 'uq_p7_handoff_key' });
    t.unique(['policy_record_id'], { indexName: 'uq_p7_policy_handoff' });
    t.unique(['dossier_id'], { indexName: 'uq_p7_dossier_handoff' });
    t.unique(['verification_id'], { indexName: 'uq_p7_verification_handoff' });
  });

  await knex.schema.createTable('activation_ceremony_recalls', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('activation_ceremony_policies').onDelete('RESTRICT');
    t.uuid('handoff_id').notNullable().references('id').inTable('activation_ceremony_handoffs').onDelete('RESTRICT');
    t.string('recall_key', 192).notNullable();
    t.string('handoff_fingerprint', 80).notNullable();
    t.string('reason_code', 128).notNullable();
    t.string('evidence_fingerprint', 80).notNullable();
    t.string('recalled_by', 128).notNullable();
    t.string('verified_by', 128).notNullable();
    t.timestamp('recalled_at').notNullable();
    t.string('recall_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'recall_key'], { indexName: 'uq_p7_recall_key' });
    t.unique(['handoff_id'], { indexName: 'uq_p7_handoff_recall' });
  });

  await knex.schema.createTable('activation_ceremony_events', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('activation_ceremony_policies').onDelete('RESTRICT');
    t.integer('sequence').notNullable();
    t.string('event_type', 40).notNullable();
    t.string('actor', 128).notNullable();
    t.string('evidence_fingerprint', 80).notNullable();
    t.string('reason_code', 128).notNullable();
    t.timestamp('occurred_at').notNullable();
    t.string('event_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'sequence'], { indexName: 'uq_p7_event_sequence' });
    t.index(['policy_record_id', 'occurred_at'], 'idx_p7_event_policy_time');
  });

  for (const table of TABLES) await addImmutableGuards(knex, table);
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [...TABLES].reverse()) await dropImmutableGuards(knex, table);
  await knex.schema.dropTableIfExists('activation_ceremony_events');
  await knex.schema.dropTableIfExists('activation_ceremony_recalls');
  await knex.schema.dropTableIfExists('activation_ceremony_handoffs');
  await knex.schema.dropTableIfExists('activation_ceremony_verifications');
  await knex.schema.dropTableIfExists('activation_ceremony_dossiers');
  await knex.schema.dropTableIfExists('activation_ceremony_policies');
}
