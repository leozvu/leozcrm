/**
 * DashboardService tests (Milestone #5). Verify the Executive Dashboard v0
 * assembler composes the existing read-only layers (KPI funnel, CEO brief,
 * recommendations, lead list + stage names) into one deterministic view model
 * against the shared brief seed on an in-memory SQLite DB.
 *
 * HTTP concerns (route, status codes, rendered HTML) are covered in
 * dashboardRoutes.test.ts. Shares support/briefScenario.ts with the brief/
 * recommendation suites so the underlying numbers line up.
 *
 * Run: npm test
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import { MetricsRepository } from '../repositories/metricsRepository';
import { LeadRepository } from '../repositories/leadRepository';
import { FunnelStageRepository } from '../repositories/funnelStageRepository';
import { ClientRepository } from '../repositories/clientRepository';
import { BriefService } from '../services/briefService';
import { RecommendationService } from '../services/recommendationService';
import { DashboardService } from '../services/dashboardService';
import { ValidationError } from '../errors';
import { seedBriefScenario } from './support/briefScenario';

const db = knexFactory(config.test);

function makeService(): DashboardService {
  const metrics = new MetricsRepository(db);
  const brief = new BriefService(metrics);
  return new DashboardService({
    metrics,
    brief,
    recommendations: new RecommendationService(brief),
    leads: new LeadRepository(db),
    stages: new FunnelStageRepository(db),
    clients: new ClientRepository(db),
  });
}

const service = makeService();

let clientId: string;
let asOf: string;

before(async () => {
  ({ clientId, asOf } = await seedBriefScenario(db));
});

after(async () => {
  await db.destroy();
});

test('build assembles funnel, brief, recommendations, and leads for the seeded client', async () => {
  const view = await service.build(clientId, { asOf });
  assert.ok(view, 'expected a view for the seeded client');

  // Scope + meta.
  assert.equal(view!.client.id, clientId);
  assert.equal(view!.client.name, 'Acme');
  assert.equal(view!.as_of, asOf);
  assert.equal(view!.has_data, true);

  // Funnel section matches the KPI layer (same numbers as /metrics/funnel).
  assert.equal(view!.funnel.total_leads, 7);
  const byKey = Object.fromEntries(view!.funnel.stages.map((s) => [s.key, s]));
  assert.equal(byKey.traffic.count, 2);
  assert.equal(byKey.qualification.reached, 3);
  assert.equal(byKey.qualification.conversion_from_previous, 0.6);

  // Trend section matches the lead-trends KPI (same numbers as /metrics/trends).
  assert.equal(view!.trends.total_leads, 7);
  assert.equal(
    view!.trends.by_day.reduce((sum, p) => sum + p.count, 0),
    7,
  );
  // Oldest day first, every point a valid date with a positive count.
  assert.equal(view!.trends.by_day[0].date, '2026-05-29');
  for (const p of view!.trends.by_day) {
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(p.count > 0);
  }

  // Brief section matches the brief engine.
  assert.equal(view!.brief.headline.total_leads, 7);
  assert.equal(view!.brief.headline.won, 2);

  // Recommendations section matches the recommendation engine (seeded anomalies).
  assert.deepEqual(
    view!.recommendations.recommendations.map((r) => r.code),
    ['unblock_funnel_stage', 'rebuild_top_of_funnel', 'review_campaign_spend'],
  );
});

test('lead list carries each lead with its joined funnel stage name', async () => {
  const view = await service.build(clientId, { asOf });

  assert.equal(view!.leads.length, 7);
  // Every lead resolves to a real stage name (the join succeeded) — no nulls.
  for (const lead of view!.leads) {
    assert.ok(lead.stage_name, 'lead should carry a joined stage name');
    assert.ok(lead.stage_key, 'lead should carry a joined stage key');
  }
  // The seed places two leads at Conversion and two at Traffic.
  const stageCounts = view!.leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.stage_name!] = (acc[l.stage_name!] ?? 0) + 1;
    return acc;
  }, {});
  assert.equal(stageCounts['Conversion'], 2);
  assert.equal(stageCounts['Traffic'], 2);
});

test('an empty client renders honest no-data states (no fabricated values)', async () => {
  const empty = await new ClientRepository(db).create({
    name: 'Empty Co',
    email: 'dash-empty@example.com',
  });
  const view = await service.build(empty.id, { asOf });
  assert.ok(view);

  assert.equal(view!.has_data, false);
  assert.equal(view!.funnel.total_leads, 0);
  // No leads, and (per the M4 empty-client contract) no recommendations.
  assert.deepEqual(view!.leads, []);
  assert.deepEqual(view!.recommendations.recommendations, []);
  // No trend history either — an honest empty series, not a fabricated point.
  assert.equal(view!.trends.total_leads, 0);
  assert.deepEqual(view!.trends.by_day, []);
  // Brief headline is zeroed, not absent.
  assert.equal(view!.brief.headline.total_leads, 0);
});

test('build returns null for an unknown client', async () => {
  const view = await service.build('does-not-exist', { asOf });
  assert.equal(view, null);
});

test('build rejects a date-shaped but invalid asOf with a 400 ValidationError', async () => {
  await assert.rejects(
    service.build(clientId, { asOf: '2026-99-99' }),
    (err: unknown) => err instanceof ValidationError && err.status === 400 && err.code === 'invalid_as_of',
  );
});
