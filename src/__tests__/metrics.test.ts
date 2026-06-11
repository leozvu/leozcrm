/**
 * MetricsRepository tests (Milestone #2). These verify the KPI *aggregation
 * logic* directly against a known, deterministic seed on an in-memory SQLite DB
 * — same architecture as contract.test.ts.
 *
 * HTTP concerns (route mounting, clientId validation, status codes, and the
 * serialized JSON response contract) are covered separately at the HTTP
 * boundary in metricsRoutes.test.ts. Both suites share the same fixture
 * (support/metricsScenario.ts) so the numbers asserted here and there match.
 *
 * Run: npm test
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import { MetricsRepository } from '../repositories/metricsRepository';
import { seedMetricsScenario } from './support/metricsScenario';

const db = knexFactory(config.test);
const metrics = new MetricsRepository(db);

let clientAId: string;
let campaignFbId: string;
let campaignEmailId: string;

before(async () => {
  ({ clientAId, campaignFbId, campaignEmailId } = await seedMetricsScenario(db));
});

after(async () => {
  await db.destroy();
});

test('MetricsRepository.funnelByClient — stage counts, cumulative reach, and conversion rates', async () => {
  const m = await metrics.funnelByClient(clientAId);

  assert.equal(m.client_id, clientAId);
  assert.equal(m.total_leads, 7);
  assert.equal(m.stages.length, 9);

  const byKey = Object.fromEntries(m.stages.map((s) => [s.key, s]));
  // Current-stage counts.
  assert.equal(byKey.traffic.count, 2);
  assert.equal(byKey.lead.count, 2);
  assert.equal(byKey.qualification.count, 1);
  assert.equal(byKey.conversion.count, 2);
  assert.equal(byKey.nurture.count, 0);

  // Cumulative "reached" walks down the funnel: 7,5,5,3,2,2,0,0,0.
  assert.equal(byKey.traffic.reached, 7);
  assert.equal(byKey.lead.reached, 5);
  assert.equal(byKey.qualification.reached, 3);
  assert.equal(byKey.conversion.reached, 2);
  assert.equal(byKey.retention.reached, 0);

  // First stage has no predecessor; later steps are reached/previousReached.
  assert.equal(byKey.traffic.conversion_from_previous, null);
  assert.equal(byKey.qualification.conversion_from_previous, 0.6); // 3/5

  // Status-derived conversion rates.
  assert.equal(m.conversion.open, 4);
  assert.equal(m.conversion.won, 2);
  assert.equal(m.conversion.lost, 1);
  assert.equal(m.conversion.win_rate, 0.6667); // 2/(2+1)
  assert.equal(m.conversion.overall_conversion_rate, 0.2857); // 2/7
});

test('MetricsRepository.volumeBySource — lead volume grouped by source', async () => {
  const m = await metrics.volumeBySource(clientAId);

  assert.equal(m.client_id, clientAId);
  assert.equal(m.total_leads, 7);
  const counts = Object.fromEntries(m.by_source.map((b) => [b.source, b.count]));
  assert.deepEqual(counts, { 'fb-ad': 3, newsletter: 2, referral: 2 });
  // Scoped: client B's 'b-only' source must not appear.
  assert.ok(!m.by_source.some((b) => b.source === 'b-only'));
});

test('MetricsRepository.volumeByChannel — lead volume grouped by campaign channel', async () => {
  const m = await metrics.volumeByChannel(clientAId);

  assert.equal(m.client_id, clientAId);
  assert.equal(m.total_leads, 7);
  const counts = Object.fromEntries(m.by_channel.map((b) => [b.channel, b.count]));
  // facebook: 3 leads, email: 2, no-campaign leads bucket under 'unattributed': 2.
  assert.deepEqual(counts, { facebook: 3, email: 2, unattributed: 2 });
});

test('MetricsRepository.campaignAttribution — per-campaign attribution + unattributed count', async () => {
  const m = await metrics.campaignAttribution(clientAId);

  assert.equal(m.client_id, clientAId);
  assert.equal(m.campaigns.length, 2);
  const byId = Object.fromEntries(m.campaigns.map((c) => [c.campaign_id, c]));

  assert.equal(byId[campaignFbId].lead_count, 3);
  assert.equal(byId[campaignFbId].won_count, 0);
  assert.equal(byId[campaignFbId].budget_cents, 100_000);
  assert.equal(byId[campaignFbId].channel, 'facebook');

  assert.equal(byId[campaignEmailId].lead_count, 2);
  assert.equal(byId[campaignEmailId].won_count, 1);
  assert.equal(byId[campaignEmailId].budget_cents, 50_000);

  // Two client-A leads have no campaign.
  assert.equal(m.unattributed_leads, 2);
});

test('MetricsRepository.leadTrends — lead-creation volume bucketed by day', async () => {
  const m = await metrics.leadTrends(clientAId);

  assert.equal(m.client_id, clientAId);
  assert.equal(m.total_leads, 7);
  // Buckets reconcile to the total and are well-formed, sorted UTC days.
  assert.equal(m.by_day.reduce((sum, p) => sum + p.count, 0), 7);
  for (const p of m.by_day) {
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(p.count > 0);
  }
  const dates = m.by_day.map((p) => p.date);
  assert.deepEqual(dates, [...dates].sort((a, b) => a.localeCompare(b)));
});

test('MetricsRepository scopes per client — an unknown client yields zeroed metrics', async () => {
  const m = await metrics.funnelByClient('does-not-exist');
  assert.equal(m.total_leads, 0);
  assert.equal(m.conversion.win_rate, null);
  assert.equal(m.conversion.overall_conversion_rate, 0);
  assert.ok(m.stages.every((s) => s.count === 0 && s.reached === 0));
});
