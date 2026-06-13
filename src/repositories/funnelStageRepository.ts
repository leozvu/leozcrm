import { BaseRepository } from './baseRepository';
import { FunnelStage, TABLES } from '../domain/types';
import type { Knex } from '../db/knex';

export class FunnelStageRepository extends BaseRepository<FunnelStage> {
  constructor(knex?: Knex) {
    super(TABLES.funnelStages, knex);
  }

  /** Stages in funnel order (Traffic -> ... -> Retention). */
  async listOrdered(): Promise<FunnelStage[]> {
    return this.query().select('*').orderBy('position', 'asc');
  }

  async findByKey(key: string): Promise<FunnelStage | undefined> {
    return this.query().where({ key }).first();
  }

  /** How many funnel stages are seeded. Used by the readiness probe (M10). */
  async count(): Promise<number> {
    const [{ c }] = await this.query().count<{ c: string | number }[]>({ c: '*' });
    return Number(c);
  }
}

export const funnelStageRepository = new FunnelStageRepository();
