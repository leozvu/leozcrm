import type { Knex } from 'knex';
import { PLANNER_TABLES } from '../../domain/planner';

function sqlite(knex: Knex): boolean {
  return String(knex.client.config.client).includes('sqlite');
}

async function immutable(knex: Knex, table: string): Promise<void> {
  if (sqlite(knex)) {
    await knex.raw(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END`);
    await knex.raw(`CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END`);
    return;
  }
  await knex.raw(`CREATE FUNCTION leozops_reject_${table}_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION '${table} is immutable'; END; $$ LANGUAGE plpgsql`);
  await knex.raw(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION leozops_reject_${table}_mutation()`);
  await knex.raw(`CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION leozops_reject_${table}_mutation()`);
}

async function dropImmutable(knex: Knex, table: string): Promise<void> {
  if (sqlite(knex)) {
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_delete`);
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_update`);
    return;
  }
  await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_delete ON ${table}`);
  await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_update ON ${table}`);
  await knex.raw(`DROP FUNCTION IF EXISTS leozops_reject_${table}_mutation()`);
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable(PLANNER_TABLES.goals, (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.string('goal_key', 128).notNullable();
    t.integer('version').notNullable();
    t.uuid('previous_goal_version_id').nullable().references('id').inTable(PLANNER_TABLES.goals).onDelete('RESTRICT');
    t.string('idempotency_key', 128).notNullable();
    t.string('request_hash', 80).notNullable();
    t.text('manifest_json').notNullable();
    t.string('manifest_hash', 80).notNullable();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_planner_goal_tenant_id' });
    t.foreign(['tenant_id', 'previous_goal_version_id'])
      .references(['tenant_id', 'id']).inTable(PLANNER_TABLES.goals).onDelete('RESTRICT');
    t.unique(['tenant_id', 'goal_key', 'version'], { indexName: 'uq_planner_goal_version' });
    t.unique(['tenant_id', 'idempotency_key'], { indexName: 'uq_planner_goal_idempotency' });
    t.index(['tenant_id', 'goal_key', 'created_at'], 'idx_planner_goal_timeline');
    t.index(['tenant_id', 'manifest_hash'], 'idx_planner_goal_manifest');
  });

  await knex.schema.createTable(PLANNER_TABLES.plans, (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('goal_version_id').notNullable().references('id').inTable(PLANNER_TABLES.goals).onDelete('RESTRICT');
    t.string('plan_key', 128).notNullable();
    t.integer('version').notNullable();
    t.uuid('previous_plan_version_id').nullable().references('id').inTable(PLANNER_TABLES.plans).onDelete('RESTRICT');
    t.string('strategy', 24).notNullable();
    t.string('idempotency_key', 128).notNullable();
    t.string('request_hash', 80).notNullable();
    t.string('policy_version', 80).notNullable();
    t.text('evidence_bundle_json').notNullable();
    t.string('evidence_bundle_hash', 80).notNullable();
    t.integer('baseline_value').nullable();
    t.integer('target_value').notNullable();
    t.string('conflict_status', 16).notNullable();
    t.boolean('advisory_only').notNullable();
    t.string('action_authority', 16).notNullable();
    t.string('plan_hash', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_planner_plan_tenant_id' });
    t.foreign(['tenant_id', 'goal_version_id'])
      .references(['tenant_id', 'id']).inTable(PLANNER_TABLES.goals).onDelete('RESTRICT');
    t.foreign(['tenant_id', 'previous_plan_version_id'])
      .references(['tenant_id', 'id']).inTable(PLANNER_TABLES.plans).onDelete('RESTRICT');
    t.unique(['tenant_id', 'idempotency_key'], { indexName: 'uq_planner_plan_idempotency' });
    t.unique(['goal_version_id', 'plan_key', 'version'], { indexName: 'uq_planner_plan_version' });
    t.index(['tenant_id', 'goal_version_id', 'created_at'], 'idx_planner_plan_goal');
  });

  await knex.schema.createTable(PLANNER_TABLES.steps, (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('plan_id').notNullable().references('id').inTable(PLANNER_TABLES.plans).onDelete('RESTRICT');
    t.integer('ordinal').notNullable();
    t.string('step_key', 128).notNullable();
    t.string('kind', 24).notNullable();
    t.string('title', 240).notNullable();
    t.text('rationale').notNullable();
    t.integer('effort_points').notNullable();
    t.string('confidence', 16).notNullable();
    t.text('evidence_keys_json').notNullable();
    t.string('completion_metric_key', 64).notNullable();
    t.integer('completion_target_value').notNullable();
    t.string('action_route', 32).notNullable();
    t.string('execution_state', 24).notNullable();
    t.string('step_hash', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.unique(['tenant_id', 'id'], { indexName: 'uq_planner_step_tenant_id' });
    t.foreign(['tenant_id', 'plan_id'])
      .references(['tenant_id', 'id']).inTable(PLANNER_TABLES.plans).onDelete('RESTRICT');
    t.unique(['plan_id', 'ordinal'], { indexName: 'uq_planner_step_ordinal' });
  });

  await knex.schema.createTable(PLANNER_TABLES.conflicts, (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('plan_id').notNullable().references('id').inTable(PLANNER_TABLES.plans).onDelete('RESTRICT');
    t.string('conflict_key', 128).notNullable();
    t.string('severity', 16).notNullable();
    t.string('category', 24).notNullable();
    t.text('message').notNullable();
    t.text('evidence_keys_json').notNullable();
    t.string('conflict_hash', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.foreign(['tenant_id', 'plan_id'])
      .references(['tenant_id', 'id']).inTable(PLANNER_TABLES.plans).onDelete('RESTRICT');
    t.unique(['plan_id', 'conflict_key'], { indexName: 'uq_planner_conflict_key' });
  });

  await knex.schema.createTable(PLANNER_TABLES.simulations, (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('plan_id').notNullable().references('id').inTable(PLANNER_TABLES.plans).onDelete('RESTRICT');
    t.string('scenario', 24).notNullable();
    t.integer('projected_value').nullable();
    t.integer('target_value').notNullable();
    t.integer('progress_basis_points').notNullable();
    t.string('feasibility', 24).notNullable();
    t.string('uncertainty', 16).notNullable();
    t.text('assumptions_json').notNullable();
    t.string('simulation_hash', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.foreign(['tenant_id', 'plan_id'])
      .references(['tenant_id', 'id']).inTable(PLANNER_TABLES.plans).onDelete('RESTRICT');
    t.unique(['plan_id', 'scenario'], { indexName: 'uq_planner_simulation_scenario' });
  });

  await knex.schema.createTable(PLANNER_TABLES.decisions, (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('plan_id').notNullable().references('id').inTable(PLANNER_TABLES.plans).onDelete('RESTRICT');
    t.string('idempotency_key', 128).notNullable();
    t.string('decision', 16).notNullable();
    t.string('reason_code', 128).notNullable();
    t.string('actor', 32).notNullable();
    t.boolean('grants_action_authority').notNullable();
    t.string('decision_hash', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.foreign(['tenant_id', 'plan_id'])
      .references(['tenant_id', 'id']).inTable(PLANNER_TABLES.plans).onDelete('RESTRICT');
    t.unique(['tenant_id', 'plan_id', 'idempotency_key'], { indexName: 'uq_planner_decision_idempotency' });
    t.index(['tenant_id', 'plan_id', 'created_at'], 'idx_planner_decision_timeline');
  });

  await knex.schema.createTable(PLANNER_TABLES.checkpoints, (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('plan_id').notNullable().references('id').inTable(PLANNER_TABLES.plans).onDelete('RESTRICT');
    t.string('idempotency_key', 128).notNullable();
    t.string('source_snapshot_id', 80).notNullable();
    t.uuid('intelligence_run_id').notNullable().references('id').inTable('intelligence_runs').onDelete('RESTRICT');
    t.string('metric_key', 64).notNullable();
    t.integer('observed_value').nullable();
    t.integer('target_value').notNullable();
    t.string('freshness_status', 32).notNullable();
    t.string('verdict', 24).notNullable();
    t.string('evidence_hash', 80).notNullable().unique();
    t.timestamp('observed_at').notNullable();
    t.timestamp('created_at').notNullable();
    t.foreign(['tenant_id', 'plan_id'])
      .references(['tenant_id', 'id']).inTable(PLANNER_TABLES.plans).onDelete('RESTRICT');
    t.unique(['tenant_id', 'plan_id', 'idempotency_key'], { indexName: 'uq_planner_checkpoint_idempotency' });
    t.index(['tenant_id', 'plan_id', 'observed_at'], 'idx_planner_checkpoint_timeline');
  });

  await knex.schema.createTable(PLANNER_TABLES.outcomes, (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('plan_id').notNullable().references('id').inTable(PLANNER_TABLES.plans).onDelete('RESTRICT');
    t.string('idempotency_key', 128).notNullable();
    t.string('outcome', 24).notNullable();
    t.text('note').nullable();
    t.string('actor', 32).notNullable();
    t.string('outcome_hash', 80).notNullable().unique();
    t.timestamp('created_at').notNullable();
    t.foreign(['tenant_id', 'plan_id'])
      .references(['tenant_id', 'id']).inTable(PLANNER_TABLES.plans).onDelete('RESTRICT');
    t.unique(['tenant_id', 'plan_id', 'idempotency_key'], { indexName: 'uq_planner_outcome_idempotency' });
  });

  for (const table of Object.values(PLANNER_TABLES)) await immutable(knex, table);
}

export async function down(knex: Knex): Promise<void> {
  const tables = Object.values(PLANNER_TABLES).reverse();
  for (const table of tables) await dropImmutable(knex, table);
  // SQLite enforces self-referential RESTRICT keys while dropping a populated
  // table. These links are migration-owned and may be detached only inside
  // rollback, after immutability guards are removed and before table removal.
  await knex(PLANNER_TABLES.plans).update({ previous_plan_version_id: null });
  await knex(PLANNER_TABLES.goals).update({ previous_goal_version_id: null });
  for (const table of tables) await knex.schema.dropTableIfExists(table);
}
