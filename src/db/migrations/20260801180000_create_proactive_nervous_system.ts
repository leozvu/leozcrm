import type { Knex } from 'knex';

const TABLES = [
  'proactive_cycles',
  'proactive_rule_evaluations',
  'proactive_alerts',
  'proactive_alert_events',
  'proactive_delivery_outbox',
  'proactive_delivery_attempts',
  'proactive_delivery_results',
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
  await knex.schema.createTable('proactive_cycles', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('source_snapshot_id').notNullable();
    t.uuid('intelligence_run_id').notNullable().references('id').inTable('intelligence_runs').onDelete('RESTRICT');
    t.string('policy_version', 80).notNullable();
    t.string('mode', 24).notNullable();
    t.string('idempotency_key', 128).notNullable();
    t.string('request_hash', 80).notNullable();
    t.string('freshness_status', 32).notNullable();
    t.string('evidence_quality', 24).notNullable();
    t.timestamp('evaluated_at').notNullable();
    t.timestamp('source_generated_at').notNullable();
    t.timestamp('source_received_at').notNullable();
    t.string('evidence_hash', 80).notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_pro_cycle_tenant_id' });
    t.unique(['tenant_id', 'idempotency_key'], { indexName: 'uq_pro_cycle_idempotency' });
    t.foreign(
      ['tenant_id', 'source_snapshot_id'],
      'fk_pro_cycle_tenant_snapshot',
    ).references(['tenant_id', 'id']).inTable('source_snapshots').onDelete('RESTRICT');
    t.index(['tenant_id', 'evaluated_at'], 'idx_pro_cycle_timeline');
  });

  await knex.schema.createTable('proactive_rule_evaluations', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('cycle_id').notNullable();
    t.string('rule_id', 80).notNullable();
    t.string('status', 32).notNullable();
    t.string('severity', 16).nullable();
    t.integer('metric_value').notNullable();
    t.integer('previous_value').nullable();
    t.integer('threshold_value').notNullable();
    t.text('evidence_json').notNullable();
    t.string('evidence_hash', 80).notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_pro_eval_tenant_id' });
    t.unique(['tenant_id', 'cycle_id', 'rule_id'], { indexName: 'uq_pro_eval_cycle_rule' });
    t.foreign(
      ['tenant_id', 'cycle_id'],
      'fk_pro_eval_tenant_cycle',
    ).references(['tenant_id', 'id']).inTable('proactive_cycles').onDelete('RESTRICT');
    t.index(['tenant_id', 'rule_id', 'created_at'], 'idx_pro_eval_rule_timeline');
  });

  await knex.schema.createTable('proactive_alerts', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('cycle_id').notNullable();
    t.string('rule_id', 80).notNullable();
    t.string('alert_key', 80).notNullable();
    t.string('episode_key', 80).notNullable();
    t.string('severity', 16).notNullable();
    t.string('confidence', 24).notNullable();
    t.string('title', 200).notNullable();
    t.text('rationale').notNullable();
    t.text('recommendation').notNullable();
    t.uuid('source_snapshot_id').notNullable();
    t.uuid('intelligence_run_id').notNullable().references('id').inTable('intelligence_runs').onDelete('RESTRICT');
    t.text('evidence_json').notNullable();
    t.string('evidence_hash', 80).notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_pro_alert_tenant_id' });
    t.unique(['tenant_id', 'alert_key'], { indexName: 'uq_pro_alert_key' });
    t.foreign(
      ['tenant_id', 'cycle_id'],
      'fk_pro_alert_tenant_cycle',
    ).references(['tenant_id', 'id']).inTable('proactive_cycles').onDelete('RESTRICT');
    t.foreign(
      ['tenant_id', 'source_snapshot_id'],
      'fk_pro_alert_tenant_snapshot',
    ).references(['tenant_id', 'id']).inTable('source_snapshots').onDelete('RESTRICT');
    t.index(['tenant_id', 'rule_id', 'created_at'], 'idx_pro_alert_rule_timeline');
  });

  await knex.schema.createTable('proactive_alert_events', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('alert_id').notNullable();
    t.string('event_type', 24).notNullable();
    t.string('event_key', 128).notNullable();
    t.string('actor', 128).notNullable();
    t.string('reason_code', 128).notNullable();
    t.timestamp('snoozed_until').nullable();
    t.string('evidence_hash', 80).notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_pro_alert_event_tenant_id' });
    t.unique(['tenant_id', 'event_key'], { indexName: 'uq_pro_alert_event_key' });
    t.foreign(
      ['tenant_id', 'alert_id'],
      'fk_pro_alert_event_tenant_alert',
    ).references(['tenant_id', 'id']).inTable('proactive_alerts').onDelete('RESTRICT');
    t.index(['tenant_id', 'alert_id', 'created_at'], 'idx_pro_alert_event_timeline');
  });

  await knex.schema.createTable('proactive_delivery_outbox', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('cycle_id').notNullable();
    t.uuid('alert_id').nullable();
    t.string('delivery_kind', 24).notNullable();
    t.string('logical_key', 128).notNullable();
    t.timestamp('available_at').notNullable();
    t.text('payload_json').notNullable();
    t.string('evidence_hash', 80).notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_pro_outbox_tenant_id' });
    t.unique(['tenant_id', 'logical_key'], { indexName: 'uq_pro_outbox_logical' });
    t.foreign(
      ['tenant_id', 'cycle_id'],
      'fk_pro_outbox_tenant_cycle',
    ).references(['tenant_id', 'id']).inTable('proactive_cycles').onDelete('RESTRICT');
    t.foreign(
      ['tenant_id', 'alert_id'],
      'fk_pro_outbox_tenant_alert',
    ).references(['tenant_id', 'id']).inTable('proactive_alerts').onDelete('RESTRICT');
    t.index(['tenant_id', 'available_at'], 'idx_pro_outbox_available');
  });

  await knex.schema.createTable('proactive_delivery_attempts', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('outbox_id').notNullable();
    t.string('attempt_key', 128).notNullable();
    t.string('adapter_key', 128).notNullable();
    t.string('adapter_version', 80).notNullable();
    t.timestamp('started_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_pro_delivery_attempt_tenant_id' });
    t.unique(['tenant_id', 'attempt_key'], { indexName: 'uq_pro_delivery_attempt_key' });
    t.foreign(
      ['tenant_id', 'outbox_id'],
      'fk_pro_attempt_tenant_outbox',
    ).references(['tenant_id', 'id']).inTable('proactive_delivery_outbox').onDelete('RESTRICT');
    t.index(['tenant_id', 'outbox_id', 'created_at'], 'idx_pro_delivery_attempt_timeline');
  });

  await knex.schema.createTable('proactive_delivery_results', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('attempt_id').notNullable();
    t.string('status', 16).notNullable();
    t.string('receipt_id', 256).nullable();
    t.string('failure_code', 128).nullable();
    t.timestamp('completed_at').notNullable();
    t.string('evidence_hash', 80).notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_pro_delivery_result_tenant_id' });
    t.unique(['tenant_id', 'attempt_id'], { indexName: 'uq_pro_delivery_result_attempt' });
    t.foreign(
      ['tenant_id', 'attempt_id'],
      'fk_pro_result_tenant_attempt',
    ).references(['tenant_id', 'id']).inTable('proactive_delivery_attempts').onDelete('RESTRICT');
  });

  for (const table of TABLES) await addImmutableGuards(knex, table);
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [...TABLES].reverse()) await dropImmutableGuards(knex, table);
  for (const table of [...TABLES].reverse()) await knex.schema.dropTableIfExists(table);
}
