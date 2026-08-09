import type { Knex } from 'knex';

const TABLES = [
  'external_evidence_policies',
  'external_evidence_attestations',
  'external_evidence_assessments',
  'external_evidence_events',
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
  await knex.schema.createTable('external_evidence_policies', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('source_connection_id').notNullable().references('id').inTable('source_connections').onDelete('RESTRICT');
    t.uuid('phase5_policy_record_id').notNullable().references('id').inTable('operational_assurance_policies').onDelete('RESTRICT');
    t.string('policy_id', 80).notNullable().unique();
    t.string('environment', 16).notNullable();
    t.string('phase5_policy_fingerprint', 80).notNullable();
    t.string('phase5_assessment_fingerprint', 80).notNullable();
    t.string('phase5_release_package_fingerprint', 80).notNullable();
    t.timestamp('valid_from').notNullable();
    t.timestamp('valid_until').notNullable();
    t.string('policy_fingerprint', 80).notNullable().unique();
    t.text('manifest_json').notNullable();
    t.timestamp('accepted_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['phase5_policy_record_id', 'phase5_release_package_fingerprint'], { indexName: 'uq_p6_phase5_package' });
    t.index(['tenant_id', 'source_connection_id'], 'idx_p6_policy_tenant_source');
  });

  await knex.schema.createTable('external_evidence_attestations', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('external_evidence_policies').onDelete('RESTRICT');
    t.uuid('attestation_id').notNullable();
    t.string('evidence_type', 80).notNullable();
    t.string('statement', 16).notNullable();
    t.uuid('supersedes_attestation_id').nullable();
    t.string('issuer_role', 32).notNullable();
    t.string('issuer_id', 192).notNullable();
    t.string('key_id', 192).notNullable();
    t.string('nonce', 192).notNullable();
    t.timestamp('issued_at').notNullable();
    t.timestamp('expires_at').notNullable();
    t.text('envelope_json').notNullable();
    t.string('envelope_fingerprint', 80).notNullable().unique();
    t.string('admitted_by', 128).notNullable();
    t.timestamp('admitted_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'attestation_id'], { indexName: 'uq_p6_attestation_id' });
    t.unique(['policy_record_id', 'nonce'], { indexName: 'uq_p6_attestation_nonce' });
    t.index(['policy_record_id', 'evidence_type', 'issued_at'], 'idx_p6_attestation_type_time');
  });

  await knex.schema.createTable('external_evidence_assessments', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('external_evidence_policies').onDelete('RESTRICT');
    t.string('assessment_key', 192).notNullable();
    t.string('policy_fingerprint', 80).notNullable();
    t.string('phase5_release_package_fingerprint', 80).notNullable();
    t.text('matrix_json').notNullable();
    t.string('matrix_fingerprint', 80).notNullable();
    t.string('status', 32).notNullable();
    t.string('release_status', 48).notNullable();
    t.string('assessed_by', 128).notNullable();
    t.timestamp('assessed_at').notNullable();
    t.string('assessment_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'assessment_key'], { indexName: 'uq_p6_assessment_key' });
    t.index(['policy_record_id', 'assessed_at'], 'idx_p6_assessment_policy_time');
  });

  await knex.schema.createTable('external_evidence_events', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('external_evidence_policies').onDelete('RESTRICT');
    t.integer('sequence').notNullable();
    t.string('event_type', 48).notNullable();
    t.string('actor', 128).notNullable();
    t.string('evidence_fingerprint', 80).notNullable();
    t.string('reason_code', 128).notNullable();
    t.timestamp('occurred_at').notNullable();
    t.string('event_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'sequence'], { indexName: 'uq_p6_event_sequence' });
    t.index(['policy_record_id', 'occurred_at'], 'idx_p6_event_policy_time');
  });

  for (const table of TABLES) await addImmutableGuards(knex, table);
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [...TABLES].reverse()) await dropImmutableGuards(knex, table);
  await knex.schema.dropTableIfExists('external_evidence_events');
  await knex.schema.dropTableIfExists('external_evidence_assessments');
  await knex.schema.dropTableIfExists('external_evidence_attestations');
  await knex.schema.dropTableIfExists('external_evidence_policies');
}
