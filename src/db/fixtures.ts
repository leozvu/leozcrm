import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { FUNNEL_STAGES } from '../domain/funnel';
import { TABLES } from '../domain/types';

/**
 * Idempotently seed the canonical funnel stages from the single source of
 * truth (src/domain/funnel.ts). Parameterized by a Knex instance so the same
 * routine is reused by the seed script (file DB) and the test suite (:memory:).
 */
export async function seedFunnelStages(knex: Knex): Promise<number> {
  for (const stage of FUNNEL_STAGES) {
    const now = new Date().toISOString();
    const existing = await knex(TABLES.funnelStages).where({ key: stage.key }).first();
    if (existing) {
      await knex(TABLES.funnelStages).where({ id: existing.id }).update({
        name: stage.name,
        position: stage.position,
        description: stage.description,
        updated_at: now,
      });
    } else {
      await knex(TABLES.funnelStages).insert({
        id: uuidv4(),
        key: stage.key,
        name: stage.name,
        position: stage.position,
        description: stage.description,
        created_at: now,
        updated_at: now,
      });
    }
  }
  return FUNNEL_STAGES.length;
}
