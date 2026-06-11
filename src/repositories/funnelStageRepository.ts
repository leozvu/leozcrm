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
}

export const funnelStageRepository = new FunnelStageRepository();
