/**
 * BriefService tests (Milestone #3). Verify the Daily CEO Brief engine produces
 * a deterministic brief that matches the underlying CRM/KPI state, against a
 * fixed-date seed on an in-memory SQLite DB.
 *
 * HTTP concerns (route, status codes, asOf/format handling) are covered in
 * briefRoutes.test.ts. Both suites share support/briefScenario.ts.
 *
 * Run: npm test
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import { MetricsRepository } from '../repositories/metricsRepository';
import { ClientRepository } from '../repositories/clientRepository';
import { BriefService, renderBriefText } from '../services/briefService';
import { ValidationError } from '../errors';
import { seedBriefScenario } from './support/briefScenario';

const db = knexFactory(config.test);
const metrics = new MetricsRepository(db);
const service = new BriefService(metrics);

let clientId: string;
let asOf: string;

before(async () => {
  ({ clientId, asOf } = await seedBriefScenario(db));
});

after(async () => {
  await db.destroy();
});

test('generate rejects a date-shaped but invalid asOf with a 400 ValidationError', async () => {
  // M3 Codex regression: guard before date math so an invalid asOf never 500s.
  await assert.rejects(
    service.generate(clientId, { asOf: '2026-99-99' }),
    (err: unknown) => err instanceof ValidationError && err.status === 400 && err.code === 'invalid_as_of',
  );
});

test('brief headline and funnel exactly match the KPI API output', async () => {
  const brief = await service.generate(clientId, { asOf });
  const funnel = await metrics.funnelByClient(clientId);

  // Headline is the KPI conversion block verbatim.
  assert.deepEqual(brief.headline, {
    total_leads: funnel.conversion.total_leads,
    open: funnel.conversion.open,
    won: funnel.conversion.won,
    lost: funnel.conversion.lost,
    win_rate: funnel.conversion.win_rate,
    overall_conversion_rate: funnel.conversion.overall_conversion_rate,
  });

  // Funnel projection matches the KPI stages one-for-one.
  assert.equal(brief.funnel.length, funnel.stages.length);
  for (let i = 0; i < funnel.stages.length; i++) {
    const s = funnel.stages[i];
    assert.deepEqual(brief.funnel[i], {
      key: s.key,
      name: s.name,
      position: s.position,
      count: s.count,
      reached: s.reached,
      conversion_from_previous: s.conversion_from_previous,
    });
  }

  // Spot-check the known numbers from the fixture.
  assert.equal(brief.headline.total_leads, 7);
  assert.equal(brief.headline.won, 2);
  assert.equal(brief.headline.win_rate, 0.6667);
});

test('brief metadata reflects the requested as-of date', async () => {
  const brief = await service.generate(clientId, { asOf });
  assert.equal(brief.client_id, clientId);
  assert.equal(brief.as_of, asOf);
  // generated_at defaults to the start of as_of when no clock is supplied.
  assert.equal(brief.generated_at, `${asOf}T00:00:00.000Z`);
});

test('acquisition delta compares the recent window to the prior one', async () => {
  const brief = await service.generate(clientId, { asOf });
  assert.deepEqual(brief.delta, {
    window_days: 7,
    recent_leads: 3, // 06-08, 06-09, 06-10
    previous_leads: 4, // 05-29, 05-30, 06-01, 06-02
    change: -1,
    direction: 'down',
  });
});

test('anomalies are the expected deterministic set, in order', async () => {
  const brief = await service.generate(clientId, { asOf });
  const codes = brief.anomalies.map((a) => a.code);
  assert.deepEqual(codes, ['acquisition_down', 'funnel_bottleneck', 'spend_no_conversion']);

  const bottleneck = brief.anomalies.find((a) => a.code === 'funnel_bottleneck')!;
  // Leads reach Conversion but none progress to Activation → bottleneck there.
  assert.match(bottleneck.message, /Activation/);

  const spend = brief.anomalies.find((a) => a.code === 'spend_no_conversion')!;
  assert.match(spend.message, /FB Push/);

  // Every anomaly carries a valid severity.
  for (const a of brief.anomalies) {
    assert.ok(['info', 'warning', 'critical'].includes(a.severity));
  }
});

test('recommended actions map from the detected anomalies', async () => {
  const brief = await service.generate(clientId, { asOf });
  const codes = brief.recommended_actions.map((a) => a.code);
  assert.deepEqual(codes, ['rebuild_top_of_funnel', 'unblock_funnel_stage', 'review_campaign_spend']);

  const unblock = brief.recommended_actions.find((a) => a.code === 'unblock_funnel_stage')!;
  assert.equal(unblock.related_stage, 'activation');

  const spend = brief.recommended_actions.find((a) => a.code === 'review_campaign_spend')!;
  assert.match(spend.rationale, /FB Push/);
});

test('renderBriefText produces a readable summary with the key facts', async () => {
  const brief = await service.generate(clientId, { asOf });
  const text = renderBriefText(brief);

  assert.match(text, /DAILY CEO BRIEF — 2026-06-10/);
  assert.match(text, new RegExp(clientId));
  assert.match(text, /Leads: 7 total/);
  assert.match(text, /Win rate: 67%/);
  assert.match(text, /ANOMALIES/);
  assert.match(text, /RECOMMENDED ACTIONS/);
  assert.match(text, /Unblock the Activation stage/);
});

test('a client with no leads yields a zeroed brief and a maintain-momentum action', async () => {
  const empty = await new ClientRepository(db).create({ name: 'Empty Co', email: 'empty@example.com' });
  const brief = await service.generate(empty.id, { asOf });

  assert.equal(brief.headline.total_leads, 0);
  assert.equal(brief.headline.win_rate, null);
  assert.equal(brief.headline.overall_conversion_rate, 0);
  assert.ok(brief.funnel.every((s) => s.count === 0 && s.reached === 0));
  assert.deepEqual(brief.delta, {
    window_days: 7,
    recent_leads: 0,
    previous_leads: 0,
    change: 0,
    direction: 'flat',
  });
  assert.deepEqual(brief.anomalies, []);
  assert.deepEqual(
    brief.recommended_actions.map((a) => a.code),
    ['maintain_momentum'],
  );
});
