/**
 * Seed + self-verify.
 *
 * 1. Idempotently seeds the canonical funnel stages (reference data).
 * 2. Inserts one demo client, campaign, and a handful of leads spread across
 *    the funnel — but only if no demo client exists yet (safe to re-run).
 * 3. Reads the data back and prints a funnel snapshot, proving the schema,
 *    foreign keys, and indexes all work end-to-end.
 *
 * Run: npm run seed   (after npm run migrate)
 */
import { db } from './knex';
import { seedFunnelStages } from './fixtures';
import { ValidationError } from '../errors';
import { funnelStageRepository } from '../repositories/funnelStageRepository';
import { clientRepository } from '../repositories/clientRepository';
import { campaignRepository } from '../repositories/campaignRepository';
import { leadRepository } from '../repositories/leadRepository';

const DEMO_CLIENT_EMAIL = 'demo@leozops.ai';
const OTHER_CLIENT_EMAIL = 'integrity-check@leozops.ai';

async function seedDemoData(): Promise<void> {
  if (await clientRepository.findByEmail(DEMO_CLIENT_EMAIL)) {
    console.log('Demo client already present — skipping demo data.');
    return;
  }

  const client = await clientRepository.create({
    name: 'Demo Co',
    email: DEMO_CLIENT_EMAIL,
    company: 'Demo Co LLC',
    status: 'active',
    notes: 'Auto-generated demo client for schema verification.',
  });

  const campaign = await campaignRepository.create({
    client_id: client.id,
    name: 'Spring Launch',
    channel: 'facebook',
    status: 'active',
    budget_cents: 250_000, // $2,500.00
  });

  // Spread demo leads across the early funnel stages.
  const stages = await funnelStageRepository.listOrdered();
  const byKey = Object.fromEntries(stages.map((s) => [s.key, s.id]));
  const demoLeads = [
    { stage: 'traffic',       name: null,            email: null,                 source: 'fb-ad-spring', score: 0 },
    { stage: 'attention',     name: null,            email: null,                 source: 'fb-ad-spring', score: 5 },
    { stage: 'lead',          name: 'Ada Lovelace',  email: 'ada@example.com',    source: 'fb-ad-spring', score: 20 },
    { stage: 'qualification', name: 'Alan Turing',   email: 'alan@example.com',   source: 'referral',     score: 55 },
    { stage: 'conversion',    name: 'Grace Hopper',  email: 'grace@example.com',  source: 'referral',     score: 90 },
  ];

  for (const l of demoLeads) {
    await leadRepository.create({
      client_id: client.id,
      campaign_id: campaign.id,
      funnel_stage_id: byKey[l.stage],
      name: l.name,
      email: l.email,
      source: l.source,
      score: l.score,
      status: l.stage === 'conversion' ? 'won' : 'open',
    });
  }
  console.log(`Seeded demo client, 1 campaign, and ${demoLeads.length} leads.`);
}

async function verify(): Promise<void> {
  const stages = await funnelStageRepository.listOrdered();
  const client = await clientRepository.findByEmail(DEMO_CLIENT_EMAIL);
  if (!client) throw new Error('verification failed: demo client missing');

  const counts = await leadRepository.funnelCountsByClient(client.id);
  const countByStageId = new Map(counts.map((c) => [c.funnel_stage_id, c.count]));

  console.log('\nFunnel snapshot for Demo Co:');
  console.log('  ' + '-'.repeat(40));
  for (const stage of stages) {
    const n = countByStageId.get(stage.id) ?? 0;
    const bar = '#'.repeat(n);
    console.log(`  ${String(stage.position).padStart(2)}. ${stage.name.padEnd(14)} ${String(n).padStart(2)} ${bar}`);
  }
  console.log('  ' + '-'.repeat(40));
  console.log('Schema verified: stages, client, campaign, and leads all queryable.\n');
}

/**
 * Integrity verification: attaching a lead to a campaign owned by a DIFFERENT
 * client must be rejected. Proves the same-client guard is live end-to-end.
 */
async function verifyCrossClientRejected(): Promise<void> {
  const demoClient = await clientRepository.findByEmail(DEMO_CLIENT_EMAIL);
  if (!demoClient) throw new Error('verification failed: demo client missing');
  const demoCampaign = (await campaignRepository.listByClient(demoClient.id))[0];
  const traffic = await funnelStageRepository.findByKey('traffic');
  if (!demoCampaign || !traffic) throw new Error('verification failed: demo fixtures missing');

  const otherClient =
    (await clientRepository.findByEmail(OTHER_CLIENT_EMAIL)) ??
    (await clientRepository.create({ name: 'Integrity Check Co', email: OTHER_CLIENT_EMAIL }));

  try {
    // otherClient's lead pointing at demoClient's campaign — must fail.
    await leadRepository.create({
      client_id: otherClient.id,
      campaign_id: demoCampaign.id,
      funnel_stage_id: traffic.id,
    });
    throw new Error('INTEGRITY CHECK FAILED: a cross-client lead/campaign was allowed.');
  } catch (err) {
    if (err instanceof ValidationError && err.status === 409) {
      console.log(`Integrity check passed: cross-client attribution rejected (HTTP ${err.status}, ${err.code}).`);
      return;
    }
    throw err;
  }
}

async function main() {
  const count = await seedFunnelStages(db);
  console.log(`Seeded ${count} funnel stages.`);
  await seedDemoData();
  await verify();
  await verifyCrossClientRejected();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
