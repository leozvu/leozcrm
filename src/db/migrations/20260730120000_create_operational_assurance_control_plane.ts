import type { Knex } from 'knex';

const TABLES = [
  'operational_assurance_policies',
  'operational_assurance_assessments',
  'operational_assurance_release_packages',
  'operational_assurance_events',
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
  await knex.schema.createTable('operational_assurance_policies', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('source_connection_id').notNullable().references('id').inTable('source_connections').onDelete('RESTRICT');
    t.uuid('g7_policy_record_id').notNullable().references('id').inTable('bounded_autonomy_policies').onDelete('RESTRICT');
    t.string('policy_id', 80).notNullable().unique();
    t.string('environment', 16).notNullable();
    t.string('g7_policy_fingerprint', 80).notNullable();
    t.timestamp('valid_from').notNullable();
    t.timestamp('valid_until').notNullable();
    t.string('policy_fingerprint', 80).notNullable().unique();
    t.text('manifest_json').notNullable();
    t.timestamp('accepted_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['g7_policy_record_id', 'policy_fingerprint'], { indexName: 'uq_p5_policy_g7_fingerprint' });
    t.index(['tenant_id', 'source_connection_id'], 'idx_p5_policy_tenant_source');
  });

  await knex.schema.createTable('operational_assurance_assessments', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('operational_assurance_policies').onDelete('RESTRICT');
    t.string('assessment_key', 192).notNullable();
    t.string('policy_fingerprint', 80).notNullable();
    t.string('g7_policy_fingerprint', 80).notNullable();
    t.text('facts_json').notNullable();
    t.string('facts_fingerprint', 80).notNullable();
    t.text('checks_json').notNullable();
    t.string('local_status', 16).notNullable();
    t.string('external_status', 32).notNullable();
    t.text('external_blockers_json').notNullable();
    t.string('assessed_by', 128).notNullable();
    t.timestamp('assessed_at').notNullable();
    t.string('assessment_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'assessment_key'], { indexName: 'uq_p5_assessment_key' });
    t.index(['policy_record_id', 'assessed_at'], 'idx_p5_assessment_policy_time');
  });

  await knex.schema.createTable('operational_assurance_release_packages', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('operational_assurance_policies').onDelete('RESTRICT');
    t.uuid('assessment_id').notNullable().references('id').inTable('operational_assurance_assessments').onDelete('RESTRICT');
    t.string('package_key', 192).notNullable();
    t.string('policy_fingerprint', 80).notNullable();
    t.string('assessment_fingerprint', 80).notNullable();
    t.string('local_status', 16).notNullable();
    t.string('release_status', 32).notNullable();
    t.text('external_blockers_json').notNullable();
    t.string('reviewed_by', 128).notNullable();
    t.timestamp('reviewed_at').notNullable();
    t.string('package_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'package_key'], { indexName: 'uq_p5_release_package_key' });
    t.unique(['assessment_id'], { indexName: 'uq_p5_release_package_assessment' });
  });

  await knex.schema.createTable('operational_assurance_events', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('operational_assurance_policies').onDelete('RESTRICT');
    t.integer('sequence').notNullable();
    t.string('event_type', 40).notNullable();
    t.string('actor', 128).notNullable();
    t.string('evidence_fingerprint', 80).notNullable();
    t.string('reason_code', 128).notNullable();
    t.timestamp('occurred_at').notNullable();
    t.string('event_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'sequence'], { indexName: 'uq_p5_event_sequence' });
    t.index(['policy_record_id', 'occurred_at'], 'idx_p5_event_policy_time');
  });

  for (const table of TABLES) await addImmutableGuards(knex, table);
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [...TABLES].reverse()) await dropImmutableGuards(knex, table);
  await knex.schema.dropTableIfExists('operational_assurance_events');
  await knex.schema.dropTableIfExists('operational_assurance_release_packages');
  await knex.schema.dropTableIfExists('operational_assurance_assessments');
  await knex.schema.dropTableIfExists('operational_assurance_policies');
}
