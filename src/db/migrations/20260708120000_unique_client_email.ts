import type { Knex } from 'knex';

/**
 * DB-level tenant-email uniqueness (Codex M10 review, nice-to-have #3).
 *
 * Onboarding already refuses a duplicate email at the application layer, but a
 * race (two concurrent onboarding calls) could slip past that check. This adds
 * the authoritative guard in the schema. Emails are normalized (trim +
 * lowercase) at the repository boundary as of the same change, so the unique
 * index can be a plain exact-match index — dialect-portable across SQLite and
 * PostgreSQL.
 *
 * The `up` first lowercases any pre-existing rows so legacy mixed-case values
 * cannot collide with the canonical form later. If two existing rows differ
 * only by case, creating the index fails loudly — the operator must merge the
 * duplicate tenants before deploying (silently dropping one would lose data).
 *
 * Rollback-safe: `down` drops only the index; no data is touched.
 */

export async function up(knex: Knex): Promise<void> {
  await knex('clients').update({ email: knex.raw('lower(trim(email))') });
  await knex.schema.alterTable('clients', (table) => {
    table.unique(['email'], { indexName: 'uq_clients_email' });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clients', (table) => {
    table.dropUnique(['email'], 'uq_clients_email');
  });
}
