import { BaseRepository } from './baseRepository';
import { Campaign, Lead, TABLES } from '../domain/types';
import { ValidationError } from '../errors';
import type { Knex } from '../db/knex';

type LeadWrite = Omit<Partial<Lead>, 'id' | 'created_at' | 'updated_at'>;

export class LeadRepository extends BaseRepository<Lead> {
  constructor(knex?: Knex) {
    super(TABLES.leads, knex);
  }

  async listByClient(clientId: string): Promise<Lead[]> {
    return this.query().where({ client_id: clientId }).orderBy('created_at', 'desc');
  }

  /**
   * Validate referenced entities BEFORE touching the DB so bad input returns
   * a clean 400/409 instead of a 500 from a foreign-key violation. The schema
   * composite FK is the backstop; this is the friendly front door.
   *
   * @param effectiveClientId the client the lead belongs to (from the patch or
   *        the existing row) — used to enforce same-client campaign attribution.
   */
  private async validateRelations(data: LeadWrite, effectiveClientId?: string): Promise<void> {
    if (data.client_id) {
      const client = await this.getRow(TABLES.clients, data.client_id);
      if (!client) {
        throw new ValidationError(400, `client_id "${data.client_id}" does not exist`, 'unknown_client');
      }
    }

    if (data.funnel_stage_id) {
      const stage = await this.getRow(TABLES.funnelStages, data.funnel_stage_id);
      if (!stage) {
        throw new ValidationError(400, `funnel_stage_id "${data.funnel_stage_id}" does not exist`, 'unknown_funnel_stage');
      }
    }

    // campaign_id === null is an explicit "unattributed" and is always allowed.
    if (data.campaign_id) {
      const campaign = await this.getRow<Campaign>(TABLES.campaigns, data.campaign_id);
      if (!campaign) {
        throw new ValidationError(400, `campaign_id "${data.campaign_id}" does not exist`, 'unknown_campaign');
      }
      const clientId = effectiveClientId ?? data.client_id;
      if (clientId && campaign.client_id !== clientId) {
        throw new ValidationError(
          409,
          `campaign "${data.campaign_id}" belongs to a different client than the lead`,
          'campaign_client_mismatch',
        );
      }
    }
  }

  async create(data: LeadWrite): Promise<Lead> {
    await this.validateRelations(data);
    return super.create(data);
  }

  async update(id: string, data: LeadWrite): Promise<Lead | undefined> {
    // A campaign change must be checked against the lead's existing client.
    if (data.campaign_id || data.funnel_stage_id) {
      const existing = await this.findById(id);
      if (!existing) return undefined;
      await this.validateRelations(data, existing.client_id);
    }
    return super.update(id, data);
  }

  /**
   * Move a lead to a new funnel stage and stamp the entry time.
   * The stage-transition *rules* (which moves are legal) belong to a later
   * service layer — this foundation only records the move.
   */
  async moveToStage(id: string, funnelStageId: string): Promise<Lead | undefined> {
    const stage = await this.getRow(TABLES.funnelStages, funnelStageId);
    if (!stage) {
      throw new ValidationError(400, `funnel_stage_id "${funnelStageId}" does not exist`, 'unknown_funnel_stage');
    }
    return super.update(id, {
      funnel_stage_id: funnelStageId,
      entered_stage_at: new Date().toISOString(),
    } as LeadWrite);
  }

  /** Count of leads in each funnel stage for one client (funnel snapshot). */
  async funnelCountsByClient(clientId: string): Promise<Array<{ funnel_stage_id: string; count: number }>> {
    const rows = await this.query()
      .where({ client_id: clientId })
      .select('funnel_stage_id')
      .count<{ funnel_stage_id: string; count: number }[]>({ count: '*' })
      .groupBy('funnel_stage_id');
    return rows.map((r: any) => ({ funnel_stage_id: r.funnel_stage_id, count: Number(r.count) }));
  }
}

export const leadRepository = new LeadRepository();
