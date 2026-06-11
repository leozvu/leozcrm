import { BaseRepository } from './baseRepository';
import { Campaign, TABLES } from '../domain/types';
import { ValidationError } from '../errors';
import {
  isOneOf,
  isIntInRange,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_STATUSES,
} from '../domain/validate';
import type { Knex } from '../db/knex';

type CampaignWrite = Omit<Partial<Campaign>, 'id' | 'created_at' | 'updated_at'>;

export class CampaignRepository extends BaseRepository<Campaign> {
  constructor(knex?: Knex) {
    super(TABLES.campaigns, knex);
  }

  async listByClient(clientId: string): Promise<Campaign[]> {
    return this.query().where({ client_id: clientId }).orderBy('created_at', 'desc');
  }

  /** Reject malformed field values cleanly (400) before they reach the DB. */
  private validate(data: CampaignWrite): void {
    if (data.channel !== undefined && !isOneOf(CAMPAIGN_CHANNELS, data.channel)) {
      throw new ValidationError(400, `channel must be one of: ${CAMPAIGN_CHANNELS.join(', ')}`, 'invalid_channel');
    }
    if (data.status !== undefined && !isOneOf(CAMPAIGN_STATUSES, data.status)) {
      throw new ValidationError(400, `status must be one of: ${CAMPAIGN_STATUSES.join(', ')}`, 'invalid_status');
    }
    // budget_cents is nullable (no budget); when present it must be a non-negative integer of cents.
    if (
      data.budget_cents !== undefined &&
      data.budget_cents !== null &&
      !isIntInRange(data.budget_cents, 0, Number.MAX_SAFE_INTEGER)
    ) {
      throw new ValidationError(400, 'budget_cents must be a non-negative integer (cents)', 'invalid_budget');
    }
  }

  /** Reject a campaign whose owning client does not exist (400, not a DB 500). */
  async create(data: CampaignWrite): Promise<Campaign> {
    this.validate(data);
    if (data.client_id) {
      const client = await this.getRow(TABLES.clients, data.client_id);
      if (!client) {
        throw new ValidationError(400, `client_id "${data.client_id}" does not exist`, 'unknown_client');
      }
    }
    return super.create(data);
  }

  async update(id: string, data: CampaignWrite): Promise<Campaign | undefined> {
    // A campaign cannot be re-parented to another client (tenant reassignment).
    if (data.client_id !== undefined) {
      throw new ValidationError(409, 'campaign client ownership cannot be reassigned', 'ownership_reassignment');
    }
    this.validate(data);
    return super.update(id, data);
  }
}

export const campaignRepository = new CampaignRepository();
