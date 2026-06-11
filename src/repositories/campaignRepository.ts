import { BaseRepository } from './baseRepository';
import { Campaign, TABLES } from '../domain/types';
import { ValidationError } from '../errors';
import type { Knex } from '../db/knex';

export class CampaignRepository extends BaseRepository<Campaign> {
  constructor(knex?: Knex) {
    super(TABLES.campaigns, knex);
  }

  async listByClient(clientId: string): Promise<Campaign[]> {
    return this.query().where({ client_id: clientId }).orderBy('created_at', 'desc');
  }

  /** Reject a campaign whose owning client does not exist (400, not a DB 500). */
  async create(
    data: Omit<Partial<Campaign>, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<Campaign> {
    if (data.client_id) {
      const client = await this.getRow(TABLES.clients, data.client_id);
      if (!client) {
        throw new ValidationError(400, `client_id "${data.client_id}" does not exist`, 'unknown_client');
      }
    }
    return super.create(data);
  }
}

export const campaignRepository = new CampaignRepository();
