import type { Knex } from 'knex';

const TABLES = [
  'source_poll_runs',
  'shadow_daily_evidence',
  'phase2_release_decisions',
] as const;

async function makeImmutable(knex: Knex, table: typeof TABLES[number]): Promise<void> {
  const client = String(knex.client.config.client);
  if (client.includes('sqlite')) {
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
  if (client === 'pg' || client.includes('postgres')) {
    const fn = `leozops_reject_${table}_mutation`;
    await knex.raw(`
      CREATE FUNCTION ${fn}()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION '${table} is immutable';
      END;
      $$ LANGUAGE plpgsql
    `);
    await knex.raw(`
      CREATE TRIGGER ${table}_no_update
      BEFORE UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION ${fn}()
    `);
    await knex.raw(`
      CREATE TRIGGER ${table}_no_delete
      BEFORE DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION ${fn}()
    `);
  }
}

async function dropImmutable(knex: Knex, table: typeof TABLES[number]): Promise<void> {
  const client = String(knex.client.config.client);
  if (client.includes('sqlite')) {
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_delete`);
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_update`);
    return;
  }
  if (client === 'pg' || client.includes('postgres')) {
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_delete ON ${table}`);
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_update ON ${table}`);
    await knex.raw(`DROP FUNCTION IF EXISTS leozops_reject_${table}_mutation()`);
  }
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('source_poll_runs', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable();
    t.uuid('source_connection_id').notNullable();
    t.string('environment', 16).notNullable();
    t.string('authorization_id', 80).notNullable();
    t.uuid('correlation_id').notNullable();
    t.timestamp('started_at').notNullable();
    t.timestamp('finished_at').notNullable();
    t.integer('latency_ms').notNullable();
    t.string('outcome', 32).notNullable();
    t.integer('attempt_count').notNullable();
    t.integer('http_status').nullable();
    t.string('error_code', 64).nullable();
    t.string('request_method', 8).nullable();
    t.boolean('request_body_present').notNullable().defaultTo(false);
    t.string('snapshot_id', 80).nullable();
    t.uuid('intelligence_run_id').nullable()
      .references('id').inTable('intelligence_runs').onDelete('RESTRICT');
    t.integer('record_count').nullable();
    t.timestamp('source_generated_at').nullable();
    t.timestamp('confirmed_fresh_at').nullable();
    t.integer('source_mutation_count').notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.foreign(
      ['tenant_id', 'source_connection_id'],
      'fk_poll_runs_tenant_connection',
    ).references(['tenant_id', 'id']).inTable('source_connections').onDelete('RESTRICT');
    t.unique(
      ['environment', 'tenant_id', 'source_connection_id', 'correlation_id'],
      { indexName: 'uq_source_poll_runs_correlation' },
    );
    t.index(
      ['environment', 'tenant_id', 'source_connection_id', 'started_at'],
      'idx_source_poll_runs_window',
    );
  });

  await knex.schema.createTable('shadow_daily_evidence', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable();
    t.uuid('source_connection_id').notNullable();
    t.string('environment', 16).notNullable();
    t.string('authorization_id', 80).notNullable();
    t.string('business_date', 10).notNullable();
    t.string('business_timezone', 64).notNullable();
    t.string('evidence_key', 71).notNullable();
    t.integer('expected_syncs').notNullable();
    t.integer('scheduled_syncs').notNullable();
    t.integer('successful_syncs').notNullable();
    t.integer('not_modified_syncs').notNullable();
    t.integer('failed_syncs').notNullable();
    t.integer('skipped_invocations').notNullable();
    t.integer('latest_confirmation_age_seconds').nullable();
    t.integer('stale_after_seconds').notNullable();
    t.uuid('reconciliation_id').notNullable()
      .references('id').inTable('source_reconciliations').onDelete('RESTRICT');
    t.string('reconciliation_status', 16).notNullable();
    t.integer('source_total').nullable();
    t.integer('snapshot_total').nullable();
    t.integer('brief_total').nullable();
    t.integer('native_stage_delta_count').nullable();
    t.integer('safe_source_delta_count').nullable();
    t.integer('source_mutation_count').notNullable();
    t.boolean('employee_workflow_regression').notNullable();
    t.boolean('source_latency_regression').notNullable();
    t.boolean('source_error_regression').notNullable();
    t.string('formula_version', 100).notNullable();
    t.string('snapshot_id', 80).nullable();
    t.uuid('intelligence_run_id').nullable()
      .references('id').inTable('intelligence_runs').onDelete('RESTRICT');
    t.string('reviewer', 128).notNullable();
    t.integer('reviewer_score').notNullable();
    t.boolean('material_false_claim').notNullable();
    t.integer('incident_count').notNullable();
    t.integer('rollback_event_count').notNullable();
    t.string('status', 16).notNullable();
    t.text('failure_codes_json').notNullable();
    t.timestamp('reviewed_at').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.foreign(
      ['tenant_id', 'source_connection_id'],
      'fk_shadow_evidence_tenant_connection',
    ).references(['tenant_id', 'id']).inTable('source_connections').onDelete('RESTRICT');
    t.unique(
      ['environment', 'tenant_id', 'source_connection_id', 'business_date'],
      { indexName: 'uq_shadow_daily_business_date' },
    );
    t.unique(['evidence_key'], { indexName: 'uq_shadow_daily_evidence_key' });
    t.index(
      ['tenant_id', 'source_connection_id', 'business_date'],
      'idx_shadow_daily_window',
    );
  });

  await knex.schema.createTable('phase2_release_decisions', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable();
    t.uuid('source_connection_id').notNullable();
    t.string('authorization_id', 80).notNullable();
    t.string('decision', 16).notNullable();
    t.string('decided_by', 128).notNullable();
    t.timestamp('decided_at').notNullable();
    t.string('evaluation_fingerprint', 71).notNullable();
    t.string('reason_code', 64).notNullable();
    t.string('extend_until_business_date', 10).nullable();
    t.string('evidence_key', 71).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.foreign(
      ['tenant_id', 'source_connection_id'],
      'fk_phase2_decision_tenant_connection',
    ).references(['tenant_id', 'id']).inTable('source_connections').onDelete('RESTRICT');
    t.unique(['evidence_key'], { indexName: 'uq_phase2_release_evidence' });
    t.index(
      ['tenant_id', 'source_connection_id', 'decided_at'],
      'idx_phase2_release_decisions',
    );
  });

  for (const table of TABLES) await makeImmutable(knex, table);
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [...TABLES].reverse()) await dropImmutable(knex, table);
  await knex.schema.dropTableIfExists('phase2_release_decisions');
  await knex.schema.dropTableIfExists('shadow_daily_evidence');
  await knex.schema.dropTableIfExists('source_poll_runs');
}
