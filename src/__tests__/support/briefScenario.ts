import type { Knex } from 'knex';
import { seedFunnelStages } from '../../db/fixtures';
import { ClientRepository } from '../../repositories/clientRepository';
import { CampaignRepository } from '../../repositories/campaignRepository';
import { LeadRepository } from '../../repositories/leadRepository';
import { FunnelStageRepository } from '../../repositories/funnelStageRepository';

export interface BriefScenario {
  clientId: string;
  campaignFbId: string;
  campaignEmailId: string;
  /** Reference date the brief should be generated for. */
  asOf: string;
}

/**
 * Deterministic fixture for the Daily CEO Brief suites (Milestone #3).
 *
 * Same stage / source / channel / status mix as the metrics fixture (so funnel
 * and conversion numbers match the KPI layer), but each lead is given an
 * explicit `created_at` so the acquisition delta is reproducible regardless of
 * when the test runs.
 *
 * With asOf = 2026-06-10 and a 7-day window:
 *   - recent window 2026-06-04..2026-06-10 → 3 leads (06-08/06-09/06-10)
 *   - prior  window 2026-05-28..2026-06-03 → 4 leads (05-29/05-30/06-01/06-02)
 *   → delta change = 3 - 4 = -1 (down)
 *
 * Client-A aggregates (identical to the metrics fixture):
 *   total 7 · stage counts traffic 2, lead 2, qualification 1, conversion 2
 *   status open 4, won 2, lost 1 · channels facebook 3, email 2, unattributed 2
 *   campaigns FB Push (3 leads, 0 won, budget), Newsletter (2 leads, 1 won)
 *
 * Expected anomalies: acquisition_down, funnel_bottleneck (Activation),
 * spend_no_conversion (FB Push).
 */
export async function seedBriefScenario(db: Knex): Promise<BriefScenario> {
  await db.migrate.latest();
  await seedFunnelStages(db);

  const clients = new ClientRepository(db);
  const campaigns = new CampaignRepository(db);
  const leads = new LeadRepository(db);
  const stages = new FunnelStageRepository(db);

  const byKey = Object.fromEntries((await stages.listOrdered()).map((s) => [s.key, s.id]));

  const client = await clients.create({ name: 'Acme', email: 'acme@example.com' });
  const campFb = await campaigns.create({
    client_id: client.id, name: 'FB Push', channel: 'facebook', status: 'active', budget_cents: 100_000,
  });
  const campEmail = await campaigns.create({
    client_id: client.id, name: 'Newsletter', channel: 'email', status: 'active', budget_cents: 50_000,
  });

  const seedLeads: Array<{
    stage: string;
    campaign_id: string | null;
    source: string;
    status: 'open' | 'won' | 'lost';
    created_at: string; // YYYY-MM-DD
  }> = [
    { stage: 'traffic',       campaign_id: campFb.id,    source: 'fb-ad',      status: 'open', created_at: '2026-06-10' },
    { stage: 'traffic',       campaign_id: campFb.id,    source: 'fb-ad',      status: 'open', created_at: '2026-06-09' },
    { stage: 'lead',          campaign_id: campFb.id,    source: 'fb-ad',      status: 'open', created_at: '2026-06-08' },
    { stage: 'qualification', campaign_id: campEmail.id, source: 'newsletter', status: 'open', created_at: '2026-06-02' },
    { stage: 'conversion',    campaign_id: campEmail.id, source: 'newsletter', status: 'won',  created_at: '2026-06-01' },
    { stage: 'conversion',    campaign_id: null,         source: 'referral',   status: 'won',  created_at: '2026-05-30' },
    { stage: 'lead',          campaign_id: null,         source: 'referral',   status: 'lost', created_at: '2026-05-29' },
  ];

  for (const l of seedLeads) {
    const lead = await leads.create({
      client_id: client.id,
      campaign_id: l.campaign_id,
      funnel_stage_id: byKey[l.stage],
      source: l.source,
      status: l.status,
    });
    // Override the app-set created_at with the fixture's deterministic date
    // (noon UTC keeps the date stable under the trend's UTC day bucketing).
    await db('leads').where({ id: lead.id }).update({ created_at: `${l.created_at}T12:00:00.000Z` });
  }

  return {
    clientId: client.id,
    campaignFbId: campFb.id,
    campaignEmailId: campEmail.id,
    asOf: '2026-06-10',
  };
}
