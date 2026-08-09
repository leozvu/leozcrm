import type { Knex } from 'knex';

const IMMUTABLE_TABLES = [
  'supervised_action_policies',
  'supervised_action_proposals',
  'supervised_action_previews',
  'supervised_action_approvals',
  'supervised_action_events',
] as const;

async function makeImmutable(knex: Knex, table: typeof IMMUTABLE_TABLES[number]): Promise<void> {
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

async function dropImmutable(knex: Knex, table: typeof IMMUTABLE_TABLES[number]): Promise<void> {
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

async function guardAttempts(knex: Knex): Promise<void> {
  const table = 'supervised_action_attempts';
  const client = String(knex.client.config.client);
  if (client.includes('sqlite')) {
    await knex.raw(`
      CREATE TRIGGER ${table}_guard_update
      BEFORE UPDATE ON ${table}
      WHEN OLD.status <> 'in_progress'
        OR NEW.status NOT IN ('succeeded', 'failed', 'reconciliation_required')
        OR NEW.id <> OLD.id
        OR NEW.tenant_id <> OLD.tenant_id
        OR NEW.proposal_id <> OLD.proposal_id
        OR NEW.preview_id <> OLD.preview_id
        OR NEW.approval_id <> OLD.approval_id
        OR NEW.kind <> OLD.kind
        OR NEW.subject_execution_id IS NOT OLD.subject_execution_id
        OR NEW.idempotency_key <> OLD.idempotency_key
        OR NEW.request_fingerprint <> OLD.request_fingerprint
        OR NEW.operator <> OLD.operator
        OR NEW.reserved_cost_minor <> OLD.reserved_cost_minor
        OR NEW.started_at <> OLD.started_at
        OR NEW.lease_expires_at <> OLD.lease_expires_at
        OR NEW.currency <> OLD.currency
        OR NEW.created_at <> OLD.created_at
        OR NEW.finished_at IS NULL
        OR NEW.result_fingerprint IS NULL
        OR NEW.result_code IS NULL
        OR NEW.latency_ms IS NULL
      BEGIN
        SELECT RAISE(ABORT, '${table} permits only one guarded terminal transition');
      END
    `);
    await knex.raw(`
      CREATE TRIGGER ${table}_no_delete
      BEFORE DELETE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} cannot be deleted');
      END
    `);
    return;
  }
  if (client === 'pg' || client.includes('postgres')) {
    await knex.raw(`
      CREATE FUNCTION leozops_guard_supervised_action_attempt()
      RETURNS trigger AS $$
      BEGIN
        IF OLD.status <> 'in_progress'
          OR NEW.status NOT IN ('succeeded', 'failed', 'reconciliation_required')
          OR NEW.id IS DISTINCT FROM OLD.id
          OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
          OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id
          OR NEW.preview_id IS DISTINCT FROM OLD.preview_id
          OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
          OR NEW.kind IS DISTINCT FROM OLD.kind
          OR NEW.subject_execution_id IS DISTINCT FROM OLD.subject_execution_id
          OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
          OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
          OR NEW.operator IS DISTINCT FROM OLD.operator
          OR NEW.reserved_cost_minor IS DISTINCT FROM OLD.reserved_cost_minor
          OR NEW.started_at IS DISTINCT FROM OLD.started_at
          OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at
          OR NEW.currency IS DISTINCT FROM OLD.currency
          OR NEW.created_at IS DISTINCT FROM OLD.created_at
          OR NEW.finished_at IS NULL
          OR NEW.result_fingerprint IS NULL
          OR NEW.result_code IS NULL
          OR NEW.latency_ms IS NULL
        THEN
          RAISE EXCEPTION '${table} permits only one guarded terminal transition';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await knex.raw(`
      CREATE TRIGGER ${table}_guard_update
      BEFORE UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION leozops_guard_supervised_action_attempt()
    `);
    await knex.raw(`
      CREATE FUNCTION leozops_reject_${table}_delete()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION '${table} cannot be deleted';
      END;
      $$ LANGUAGE plpgsql
    `);
    await knex.raw(`
      CREATE TRIGGER ${table}_no_delete
      BEFORE DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION leozops_reject_${table}_delete()
    `);
  }
}

async function dropAttemptGuards(knex: Knex): Promise<void> {
  const table = 'supervised_action_attempts';
  const client = String(knex.client.config.client);
  if (client.includes('sqlite')) {
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_delete`);
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_guard_update`);
    return;
  }
  if (client === 'pg' || client.includes('postgres')) {
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_delete ON ${table}`);
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_guard_update ON ${table}`);
    await knex.raw(`DROP FUNCTION IF EXISTS leozops_reject_${table}_delete()`);
    await knex.raw('DROP FUNCTION IF EXISTS leozops_guard_supervised_action_attempt()');
  }
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('supervised_action_policies', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('source_connection_id').notNullable();
    t.uuid('g5_release_decision_id').notNullable()
      .references('id').inTable('phase2_release_decisions').onDelete('RESTRICT');
    t.string('policy_id', 80).notNullable();
    t.string('environment', 16).notNullable();
    t.string('command_key', 128).notNullable();
    t.string('command_version', 16).notNullable();
    t.string('adapter_id', 128).notNullable();
    t.string('risk_tier', 16).notNullable();
    t.string('target_project_id', 192).notNullable();
    t.string('target_tenant_key', 192).notNullable();
    t.string('target_endpoint_url', 512).notNullable();
    t.string('target_credential_sha256', 71).notNullable();
    t.timestamp('valid_from').notNullable();
    t.timestamp('valid_until').notNullable();
    t.string('policy_fingerprint', 71).notNullable();
    t.text('manifest_json').notNullable();
    t.timestamp('created_at').notNullable();

    t.foreign(
      ['tenant_id', 'source_connection_id'],
      'fk_action_policy_tenant_connection',
    ).references(['tenant_id', 'id']).inTable('source_connections').onDelete('RESTRICT');
    t.unique(['policy_id'], { indexName: 'uq_action_policy_id' });
    t.unique(['policy_fingerprint'], { indexName: 'uq_action_policy_fingerprint' });
    t.index(['tenant_id', 'source_connection_id', 'command_key'], 'idx_action_policy_scope');
  });

  await knex.schema.createTable('supervised_action_proposals', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('source_connection_id').notNullable();
    t.uuid('policy_record_id').notNullable()
      .references('id').inTable('supervised_action_policies').onDelete('RESTRICT');
    t.uuid('g5_release_decision_id').notNullable()
      .references('id').inTable('phase2_release_decisions').onDelete('RESTRICT');
    t.string('policy_id', 80).notNullable();
    t.string('policy_fingerprint', 71).notNullable();
    t.string('command_key', 128).notNullable();
    t.string('command_version', 16).notNullable();
    t.string('adapter_id', 128).notNullable();
    t.text('payload_json').notNullable();
    t.string('payload_fingerprint', 71).notNullable();
    t.string('reason_code', 128).notNullable();
    t.string('expected_impact_code', 128).notNullable();
    t.text('evidence_refs_json').notNullable();
    t.integer('estimated_cost_minor').notNullable();
    t.string('currency', 3).notNullable();
    t.string('idempotency_key', 192).notNullable();
    t.string('requested_by', 128).notNullable();
    t.timestamp('requested_at').notNullable();
    t.timestamp('expires_at').notNullable();
    t.string('proposal_fingerprint', 71).notNullable();
    t.timestamp('created_at').notNullable();

    t.foreign(
      ['tenant_id', 'source_connection_id'],
      'fk_action_proposal_tenant_connection',
    ).references(['tenant_id', 'id']).inTable('source_connections').onDelete('RESTRICT');
    t.unique(['proposal_fingerprint'], { indexName: 'uq_action_proposal_fingerprint' });
    t.unique(
      ['tenant_id', 'command_key', 'idempotency_key'],
      { indexName: 'uq_action_proposal_idempotency' },
    );
    t.index(['tenant_id', 'requested_at'], 'idx_action_proposal_timeline');
  });

  await knex.schema.createTable('supervised_action_previews', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('proposal_id').notNullable()
      .references('id').inTable('supervised_action_proposals').onDelete('RESTRICT');
    t.string('kind', 16).notNullable();
    t.uuid('subject_execution_id').nullable();
    t.string('policy_fingerprint', 71).notNullable();
    t.string('proposal_fingerprint', 71).notNullable();
    t.string('adapter_id', 128).notNullable();
    t.string('adapter_version', 128).notNullable();
    t.string('request_fingerprint', 71).notNullable();
    t.string('target_fingerprint', 71).notNullable();
    t.string('effect_fingerprint', 71).notNullable();
    t.string('summary_code', 128).notNullable();
    t.string('rollback_strategy_code', 128).notNullable();
    t.integer('estimated_cost_minor').notNullable();
    t.string('currency', 3).notNullable();
    t.integer('external_mutation_count').notNullable();
    t.timestamp('previewed_at').notNullable();
    t.timestamp('expires_at').notNullable();
    t.string('preview_fingerprint', 71).notNullable();
    t.timestamp('created_at').notNullable();

    t.unique(['proposal_id', 'kind'], { indexName: 'uq_action_preview_kind' });
    t.unique(['preview_fingerprint'], { indexName: 'uq_action_preview_fingerprint' });
    t.index(['tenant_id', 'previewed_at'], 'idx_action_preview_timeline');
  });

  await knex.schema.createTable('supervised_action_approvals', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('proposal_id').notNullable()
      .references('id').inTable('supervised_action_proposals').onDelete('RESTRICT');
    t.uuid('preview_id').notNullable()
      .references('id').inTable('supervised_action_previews').onDelete('RESTRICT');
    t.string('kind', 16).notNullable();
    t.string('decision', 16).notNullable();
    t.string('policy_fingerprint', 71).notNullable();
    t.string('proposal_fingerprint', 71).notNullable();
    t.string('preview_fingerprint', 71).notNullable();
    t.string('approver', 128).notNullable();
    t.string('reason_code', 128).notNullable();
    t.string('nonce', 192).notNullable();
    t.integer('max_cost_minor').notNullable();
    t.string('currency', 3).notNullable();
    t.timestamp('decided_at').notNullable();
    t.timestamp('expires_at').notNullable();
    t.string('approval_fingerprint', 71).notNullable();
    t.timestamp('created_at').notNullable();

    t.unique(['preview_id'], { indexName: 'uq_action_approval_preview' });
    t.unique(['tenant_id', 'nonce'], { indexName: 'uq_action_approval_nonce' });
    t.unique(['approval_fingerprint'], { indexName: 'uq_action_approval_fingerprint' });
    t.index(['tenant_id', 'decided_at'], 'idx_action_approval_timeline');
  });

  await knex.schema.createTable('supervised_action_attempts', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('proposal_id').notNullable()
      .references('id').inTable('supervised_action_proposals').onDelete('RESTRICT');
    t.uuid('preview_id').notNullable()
      .references('id').inTable('supervised_action_previews').onDelete('RESTRICT');
    t.uuid('approval_id').notNullable()
      .references('id').inTable('supervised_action_approvals').onDelete('RESTRICT');
    t.string('kind', 16).notNullable();
    t.uuid('subject_execution_id').nullable();
    t.string('idempotency_key', 192).notNullable();
    t.string('request_fingerprint', 71).notNullable();
    t.string('status', 32).notNullable();
    t.string('operator', 128).notNullable();
    t.integer('reserved_cost_minor').notNullable();
    t.timestamp('started_at').notNullable();
    t.timestamp('lease_expires_at').notNullable();
    t.timestamp('finished_at').nullable();
    t.string('external_request_id', 128).nullable();
    t.string('result_fingerprint', 71).nullable();
    t.string('result_code', 128).nullable();
    t.integer('actual_cost_minor').nullable();
    t.string('currency', 3).notNullable();
    t.integer('external_mutation_count').nullable();
    t.integer('latency_ms').nullable();
    t.timestamp('created_at').notNullable();

    t.foreign('subject_execution_id', 'fk_action_attempt_subject')
      .references('id').inTable('supervised_action_attempts').onDelete('RESTRICT');
    t.unique(['proposal_id', 'kind'], { indexName: 'uq_action_attempt_kind' });
    t.unique(['tenant_id', 'idempotency_key'], { indexName: 'uq_action_attempt_idempotency' });
    t.index(['tenant_id', 'started_at'], 'idx_action_attempt_rate_window');
    t.index(['tenant_id', 'status', 'lease_expires_at'], 'idx_action_attempt_leases');
  });

  await knex.schema.createTable('supervised_action_events', (t) => {
    t.uuid('id').primary();
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.uuid('proposal_id').notNullable()
      .references('id').inTable('supervised_action_proposals').onDelete('RESTRICT');
    t.integer('sequence').notNullable();
    t.string('event_type', 32).notNullable();
    t.string('actor', 128).notNullable();
    t.string('evidence_fingerprint', 71).notNullable();
    t.string('reason_code', 128).notNullable();
    t.string('event_key', 71).notNullable();
    t.timestamp('occurred_at').notNullable();
    t.timestamp('created_at').notNullable();

    t.unique(['proposal_id', 'sequence'], { indexName: 'uq_action_event_sequence' });
    t.unique(['event_key'], { indexName: 'uq_action_event_key' });
    t.index(['tenant_id', 'occurred_at'], 'idx_action_event_timeline');
  });

  for (const table of IMMUTABLE_TABLES) await makeImmutable(knex, table);
  await guardAttempts(knex);
}

export async function down(knex: Knex): Promise<void> {
  await dropAttemptGuards(knex);
  for (const table of [...IMMUTABLE_TABLES].reverse()) await dropImmutable(knex, table);
  await knex.schema.dropTableIfExists('supervised_action_events');
  await knex.schema.dropTableIfExists('supervised_action_attempts');
  await knex.schema.dropTableIfExists('supervised_action_approvals');
  await knex.schema.dropTableIfExists('supervised_action_previews');
  await knex.schema.dropTableIfExists('supervised_action_proposals');
  await knex.schema.dropTableIfExists('supervised_action_policies');
}
