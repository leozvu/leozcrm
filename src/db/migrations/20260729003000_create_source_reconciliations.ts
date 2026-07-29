import type { Knex } from 'knex';

/**
 * Immutable, non-PII evidence for one exact source/snapshot/brief comparison.
 * The source payload remains in Business Memory; this table stores only safe
 * identifiers, counts, hashes, status, and a bounded error class.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('source_reconciliations', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable();
    t.uuid('source_connection_id').notNullable();
    t.string('business_date', 10).notNullable();
    t.string('business_timezone', 64).notNullable();
    t.timestamp('checked_at').notNullable();
    t.string('status', 16).notNullable();
    t.string('evidence_key', 71).notNullable();
    t.uuid('source_snapshot_row_id').nullable();
    t.string('snapshot_id', 80).nullable();
    t.uuid('intelligence_run_id').nullable()
      .references('id').inTable('intelligence_runs').onDelete('RESTRICT');
    t.string('formula_version', 100).notNullable();
    t.integer('source_total').nullable();
    t.integer('snapshot_total').nullable();
    t.integer('brief_total').nullable();
    t.string('snapshot_facts_hash', 71).nullable();
    t.string('brief_facts_hash', 71).nullable();
    t.string('failure_code', 64).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.foreign(
      ['tenant_id', 'source_connection_id'],
      'fk_reconciliations_tenant_connection',
    ).references(['tenant_id', 'id']).inTable('source_connections').onDelete('RESTRICT');
    t.foreign(
      ['tenant_id', 'source_snapshot_row_id'],
      'fk_reconciliations_tenant_snapshot',
    ).references(['tenant_id', 'id']).inTable('source_snapshots').onDelete('RESTRICT');
    t.unique(
      ['tenant_id', 'source_connection_id', 'evidence_key'],
      { indexName: 'uq_source_reconciliations_evidence' },
    );
    t.index(
      ['tenant_id', 'source_connection_id', 'business_date'],
      'idx_source_reconciliations_daily',
    );
  });

  const client = String(knex.client.config.client);
  if (client.includes('sqlite')) {
    await knex.raw(`
      CREATE TRIGGER source_reconciliations_no_update
      BEFORE UPDATE ON source_reconciliations
      BEGIN
        SELECT RAISE(ABORT, 'source reconciliations are immutable');
      END
    `);
    await knex.raw(`
      CREATE TRIGGER source_reconciliations_no_delete
      BEFORE DELETE ON source_reconciliations
      BEGIN
        SELECT RAISE(ABORT, 'source reconciliations are immutable');
      END
    `);
  } else if (client === 'pg' || client.includes('postgres')) {
    await knex.raw(`
      CREATE FUNCTION leozops_reject_source_reconciliation_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'source reconciliations are immutable';
      END;
      $$ LANGUAGE plpgsql
    `);
    await knex.raw(`
      CREATE TRIGGER source_reconciliations_no_update
      BEFORE UPDATE ON source_reconciliations
      FOR EACH ROW EXECUTE FUNCTION leozops_reject_source_reconciliation_mutation()
    `);
    await knex.raw(`
      CREATE TRIGGER source_reconciliations_no_delete
      BEFORE DELETE ON source_reconciliations
      FOR EACH ROW EXECUTE FUNCTION leozops_reject_source_reconciliation_mutation()
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  const client = String(knex.client.config.client);
  if (client.includes('sqlite')) {
    await knex.raw('DROP TRIGGER IF EXISTS source_reconciliations_no_delete');
    await knex.raw('DROP TRIGGER IF EXISTS source_reconciliations_no_update');
  } else if (client === 'pg' || client.includes('postgres')) {
    await knex.raw(
      'DROP TRIGGER IF EXISTS source_reconciliations_no_delete ON source_reconciliations',
    );
    await knex.raw(
      'DROP TRIGGER IF EXISTS source_reconciliations_no_update ON source_reconciliations',
    );
    await knex.raw('DROP FUNCTION IF EXISTS leozops_reject_source_reconciliation_mutation()');
  }
  await knex.schema.dropTableIfExists('source_reconciliations');
}
