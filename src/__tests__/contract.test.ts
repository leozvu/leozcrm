/**
 * Data-contract test suite. Runs against an in-memory SQLite database so it is
 * fast and self-contained. Exercises the foundation the dashboard/agents will
 * depend on: migrate -> seed -> CRUD -> funnel counts -> integrity guards ->
 * rollback.
 *
 * Run: npm test
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import { seedFunnelStages } from '../db/fixtures';
import { ClientRepository } from '../repositories/clientRepository';
import { CampaignRepository } from '../repositories/campaignRepository';
import { LeadRepository } from '../repositories/leadRepository';
import { FunnelStageRepository } from '../repositories/funnelStageRepository';
import { ValidationError } from '../errors';
import { DEFAULT_ENTRY_STAGE } from '../domain/funnel';

// One in-memory connection, shared by every repository in the suite.
const db = knexFactory(config.test);
const clients = new ClientRepository(db);
const campaigns = new CampaignRepository(db);
const leads = new LeadRepository(db);
const stages = new FunnelStageRepository(db);

const isValidationError = (status: 400 | 409) => (err: unknown) =>
  err instanceof ValidationError && err.status === status;

before(async () => {
  await db.migrate.latest();
  await seedFunnelStages(db);
});

after(async () => {
  await db.destroy();
});

test('migration seeds the 9 funnel stages in order', async () => {
  const ordered = await stages.listOrdered();
  assert.equal(ordered.length, 9);
  assert.equal(ordered[0].key, 'traffic');
  assert.equal(ordered[8].key, 'retention');
});

test('client -> campaign -> lead creates and funnel counts aggregate', async () => {
  const client = await clients.create({ name: 'Acme', email: 'acme@example.com' });
  const campaign = await campaigns.create({ client_id: client.id, name: 'Q1 Push' });
  const entry = await stages.findByKey(DEFAULT_ENTRY_STAGE);

  const lead = await leads.create({
    client_id: client.id,
    campaign_id: campaign.id,
    funnel_stage_id: entry!.id,
  });

  assert.equal(lead.client_id, client.id);
  assert.equal(lead.campaign_id, campaign.id);

  const counts = await leads.funnelCountsByClient(client.id);
  assert.equal(counts.find((c) => c.funnel_stage_id === entry!.id)?.count, 1);
});

test('campaign create with unknown client_id is rejected (400)', async () => {
  await assert.rejects(
    campaigns.create({ client_id: 'does-not-exist', name: 'Ghost' }),
    isValidationError(400),
  );
});

test('lead create with unknown client_id is rejected (400)', async () => {
  const entry = await stages.findByKey(DEFAULT_ENTRY_STAGE);
  await assert.rejects(
    leads.create({ client_id: 'does-not-exist', funnel_stage_id: entry!.id }),
    isValidationError(400),
  );
});

test('lead create with unknown funnel_stage_id is rejected (400)', async () => {
  const client = await clients.create({ name: 'Beta', email: 'beta@example.com' });
  await assert.rejects(
    leads.create({ client_id: client.id, funnel_stage_id: 'does-not-exist' }),
    isValidationError(400),
  );
});

test('cross-client lead/campaign mismatch is rejected by the repository (409)', async () => {
  const clientA = await clients.create({ name: 'A Co', email: 'a@example.com' });
  const clientB = await clients.create({ name: 'B Co', email: 'b@example.com' });
  const campaignA = await campaigns.create({ client_id: clientA.id, name: 'A Campaign' });
  const entry = await stages.findByKey(DEFAULT_ENTRY_STAGE);

  await assert.rejects(
    leads.create({ client_id: clientB.id, campaign_id: campaignA.id, funnel_stage_id: entry!.id }),
    isValidationError(409),
  );
});

test('cross-client mismatch is ALSO rejected at the DB level (composite FK backstop)', async () => {
  const clientA = await clients.create({ name: 'A2 Co', email: 'a2@example.com' });
  const clientB = await clients.create({ name: 'B2 Co', email: 'b2@example.com' });
  const campaignA = await campaigns.create({ client_id: clientA.id, name: 'A2 Campaign' });
  const entry = await stages.findByKey(DEFAULT_ENTRY_STAGE);
  const now = new Date().toISOString();

  // Bypass repository validation and insert directly: the schema must still refuse.
  await assert.rejects(
    db('leads').insert({
      id: '11111111-1111-1111-1111-111111111111',
      client_id: clientB.id,
      campaign_id: campaignA.id,
      funnel_stage_id: entry!.id,
      score: 0,
      status: 'open',
      entered_stage_at: now,
      created_at: now,
      updated_at: now,
    }),
    (err: any) =>
      /foreign key/i.test(err?.message ?? '') ||
      String(err?.code ?? '').includes('FOREIGNKEY') ||
      err?.code === '23503', // pg foreign_key_violation
  );
});

test('unattributed lead (null campaign_id) is allowed', async () => {
  const client = await clients.create({ name: 'Solo', email: 'solo@example.com' });
  const entry = await stages.findByKey(DEFAULT_ENTRY_STAGE);
  const lead = await leads.create({ client_id: client.id, funnel_stage_id: entry!.id });
  assert.equal(lead.campaign_id, null);
});

test('deleting a campaign nulls its leads (SET NULL) and leads survive', async () => {
  const client = await clients.create({ name: 'Del Co', email: 'del@example.com' });
  const campaign = await campaigns.create({ client_id: client.id, name: 'Doomed' });
  const stage = await stages.findByKey('lead');
  const lead = await leads.create({
    client_id: client.id,
    campaign_id: campaign.id,
    funnel_stage_id: stage!.id,
  });

  await campaigns.remove(campaign.id);

  const after = await leads.findById(lead.id);
  assert.ok(after, 'lead should survive campaign deletion');
  assert.equal(after!.campaign_id, null);
});

test('moveToStage with unknown stage is rejected (400)', async () => {
  const client = await clients.create({ name: 'Mv Co', email: 'mv@example.com' });
  const entry = await stages.findByKey(DEFAULT_ENTRY_STAGE);
  const lead = await leads.create({ client_id: client.id, funnel_stage_id: entry!.id });
  await assert.rejects(leads.moveToStage(lead.id, 'no-such-stage'), isValidationError(400));
});

test('rollback drops all four tables cleanly', async () => {
  await db.migrate.rollback();
  const rows = await db('sqlite_master').where({ type: 'table' }).select('name');
  const names = rows.map((r: { name: string }) => r.name);
  for (const t of ['leads', 'campaigns', 'clients', 'funnel_stages']) {
    assert.ok(!names.includes(t), `expected ${t} to be dropped`);
  }
});
