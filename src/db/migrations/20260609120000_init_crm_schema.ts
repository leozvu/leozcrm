import type { Knex } from 'knex';

/**
 * Initial CRM schema: funnel_stages, clients, campaigns, leads.
 *
 * Rollback-safe: every object created in `up()` is dropped in `down()` in
 * strict reverse dependency order, so `migrate:rollback` returns the database
 * to a clean empty state with no orphaned tables, indexes, or constraints.
 *
 * Portability: written entirely with Knex's schema builder and UUID primary
 * keys supplied by the application layer, so the same file runs on both
 * SQLite (dev/test) and PostgreSQL (production) without edits.
 */

export async function up(knex: Knex): Promise<void> {
  // ---- funnel_stages : the canonical funnel, referenced by every lead ----
  await knex.schema.createTable('funnel_stages', (t) => {
    t.uuid('id').primary();
    t.string('key').notNullable().unique();      // e.g. "qualification"
    t.string('name').notNullable();              // e.g. "Qualification"
    t.integer('position').notNullable().unique(); // 1..9 funnel order
    t.text('description').nullable();
    t.timestamps(true, true); // created_at, updated_at (default now)

    t.index(['position'], 'idx_funnel_stages_position');
  });

  // ---- clients : the agency's customers ----
  await knex.schema.createTable('clients', (t) => {
    t.uuid('id').primary();
    t.string('name').notNullable();
    t.string('email').notNullable();
    t.string('company').nullable();
    t.string('status').notNullable().defaultTo('active'); // active|paused|churned
    t.text('notes').nullable();
    t.timestamps(true, true);

    t.index(['status'], 'idx_clients_status');
    t.index(['email'], 'idx_clients_email');
  });

  // ---- campaigns : marketing efforts owned by a client ----
  await knex.schema.createTable('campaigns', (t) => {
    t.uuid('id').primary();
    t.uuid('client_id').notNullable()
      .references('id').inTable('clients').onDelete('CASCADE');
    t.string('name').notNullable();
    t.string('channel').notNullable().defaultTo('other'); // placeholder label
    t.string('status').notNullable().defaultTo('draft');  // draft|active|paused|completed
    t.integer('budget_cents').nullable();                 // money as integer cents
    t.timestamp('started_at').nullable();
    t.timestamp('ended_at').nullable();
    t.timestamps(true, true);

    t.index(['client_id'], 'idx_campaigns_client_id');
    t.index(['status'], 'idx_campaigns_status');
    // Hot path: "active campaigns for client X".
    t.index(['client_id', 'status'], 'idx_campaigns_client_status');
    // Unique (client_id, id) is the target for the leads composite FK below,
    // which enforces that a lead's campaign belongs to the lead's client.
    t.unique(['client_id', 'id'], { indexName: 'uq_campaigns_client_id_id' });
  });

  // ---- leads : contacts moving through the funnel ----
  await knex.schema.createTable('leads', (t) => {
    t.uuid('id').primary();
    t.uuid('client_id').notNullable()
      .references('id').inTable('clients').onDelete('CASCADE');
    // A lead may exist before being attributed to a campaign.
    t.uuid('campaign_id').nullable()
      .references('id').inTable('campaigns').onDelete('SET NULL');
    // RESTRICT: a funnel stage cannot be deleted while leads still sit in it.
    t.uuid('funnel_stage_id').notNullable()
      .references('id').inTable('funnel_stages').onDelete('RESTRICT');
    t.string('name').nullable();   // anonymous at Traffic/Attention
    t.string('email').nullable();
    t.string('phone').nullable();
    t.string('source').nullable(); // free-text origin label
    t.integer('score').notNullable().defaultTo(0);       // 0..100 qualification
    t.string('status').notNullable().defaultTo('open');  // open|won|lost
    t.timestamp('entered_stage_at').notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);

    t.index(['client_id'], 'idx_leads_client_id');
    t.index(['campaign_id'], 'idx_leads_campaign_id');
    t.index(['funnel_stage_id'], 'idx_leads_funnel_stage_id');
    t.index(['status'], 'idx_leads_status');
    t.index(['email'], 'idx_leads_email');
    t.index(['created_at'], 'idx_leads_created_at');
    // Hot path: funnel breakdown per client ("how many leads in each stage").
    t.index(['client_id', 'funnel_stage_id'], 'idx_leads_client_stage');

    // Same-client integrity: when a lead IS attributed to a campaign, that
    // campaign must belong to the lead's client. The single-column campaign_id
    // FK above (ON DELETE SET NULL) handles graceful campaign deletion; this
    // composite FK is the integrity guard. Because campaign_id is nullable,
    // unattributed leads (campaign_id IS NULL) skip this check entirely
    // (SQL MATCH SIMPLE / SQLite null semantics).
    t.foreign(['client_id', 'campaign_id'], 'fk_leads_campaign_same_client')
      .references(['client_id', 'id'])
      .inTable('campaigns');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Reverse dependency order so FKs never block a drop.
  await knex.schema.dropTableIfExists('leads');
  await knex.schema.dropTableIfExists('campaigns');
  await knex.schema.dropTableIfExists('clients');
  await knex.schema.dropTableIfExists('funnel_stages');
}
