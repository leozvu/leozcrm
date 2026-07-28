import type { Knex } from 'knex';

/**
 * Sprint 1B / G2 Business Memory.
 *
 * These tables are deliberately separate from the legacy CRM `clients`,
 * `campaigns`, and `leads` tables. A LeozOps tenant is a business-isolation
 * boundary; it is never an Egoric customer record.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tenants', (t) => {
    t.uuid('id').primary();
    t.string('tenant_key', 64).notNullable().unique();
    t.string('display_name', 200).notNullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('source_connections', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('RESTRICT');
    t.string('source_system', 64).notNullable();
    t.string('source_tenant_key', 64).notNullable();
    t.string('schema_version', 32).notNullable();
    t.text('endpoint_url').notNullable();
    t.string('status', 32).notNullable().defaultTo('active');
    t.string('last_etag', 200).nullable();
    t.timestamp('last_success_at').nullable();
    t.timestamps(true, true);

    t.unique(
      ['tenant_id', 'source_system', 'source_tenant_key'],
      { indexName: 'uq_source_connections_tenant_source' },
    );
    t.unique(['tenant_id', 'id'], { indexName: 'uq_source_connections_tenant_id' });
    t.index(['tenant_id'], 'idx_source_connections_tenant');
  });

  await knex.schema.createTable('source_snapshots', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable();
    t.uuid('source_connection_id').notNullable();
    t.string('source_system', 64).notNullable();
    t.string('source_tenant_key', 64).notNullable();
    t.string('schema_version', 32).notNullable();
    t.string('snapshot_id', 80).notNullable();
    t.timestamp('generated_at').notNullable();
    t.timestamp('received_at').notNullable();
    t.text('payload_json').notNullable();
    t.integer('record_count').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.unique(
      ['source_system', 'source_tenant_key', 'snapshot_id'],
      { indexName: 'uq_source_snapshots_source_identity' },
    );
    t.unique(['tenant_id', 'id'], { indexName: 'uq_source_snapshots_tenant_id' });
    t.foreign(
      ['tenant_id', 'source_connection_id'],
      'fk_source_snapshots_tenant_connection',
    ).references(['tenant_id', 'id']).inTable('source_connections');
    t.index(['tenant_id', 'received_at'], 'idx_source_snapshots_tenant_received');
  });

  await knex.schema.createTable('intelligence_runs', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable();
    t.uuid('source_snapshot_id').notNullable();
    t.string('snapshot_id', 80).notNullable();
    t.string('engine_version', 100).notNullable();
    t.timestamp('as_of').notNullable();
    t.string('status', 32).notNullable().defaultTo('accepted');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.unique(
      ['tenant_id', 'snapshot_id', 'engine_version', 'as_of'],
      { indexName: 'uq_intelligence_runs_identity' },
    );
    t.foreign(
      ['tenant_id', 'source_snapshot_id'],
      'fk_intelligence_runs_tenant_snapshot',
    ).references(['tenant_id', 'id']).inTable('source_snapshots');
    t.index(['tenant_id', 'created_at'], 'idx_intelligence_runs_tenant_created');
  });

  // Source snapshots are evidence, not mutable application rows. Enforce
  // append-only behavior at the database boundary in both supported dialects.
  const client = String(knex.client.config.client);
  if (client.includes('sqlite')) {
    await knex.raw(`
      CREATE TRIGGER source_snapshots_no_update
      BEFORE UPDATE ON source_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'source snapshots are immutable');
      END
    `);
    await knex.raw(`
      CREATE TRIGGER source_snapshots_no_delete
      BEFORE DELETE ON source_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'source snapshots are immutable');
      END
    `);
  } else if (client === 'pg' || client.includes('postgres')) {
    await knex.raw(`
      CREATE FUNCTION leozops_reject_source_snapshot_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'source snapshots are immutable';
      END;
      $$ LANGUAGE plpgsql
    `);
    await knex.raw(`
      CREATE TRIGGER source_snapshots_no_update
      BEFORE UPDATE ON source_snapshots
      FOR EACH ROW EXECUTE FUNCTION leozops_reject_source_snapshot_mutation()
    `);
    await knex.raw(`
      CREATE TRIGGER source_snapshots_no_delete
      BEFORE DELETE ON source_snapshots
      FOR EACH ROW EXECUTE FUNCTION leozops_reject_source_snapshot_mutation()
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  const client = String(knex.client.config.client);
  if (client.includes('sqlite')) {
    await knex.raw('DROP TRIGGER IF EXISTS source_snapshots_no_delete');
    await knex.raw('DROP TRIGGER IF EXISTS source_snapshots_no_update');
  } else if (client === 'pg' || client.includes('postgres')) {
    await knex.raw('DROP TRIGGER IF EXISTS source_snapshots_no_delete ON source_snapshots');
    await knex.raw('DROP TRIGGER IF EXISTS source_snapshots_no_update ON source_snapshots');
    await knex.raw('DROP FUNCTION IF EXISTS leozops_reject_source_snapshot_mutation()');
  }

  await knex.schema.dropTableIfExists('intelligence_runs');
  await knex.schema.dropTableIfExists('source_snapshots');
  await knex.schema.dropTableIfExists('source_connections');
  await knex.schema.dropTableIfExists('tenants');
}
