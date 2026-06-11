/**
 * RecommendationService tests (Milestone #4). Verify the advisory recommendation
 * engine deterministically maps funnel/brief state into prioritised, categorised
 * recommendations, against the shared brief seed on an in-memory SQLite DB.
 *
 * HTTP concerns (route, status codes, asOf handling) are covered in
 * recommendationsRoutes.test.ts. Shares support/briefScenario.ts with the brief
 * suites so the underlying numbers line up.
 *
 * Run: npm test
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import { MetricsRepository } from '../repositories/metricsRepository';
import { ClientRepository } from '../repositories/clientRepository';
import { BriefService } from '../services/briefService';
import { RecommendationService } from '../services/recommendationService';
import { ValidationError } from '../errors';
import { seedBriefScenario } from './support/briefScenario';

const db = knexFactory(config.test);
const service = new RecommendationService(new BriefService(new MetricsRepository(db)));

let clientId: string;
let asOf: string;

before(async () => {
  ({ clientId, asOf } = await seedBriefScenario(db));
});

after(async () => {
  await db.destroy();
});

test('recommendations are derived, categorised, and prioritised from funnel state', async () => {
  const report = await service.generate(clientId, { asOf });

  assert.equal(report.client_id, clientId);
  assert.equal(report.as_of, asOf);

  // Seeded anomalies (acquisition_down, funnel_bottleneck, spend_no_conversion)
  // map to recommendations, sorted high → medium (stable within a tier).
  assert.deepEqual(
    report.recommendations.map((r) => ({ code: r.code, category: r.category, priority: r.priority })),
    [
      { code: 'unblock_funnel_stage', category: 'conversion', priority: 'high' },
      { code: 'rebuild_top_of_funnel', category: 'acquisition', priority: 'medium' },
      { code: 'review_campaign_spend', category: 'spend', priority: 'medium' },
    ],
  );

  // related_stage and wording are carried through from the brief's actions.
  const unblock = report.recommendations.find((r) => r.code === 'unblock_funnel_stage')!;
  assert.equal(unblock.related_stage, 'activation');
  assert.match(unblock.title, /Activation/);

  const spend = report.recommendations.find((r) => r.code === 'review_campaign_spend')!;
  assert.match(spend.rationale, /FB Push/);
});

test('every recommendation and the report are advisory-only', async () => {
  const report = await service.generate(clientId, { asOf });
  assert.equal(report.advisory_only, true);
  assert.ok(report.recommendations.length > 0);
  for (const r of report.recommendations) {
    assert.equal(r.advisory_only, true);
  }
});

test('reports are sorted by priority, high first', async () => {
  const report = await service.generate(clientId, { asOf });
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const ranks = report.recommendations.map((r) => rank[r.priority]);
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i] >= ranks[i - 1], 'recommendations must be ordered high → low');
  }
});

test('a healthy client (no leads) gets a single maintain-momentum recommendation', async () => {
  const empty = await new ClientRepository(db).create({ name: 'Empty Co', email: 'rec-empty@example.com' });
  const report = await service.generate(empty.id, { asOf });

  assert.equal(report.advisory_only, true);
  assert.deepEqual(
    report.recommendations.map((r) => ({ code: r.code, category: r.category, priority: r.priority })),
    [{ code: 'maintain_momentum', category: 'retention', priority: 'low' }],
  );
  assert.equal(report.recommendations[0].advisory_only, true);
});

test('generate rejects a date-shaped but invalid asOf with a 400 ValidationError', async () => {
  await assert.rejects(
    service.generate(clientId, { asOf: '2026-99-99' }),
    (err: unknown) => err instanceof ValidationError && err.status === 400 && err.code === 'invalid_as_of',
  );
});
