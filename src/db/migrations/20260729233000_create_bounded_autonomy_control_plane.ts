import type { Knex } from 'knex';

const IMMUTABLE_TABLES = [
  'bounded_autonomy_simulations',
  'bounded_autonomy_policies',
  'bounded_autonomy_kill_switch_events',
  'bounded_autonomy_evaluations',
  'bounded_autonomy_recovery_previews',
  'bounded_autonomy_recovery_approvals',
  'bounded_autonomy_incident_events',
  'bounded_autonomy_events',
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
  } else {
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_delete ON ${table}`);
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_update ON ${table}`);
    await knex.raw(`DROP FUNCTION IF EXISTS leozops_reject_${table}_mutation()`);
  }
}

async function addAttemptGuards(knex: Knex): Promise<void> {
  const table = 'bounded_autonomy_attempts';
  if (isSqlite(knex)) {
    await knex.raw(`
      CREATE TRIGGER ${table}_guard_update
      BEFORE UPDATE ON ${table}
      WHEN NOT (
        OLD.status = 'in_progress'
        AND NEW.status IN ('succeeded', 'failed', 'reconciliation_required')
        AND NEW.id = OLD.id
        AND NEW.tenant_id = OLD.tenant_id
        AND NEW.policy_record_id = OLD.policy_record_id
        AND NEW.evaluation_id IS OLD.evaluation_id
        AND NEW.kind = OLD.kind
        AND NEW.subject_attempt_id IS OLD.subject_attempt_id
        AND NEW.recovery_approval_id IS OLD.recovery_approval_id
        AND NEW.idempotency_key = OLD.idempotency_key
        AND NEW.request_fingerprint = OLD.request_fingerprint
        AND NEW.executor = OLD.executor
        AND NEW.reserved_cost_minor = OLD.reserved_cost_minor
        AND NEW.currency = OLD.currency
        AND NEW.started_at = OLD.started_at
        AND NEW.lease_expires_at = OLD.lease_expires_at
        AND NEW.created_at = OLD.created_at
        AND OLD.finished_at IS NULL
        AND OLD.external_request_id IS NULL
        AND OLD.result_fingerprint IS NULL
        AND OLD.result_code IS NULL
        AND OLD.actual_cost_minor IS NULL
        AND OLD.external_mutation_count IS NULL
        AND OLD.latency_ms IS NULL
        AND NEW.finished_at IS NOT NULL
        AND NEW.result_fingerprint IS NOT NULL
        AND NEW.result_code IS NOT NULL
        AND NEW.latency_ms IS NOT NULL
      )
      BEGIN
        SELECT RAISE(ABORT, '${table} permits one guarded terminal transition');
      END
    `);
    await knex.raw(`
      CREATE TRIGGER ${table}_no_delete
      BEFORE DELETE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} is not deletable');
      END
    `);
    return;
  }
  await knex.raw(`
    CREATE FUNCTION leozops_guard_bounded_autonomy_attempt()
    RETURNS trigger AS $$
    BEGIN
      IF NOT (
        OLD.status = 'in_progress'
        AND NEW.status IN ('succeeded', 'failed', 'reconciliation_required')
        AND NEW.id IS NOT DISTINCT FROM OLD.id
        AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
        AND NEW.policy_record_id IS NOT DISTINCT FROM OLD.policy_record_id
        AND NEW.evaluation_id IS NOT DISTINCT FROM OLD.evaluation_id
        AND NEW.kind IS NOT DISTINCT FROM OLD.kind
        AND NEW.subject_attempt_id IS NOT DISTINCT FROM OLD.subject_attempt_id
        AND NEW.recovery_approval_id IS NOT DISTINCT FROM OLD.recovery_approval_id
        AND NEW.idempotency_key IS NOT DISTINCT FROM OLD.idempotency_key
        AND NEW.request_fingerprint IS NOT DISTINCT FROM OLD.request_fingerprint
        AND NEW.executor IS NOT DISTINCT FROM OLD.executor
        AND NEW.reserved_cost_minor IS NOT DISTINCT FROM OLD.reserved_cost_minor
        AND NEW.currency IS NOT DISTINCT FROM OLD.currency
        AND NEW.started_at IS NOT DISTINCT FROM OLD.started_at
        AND NEW.lease_expires_at IS NOT DISTINCT FROM OLD.lease_expires_at
        AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
        AND OLD.finished_at IS NULL
        AND OLD.external_request_id IS NULL
        AND OLD.result_fingerprint IS NULL
        AND OLD.result_code IS NULL
        AND OLD.actual_cost_minor IS NULL
        AND OLD.external_mutation_count IS NULL
        AND OLD.latency_ms IS NULL
        AND NEW.finished_at IS NOT NULL
        AND NEW.result_fingerprint IS NOT NULL
        AND NEW.result_code IS NOT NULL
        AND NEW.latency_ms IS NOT NULL
      ) THEN
        RAISE EXCEPTION '${table} permits one guarded terminal transition';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await knex.raw(`
    CREATE TRIGGER ${table}_guard_update
    BEFORE UPDATE ON ${table}
    FOR EACH ROW EXECUTE FUNCTION leozops_guard_bounded_autonomy_attempt()
  `);
  await knex.raw(`
    CREATE FUNCTION leozops_reject_bounded_autonomy_attempt_delete()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION '${table} is not deletable';
    END;
    $$ LANGUAGE plpgsql
  `);
  await knex.raw(`
    CREATE TRIGGER ${table}_no_delete
    BEFORE DELETE ON ${table}
    FOR EACH ROW EXECUTE FUNCTION leozops_reject_bounded_autonomy_attempt_delete()
  `);
}

async function dropAttemptGuards(knex: Knex): Promise<void> {
  const table = 'bounded_autonomy_attempts';
  if (isSqlite(knex)) {
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_delete`);
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_guard_update`);
  } else {
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_delete ON ${table}`);
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_guard_update ON ${table}`);
    await knex.raw('DROP FUNCTION IF EXISTS leozops_reject_bounded_autonomy_attempt_delete()');
    await knex.raw('DROP FUNCTION IF EXISTS leozops_guard_bounded_autonomy_attempt()');
  }
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('bounded_autonomy_simulations', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('source_connection_id').notNullable().references('id').inTable('source_connections').onDelete('RESTRICT');
    t.uuid('g6_policy_record_id').notNullable().references('id').inTable('supervised_action_policies').onDelete('RESTRICT');
    t.string('policy_id', 80).notNullable();
    t.string('policy_fingerprint', 80).notNullable();
    t.string('g6_policy_fingerprint', 80).notNullable();
    t.string('scenario_set_version', 40).notNullable();
    t.integer('scenario_count').notNullable();
    t.boolean('passed').notNullable();
    t.text('outcomes_json').notNullable();
    t.string('simulation_fingerprint', 80).notNullable().unique();
    t.string('simulated_by', 128).notNullable();
    t.timestamp('simulated_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_id', 'policy_fingerprint'], { indexName: 'uq_g7_simulation_policy_fingerprint' });
    t.index(['tenant_id', 'source_connection_id'], 'idx_g7_simulation_tenant_source');
  });

  await knex.schema.createTable('bounded_autonomy_policies', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('source_connection_id').notNullable().references('id').inTable('source_connections').onDelete('RESTRICT');
    t.uuid('g5_release_decision_id').notNullable().references('id').inTable('phase2_release_decisions').onDelete('RESTRICT');
    t.uuid('g6_policy_record_id').notNullable().references('id').inTable('supervised_action_policies').onDelete('RESTRICT');
    t.uuid('simulation_id').notNullable().references('id').inTable('bounded_autonomy_simulations').onDelete('RESTRICT');
    t.string('policy_id', 80).notNullable().unique();
    t.string('environment', 16).notNullable();
    t.string('command_key', 128).notNullable();
    t.string('command_version', 32).notNullable();
    t.string('adapter_id', 128).notNullable();
    t.string('target_fingerprint', 80).notNullable();
    t.timestamp('valid_from').notNullable();
    t.timestamp('valid_until').notNullable();
    t.string('policy_fingerprint', 80).notNullable().unique();
    t.text('manifest_json').notNullable();
    t.timestamp('accepted_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.index(['tenant_id', 'source_connection_id', 'valid_until'], 'idx_g7_policy_scope');
  });

  await knex.schema.createTable('bounded_autonomy_kill_switch_events', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('bounded_autonomy_policies').onDelete('RESTRICT');
    t.integer('sequence').notNullable();
    t.string('state', 16).notNullable();
    t.string('actor', 128).notNullable();
    t.string('reason_code', 128).notNullable();
    t.string('evidence_fingerprint', 80).notNullable();
    t.string('event_fingerprint', 80).notNullable().unique();
    t.timestamp('occurred_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'sequence'], { indexName: 'uq_g7_kill_switch_sequence' });
    t.index(['policy_record_id', 'occurred_at'], 'idx_g7_kill_switch_timeline');
  });

  await knex.schema.createTable('bounded_autonomy_evaluations', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('source_connection_id').notNullable().references('id').inTable('source_connections').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('bounded_autonomy_policies').onDelete('RESTRICT');
    t.string('idempotency_key', 200).notNullable();
    t.text('payload_json').notNullable();
    t.string('payload_fingerprint', 80).notNullable();
    t.string('reason_code', 128).notNullable();
    t.text('evidence_refs_json').notNullable();
    t.string('request_fingerprint', 80).notNullable();
    t.string('target_fingerprint', 80).notNullable();
    t.string('preview_fingerprint', 80).nullable();
    t.string('effect_fingerprint', 80).nullable();
    t.string('summary_code', 128).nullable();
    t.string('rollback_strategy_code', 128).nullable();
    t.integer('estimated_cost_minor').notNullable();
    t.string('currency', 3).notNullable();
    t.integer('preview_mutation_count').nullable();
    t.string('decision', 16).notNullable();
    t.string('decision_code', 128).notNullable();
    t.timestamp('evaluated_at').notNullable();
    t.string('evaluation_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'idempotency_key'], { indexName: 'uq_g7_evaluation_idempotency' });
    t.index(['policy_record_id', 'evaluated_at'], 'idx_g7_evaluation_timeline');
  });

  await knex.schema.createTable('bounded_autonomy_attempts', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('bounded_autonomy_policies').onDelete('RESTRICT');
    t.uuid('evaluation_id').nullable().references('id').inTable('bounded_autonomy_evaluations').onDelete('RESTRICT');
    t.string('kind', 16).notNullable();
    t.uuid('subject_attempt_id').nullable().references('id').inTable('bounded_autonomy_attempts').onDelete('RESTRICT');
    t.uuid('recovery_approval_id').nullable();
    t.string('idempotency_key', 200).notNullable();
    t.string('request_fingerprint', 80).notNullable();
    t.string('status', 32).notNullable();
    t.string('executor', 128).notNullable();
    t.integer('reserved_cost_minor').notNullable();
    t.string('currency', 3).notNullable();
    t.timestamp('started_at').notNullable();
    t.timestamp('lease_expires_at').notNullable();
    t.timestamp('finished_at').nullable();
    t.string('external_request_id', 160).nullable();
    t.string('result_fingerprint', 80).nullable();
    t.string('result_code', 128).nullable();
    t.integer('actual_cost_minor').nullable();
    t.integer('external_mutation_count').nullable();
    t.integer('latency_ms').nullable();
    t.timestamp('created_at').notNullable();
    t.unique(['evaluation_id'], { indexName: 'uq_g7_attempt_evaluation' });
    t.unique(['subject_attempt_id'], { indexName: 'uq_g7_recovery_subject' });
    t.unique(['recovery_approval_id'], { indexName: 'uq_g7_recovery_approval' });
    t.unique(['policy_record_id', 'idempotency_key'], { indexName: 'uq_g7_attempt_idempotency' });
    t.index(['policy_record_id', 'started_at'], 'idx_g7_attempt_limits');
  });

  await knex.schema.createTable('bounded_autonomy_recovery_previews', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('bounded_autonomy_policies').onDelete('RESTRICT');
    t.uuid('subject_attempt_id').notNullable().references('id').inTable('bounded_autonomy_attempts').onDelete('RESTRICT');
    t.string('adapter_id', 128).notNullable();
    t.string('adapter_version', 128).notNullable();
    t.string('request_fingerprint', 80).notNullable();
    t.string('target_fingerprint', 80).notNullable();
    t.string('effect_fingerprint', 80).notNullable();
    t.string('summary_code', 128).notNullable();
    t.string('rollback_strategy_code', 128).notNullable();
    t.integer('estimated_cost_minor').notNullable();
    t.string('currency', 3).notNullable();
    t.integer('external_mutation_count').notNullable();
    t.string('previewed_by', 128).notNullable();
    t.timestamp('previewed_at').notNullable();
    t.timestamp('expires_at').notNullable();
    t.string('preview_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['subject_attempt_id'], { indexName: 'uq_g7_recovery_preview_subject' });
  });

  await knex.schema.createTable('bounded_autonomy_recovery_approvals', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('bounded_autonomy_policies').onDelete('RESTRICT');
    t.uuid('subject_attempt_id').notNullable().references('id').inTable('bounded_autonomy_attempts').onDelete('RESTRICT');
    t.uuid('preview_id').notNullable().references('id').inTable('bounded_autonomy_recovery_previews').onDelete('RESTRICT');
    t.string('decision', 16).notNullable();
    t.string('policy_fingerprint', 80).notNullable();
    t.string('preview_fingerprint', 80).notNullable();
    t.string('approver', 128).notNullable();
    t.string('reason_code', 128).notNullable();
    t.string('nonce', 200).notNullable();
    t.integer('max_cost_minor').notNullable();
    t.string('currency', 3).notNullable();
    t.timestamp('decided_at').notNullable();
    t.timestamp('expires_at').notNullable();
    t.string('approval_fingerprint', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['preview_id'], { indexName: 'uq_g7_recovery_approval_preview' });
  });

  await knex.schema.createTable('bounded_autonomy_incident_events', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('bounded_autonomy_policies').onDelete('RESTRICT');
    t.uuid('incident_id').notNullable();
    t.uuid('attempt_id').nullable().references('id').inTable('bounded_autonomy_attempts').onDelete('RESTRICT');
    t.integer('sequence').notNullable();
    t.string('kind', 16).notNullable();
    t.string('actor', 128).notNullable();
    t.string('reason_code', 128).notNullable();
    t.string('evidence_fingerprint', 80).notNullable();
    t.string('event_fingerprint', 80).notNullable().unique();
    t.timestamp('occurred_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['incident_id', 'sequence'], { indexName: 'uq_g7_incident_sequence' });
    t.index(['policy_record_id', 'incident_id'], 'idx_g7_incident_policy');
  });

  await knex.schema.createTable('bounded_autonomy_events', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('policy_record_id').notNullable().references('id').inTable('bounded_autonomy_policies').onDelete('RESTRICT');
    t.integer('sequence').notNullable();
    t.string('event_type', 64).notNullable();
    t.string('actor', 128).notNullable();
    t.string('evidence_fingerprint', 80).notNullable();
    t.string('reason_code', 128).notNullable();
    t.string('event_fingerprint', 80).notNullable().unique();
    t.timestamp('occurred_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['policy_record_id', 'sequence'], { indexName: 'uq_g7_event_sequence' });
  });

  for (const table of IMMUTABLE_TABLES) await addImmutableGuards(knex, table);
  await addAttemptGuards(knex);
}

export async function down(knex: Knex): Promise<void> {
  await dropAttemptGuards(knex);
  for (const table of [...IMMUTABLE_TABLES].reverse()) await dropImmutableGuards(knex, table);
  await knex.schema.dropTableIfExists('bounded_autonomy_events');
  await knex.schema.dropTableIfExists('bounded_autonomy_incident_events');
  await knex.schema.dropTableIfExists('bounded_autonomy_recovery_approvals');
  await knex.schema.dropTableIfExists('bounded_autonomy_recovery_previews');
  await knex.schema.dropTableIfExists('bounded_autonomy_attempts');
  await knex.schema.dropTableIfExists('bounded_autonomy_evaluations');
  await knex.schema.dropTableIfExists('bounded_autonomy_kill_switch_events');
  await knex.schema.dropTableIfExists('bounded_autonomy_policies');
  await knex.schema.dropTableIfExists('bounded_autonomy_simulations');
}
