import type { Knex } from 'knex';
import { seedFunnelStages } from '../../db/fixtures';
import { ClientRepository } from '../../repositories/clientRepository';
import { CampaignRepository } from '../../repositories/campaignRepository';
import { LeadRepository } from '../../repositories/leadRepository';
import { FunnelStageRepository } from '../../repositories/funnelStageRepository';

export interface MetricsScenario {
  clientAId: string;
  campaignFbId: string; // facebook channel
  campaignEmailId: string; // email channel
}

/**
 * Deterministic KPI fixture shared by the repository-level (metrics.test.ts) and
 * HTTP route-level (metricsRoutes.test.ts) suites, so both assert against the
 * exact same known data.
 *
 * Migrates + seeds the funnel stages, then builds:
 *   - Client A: 2 campaigns (facebook, email) + 7 leads with a fixed stage /
 *     source / channel / status mix.
 *   - Client B: 1 isolated lead that must never appear in client A's metrics.
 *
 * Expected client-A aggregates:
 *   - total leads: 7
 *   - stage counts: traffic 2, lead 2, qualification 1, conversion 2
 *   - status: open 4, won 2, lost 1
 *   - by source: fb-ad 3, newsletter 2, referral 2
 *   - by channel: facebook 3, email 2, unattributed 2
 *   - campaigns: FB Push (3 leads, 0 won), Newsletter (2 leads, 1 won); 2 unattributed
 */
export async function seedMetricsScenario(db: Knex): Promise<MetricsScenario> {
  await db.migrate.latest();
  await seedFunnelStages(db);

  const clients = new ClientRepository(db);
  const campaigns = new CampaignRepository(db);
  const leads = new LeadRepository(db);
  const stages = new FunnelStageRepository(db);

  const byKey = Object.fromEntries((await stages.listOrdered()).map((s) => [s.key, s.id]));

  const clientA = await clients.create({ name: 'Acme', email: 'acme@example.com' });
  const campFb = await campaigns.create({
    client_id: clientA.id, name: 'FB Push', channel: 'facebook', status: 'active', budget_cents: 100_000,
  });
  const campEmail = await campaigns.create({
    client_id: clientA.id, name: 'Newsletter', channel: 'email', status: 'active', budget_cents: 50_000,
  });

  const seedLeads: Array<{ stage: string; campaign_id: string | null; source: string; status: 'open' | 'won' | 'lost' }> = [
    { stage: 'traffic',       campaign_id: campFb.id,    source: 'fb-ad',      status: 'open' },
    { stage: 'traffic',       campaign_id: campFb.id,    source: 'fb-ad',      status: 'open' },
    { stage: 'lead',          campaign_id: campFb.id,    source: 'fb-ad',      status: 'open' },
    { stage: 'qualification', campaign_id: campEmail.id, source: 'newsletter', status: 'open' },
    { stage: 'conversion',    campaign_id: campEmail.id, source: 'newsletter', status: 'won' },
    { stage: 'conversion',    campaign_id: null,         source: 'referral',   status: 'won' },
    { stage: 'lead',          campaign_id: null,         source: 'referral',   status: 'lost' },
  ];
  for (const l of seedLeads) {
    await leads.create({
      client_id: clientA.id,
      campaign_id: l.campaign_id,
      funnel_stage_id: byKey[l.stage],
      source: l.source,
      status: l.status,
    });
  }

  // Client B: isolated noise that must never appear in client A's metrics.
  const clientB = await clients.create({ name: 'Other Co', email: 'other@example.com' });
  await leads.create({ client_id: clientB.id, funnel_stage_id: byKey.traffic, source: 'b-only', status: 'open' });

  return { clientAId: clientA.id, campaignFbId: campFb.id, campaignEmailId: campEmail.id };
}
