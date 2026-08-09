import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import {
  PLANNER_GOAL_SCHEMA,
  PLANNER_TABLES,
  PlannerCheckpointRecord,
  PlannerGoalManifest,
  plannerHash,
  validatePlannerGoal,
} from '../domain/planner';
import { EGORIC_SCHEMA_VERSION, EgoricSalesLead } from '../domain/businessMemory';
import { createApp } from '../http/app';
import { signTenantReadToken } from '../http/integrationReadAuth';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { normalizePlannerCheckpointRecord, PlannerRepository } from '../repositories/plannerRepository';
import { EgoricBriefService } from '../services/egoricBriefService';
import { PlannerService } from '../services/plannerService';
import { buildEgoricSnapshot, DEFAULT_EGORIC_LEADS } from './support/egoricMemoryScenario';

const db = knexFactory(config.test);
const AUTH = { secret: 'phase13-read-secret', adminKey: 'phase13-admin-key' };
let sequence = 0;

before(async () => { await db.migrate.latest(); });
after(async () => { await db.destroy(); });

test('PostgreSQL Date timestamps normalize before checkpoint integrity verification', () => {
  const core = {
    tenant_id: '550e8400-e29b-41d4-a716-446655440000',
    plan_id: '550e8400-e29b-41d4-a716-446655440001',
    idempotency_key: 'postgres-date-checkpoint',
    source_snapshot_id: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    intelligence_run_id: '550e8400-e29b-41d4-a716-446655440002',
    metric_key: 'active_pipeline' as const,
    observed_value: 3,
    target_value: 5,
    freshness_status: 'fresh' as const,
    verdict: 'no_progress' as const,
    observed_at: '2026-08-09T04:40:00.000Z',
  };
  const row = {
    id: '550e8400-e29b-41d4-a716-446655440003',
    ...core,
    observed_at: new Date(core.observed_at),
    evidence_hash: plannerHash(core),
    created_at: new Date(core.observed_at),
  } as unknown as PlannerCheckpointRecord;
  const normalized = normalizePlannerCheckpointRecord(row);
  assert.equal(normalized.observed_at, core.observed_at);
  assert.equal(normalized.created_at, core.observed_at);
});

function goal(input: {
  key?: string;
  target?: number;
  maxSteps?: number;
  maxEffort?: number;
  actionCandidates?: boolean;
  evidenceKeys?: string[];
} = {}): PlannerGoalManifest {
  return {
    schema_version: PLANNER_GOAL_SCHEMA,
    goal_key: input.key ?? 'grow_active_pipeline',
    title: 'Grow the evidence-backed active pipeline',
    metric: { key: 'active_pipeline', direction: 'increase', target_value: input.target ?? 5, unit: 'count' },
    horizon: { starts_on: '2026-07-28', target_on: '2026-08-31' },
    constraints: {
      max_steps: input.maxSteps ?? 4,
      max_effort_points: input.maxEffort ?? 10,
      action_candidates_allowed: input.actionCandidates ?? true,
    },
    assumptions: [{
      key: 'snapshot_represents_pipeline',
      statement: 'The accepted source snapshot represents the current pipeline boundary.',
      confidence: 'medium',
      evidence_keys: input.evidenceKeys ?? ['brief.provenance.source_snapshot_id'],
    }],
    owner: 'founder',
  };
}

async function harness(input: { leads?: EgoricSalesLead[]; now?: string; generatedAt?: string } = {}) {
  sequence += 1;
  let now = input.now ?? '2026-07-28T23:00:00.000Z';
  const clock = () => new Date(now);
  const tenantKey = `planner-${sequence}`;
  const sourceTenantKey = `planner-source-${sequence}`;
  const memory = new BusinessMemoryRepository(db, clock);
  const tenant = await memory.ensureTenant({ tenantKey, displayName: `Planner ${sequence}` });
  const connection = await memory.ensureSourceConnection({
    tenantId: tenant.id,
    sourceSystem: 'egoric',
    sourceTenantKey,
    schemaVersion: EGORIC_SCHEMA_VERSION,
    endpointUrl: `https://planner-${sequence}.example/api/integrations/leozops/v1/lead-snapshot`,
  });
  const accept = async (leads: EgoricSalesLead[], at: string, generatedAt?: string) => {
    now = at;
    return memory.acceptSnapshot({
      tenantId: tenant.id,
      sourceConnectionId: connection.id,
      payload: buildEgoricSnapshot({
        sourceTenantKey,
        leads,
        generatedAt: generatedAt ?? new Date(Date.parse(at) - 10 * 60_000).toISOString(),
      }),
      engineVersion: 'egoric_ingestion_v1',
      asOf: at,
    });
  };
  await accept(input.leads ?? DEFAULT_EGORIC_LEADS, now, input.generatedAt);
  const repository = new PlannerRepository(db, clock);
  const service = new PlannerService(repository, memory, new EgoricBriefService(memory), clock);
  return { tenantKey, tenant, memory, repository, service, accept, clock, setNow(value: string) { now = value; } };
}

async function createGoal(run: Awaited<ReturnType<typeof harness>>, manifest = goal(), key = `goal:${randomUUID()}`) {
  return run.service.createGoal(run.tenantKey, { idempotencyKey: key, goal: manifest });
}

test('goal contract rejects unknown fields, mismatched units, and unsafe horizons', () => {
  assert.deepEqual(validatePlannerGoal(goal()), goal());
  assert.throws(() => validatePlannerGoal({ ...goal(), surprise: true }), /missing or unsupported/);
  const badUnit = structuredClone(goal()) as any;
  badUnit.metric.unit = 'basis_points';
  assert.throws(() => validatePlannerGoal(badUnit), /unit does not match/);
  const badHorizon = structuredClone(goal()) as any;
  badHorizon.horizon.target_on = '2030-01-01';
  assert.throws(() => validatePlannerGoal(badHorizon), /between 1 and 730 days/);
});

test('goal and plan versions are append-only, idempotent, and never silently rewritten', async () => {
  const run = await harness();
  const first = await createGoal(run, goal(), 'goal-v1');
  const replay = await createGoal(run, goal(), 'goal-v1');
  assert.equal(replay.replayed, true);
  assert.equal(replay.goal.id, first.goal.id);
  await assert.rejects(
    () => createGoal(run, goal({ target: 6 }), 'goal-v1'),
    (error: any) => error.code === 'goal_idempotency_conflict',
  );
  const firstPlan = await run.service.generatePlan(run.tenantKey, {
    goalVersionId: first.goal.id, planKey: 'versioned-plan', strategy: 'balanced',
    asOf: '2026-07-28T23:00:00.000Z', idempotencyKey: 'versioned-plan-v1',
  });

  const second = await run.service.createGoal(run.tenantKey, {
    idempotencyKey: 'goal-v2', previousGoalVersionId: first.goal.id, goal: goal({ target: 6 }),
  });
  assert.equal(second.goal.version, 2);
  assert.equal(second.goal.previous_goal_version_id, first.goal.id);
  await assert.rejects(
    () => run.service.generatePlan(run.tenantKey, {
      goalVersionId: first.goal.id, planKey: 'superseded-plan', strategy: 'balanced',
      asOf: '2026-07-28T23:00:00.000Z', idempotencyKey: 'superseded-plan-v1',
    }),
    (error: any) => error.code === 'goal_version_superseded',
  );
  await assert.rejects(
    () => run.service.generatePlan(run.tenantKey, {
      goalVersionId: second.goal.id, planKey: 'versioned-plan', strategy: 'balanced',
      asOf: '2026-07-28T23:00:00.000Z', idempotencyKey: 'versioned-plan-missing-link',
    }),
    (error: any) => error.code === 'plan_version_required',
  );
  const secondPlan = await run.service.generatePlan(run.tenantKey, {
    goalVersionId: second.goal.id, planKey: 'versioned-plan', strategy: 'balanced',
    asOf: '2026-07-28T23:00:00.000Z', idempotencyKey: 'versioned-plan-v2',
    replacesPlanId: firstPlan.view.plan.id,
  });
  assert.equal(secondPlan.view.plan.version, 2);
  assert.equal(secondPlan.view.plan.previous_plan_version_id, firstPlan.view.plan.id);

  const other = await harness();
  const identical = await createGoal(other, goal(), 'same-manifest-other-tenant');
  assert.equal(identical.goal.manifest_hash, first.goal.manifest_hash);
  assert.notEqual(identical.goal.tenant_id, first.goal.tenant_id);
});

test('planner is deterministic on replay and keeps every action-shaped step behind G6', async () => {
  const run = await harness();
  const created = await createGoal(run);
  const input = {
    goalVersionId: created.goal.id,
    planKey: 'pipeline-plan',
    strategy: 'balanced' as const,
    asOf: '2026-07-28T23:00:00.000Z',
    idempotencyKey: 'pipeline-plan-v1',
  };
  const first = await run.service.generatePlan(run.tenantKey, input);
  const replay = await run.service.generatePlan(run.tenantKey, input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.view.plan.plan_hash, first.view.plan.plan_hash);
  assert.deepEqual(replay.view.steps.map((row) => row.step_hash), first.view.steps.map((row) => row.step_hash));
  assert.equal(first.view.plan.advisory_only, true);
  assert.equal(first.view.plan.action_authority, 'none');
  assert.equal(first.view.plan.baseline_value, 3);
  assert.deepEqual(first.view.steps.map((row) => row.step_key), [
    'verify_baseline', 'review_exceptions', 'prepare_supervised_proposal', 'measure_checkpoint',
  ]);
  const candidate = first.view.steps.find((row) => row.kind === 'action_candidate');
  assert.equal(candidate?.action_route, 'g6_supervised_action');
  assert.equal(candidate?.execution_state, 'not_authorized');
  assert.equal(JSON.stringify(candidate).includes('payload'), false);
  assert.deepEqual(first.view.simulations.map((row) => row.scenario), ['ambitious', 'conservative', 'expected']);

  const rateManifest = goal({ key: 'improve_win_rate' });
  rateManifest.metric = { key: 'win_rate', direction: 'increase', target_value: 6_000, unit: 'basis_points' };
  const rateGoal = await createGoal(run, rateManifest, 'win-rate-goal');
  const ratePlan = await run.service.generatePlan(run.tenantKey, {
    goalVersionId: rateGoal.goal.id, planKey: 'win-rate-plan', strategy: 'balanced',
    asOf: '2026-07-28T23:00:00.000Z', idempotencyKey: 'win-rate-plan-v1',
  });
  assert.equal(ratePlan.view.plan.baseline_value, 5_000);
});

test('conflicts block acceptance while simulations and comparison remain advisory', async () => {
  const run = await harness();
  const blockedGoal = await createGoal(run, goal({ maxSteps: 3, maxEffort: 4 }), 'blocked-goal');
  const blocked = await run.service.generatePlan(run.tenantKey, {
    goalVersionId: blockedGoal.goal.id, planKey: 'blocked-plan', strategy: 'accelerated',
    asOf: '2026-07-28T23:00:00.000Z', idempotencyKey: 'blocked-plan-v1',
  });
  assert.equal(blocked.view.plan.conflict_status, 'blocking');
  assert.deepEqual(blocked.view.conflicts.map((row) => row.conflict_key), ['effort_budget_exceeded', 'step_capacity_exceeded']);
  assert.ok(blocked.view.simulations.every((row) => row.feasibility === 'blocked'));
  await assert.rejects(
    () => run.service.decide(run.tenantKey, {
      planId: blocked.view.plan.id, idempotencyKey: 'accept-blocked', decision: 'accepted', reasonCode: 'founder_reviewed',
    }),
    (error: any) => error.code === 'plan_has_blocking_conflicts',
  );

  const clearGoal = await createGoal(run, goal({ key: 'grow_second_pipeline' }), 'clear-goal');
  const conservative = await run.service.generatePlan(run.tenantKey, {
    goalVersionId: clearGoal.goal.id, planKey: 'conservative-plan', strategy: 'conservative',
    asOf: '2026-07-28T23:00:00.000Z', idempotencyKey: 'conservative-plan-v1',
  });
  const accelerated = await run.service.generatePlan(run.tenantKey, {
    goalVersionId: clearGoal.goal.id, planKey: 'accelerated-plan', strategy: 'accelerated',
    asOf: '2026-07-28T23:00:00.000Z', idempotencyKey: 'accelerated-plan-v1',
  });
  const comparison = await run.service.compare(run.tenantKey, conservative.view.plan.id, accelerated.view.plan.id);
  assert.equal(comparison.preferred_plan_id, accelerated.view.plan.id);
  assert.equal(comparison.advisory_only, true);
  assert.equal(comparison.grants_action_authority, false);
  assert.match(comparison.comparison_hash, /^sha256:[0-9a-f]{64}$/);
});

test('decision, checkpoint, and outcome form an immutable feedback loop without action authority', async () => {
  const run = await harness();
  const created = await createGoal(run);
  const generated = await run.service.generatePlan(run.tenantKey, {
    goalVersionId: created.goal.id, planKey: 'feedback-plan', strategy: 'balanced',
    asOf: '2026-07-28T23:00:00.000Z', idempotencyKey: 'feedback-plan-v1',
  });
  await assert.rejects(
    () => run.service.checkpoint(run.tenantKey, {
      planId: generated.view.plan.id, idempotencyKey: 'checkpoint-before-accept',
      asOf: '2026-07-28T23:00:00.000Z',
    }),
    (error: any) => error.code === 'plan_not_accepted',
  );
  const decision = await run.service.decide(run.tenantKey, {
    planId: generated.view.plan.id, idempotencyKey: 'accept-feedback',
    decision: 'accepted', reasonCode: 'founder_reviewed',
  });
  assert.equal(decision.record.grants_action_authority, false);
  const checkpoint = await run.service.checkpoint(run.tenantKey, {
    planId: generated.view.plan.id, idempotencyKey: 'checkpoint-1',
    asOf: '2026-07-28T23:00:00.000Z',
  });
  assert.equal(checkpoint.record.observed_value, 3);
  assert.equal(checkpoint.record.verdict, 'no_progress');
  const outcome = await run.service.outcome(run.tenantKey, {
    planId: generated.view.plan.id, idempotencyKey: 'outcome-1',
    outcome: 'useful', note: 'The evidence boundary made the next review explicit.',
  });
  assert.equal(outcome.record.outcome, 'useful');

  const view = await run.service.plan(run.tenantKey, generated.view.plan.id);
  assert.equal(view.decisions.length, 1);
  assert.equal(view.checkpoints.length, 1);
  assert.equal(view.outcomes.length, 1);
  assert.equal(view.plan.plan_hash, generated.view.plan.plan_hash);
});

test('all planner evidence tables reject update and delete mutations', async () => {
  const run = await harness();
  const created = await createGoal(run, goal({ maxSteps: 3 }), 'immutable-goal');
  const blocked = await run.service.generatePlan(run.tenantKey, {
    goalVersionId: created.goal.id, planKey: 'immutable-blocked', strategy: 'balanced',
    asOf: '2026-07-28T23:00:00.000Z', idempotencyKey: 'immutable-blocked-v1',
  });
  await run.service.decide(run.tenantKey, {
    planId: blocked.view.plan.id, idempotencyKey: 'reject-immutable',
    decision: 'rejected', reasonCode: 'capacity_conflict',
  });

  const clearCreated = await createGoal(run, goal({ key: 'immutable_feedback' }), 'immutable-clear-goal');
  const clear = await run.service.generatePlan(run.tenantKey, {
    goalVersionId: clearCreated.goal.id, planKey: 'immutable-clear', strategy: 'balanced',
    asOf: '2026-07-28T23:00:00.000Z', idempotencyKey: 'immutable-clear-v1',
  });
  await run.service.decide(run.tenantKey, {
    planId: clear.view.plan.id, idempotencyKey: 'accept-immutable', decision: 'accepted', reasonCode: 'founder_reviewed',
  });
  await run.service.checkpoint(run.tenantKey, {
    planId: clear.view.plan.id, idempotencyKey: 'checkpoint-immutable', asOf: '2026-07-28T23:00:00.000Z',
  });
  await run.service.outcome(run.tenantKey, {
    planId: clear.view.plan.id, idempotencyKey: 'outcome-immutable', outcome: 'useful',
  });

  for (const table of Object.values(PLANNER_TABLES)) {
    const row = await db(table).where({ tenant_id: run.tenant.id }).first();
    assert.ok(row, `${table} should contain evidence`);
    await assert.rejects(db(table).where({ id: row.id }).update({ created_at: '2040-01-01T00:00:00.000Z' }));
    await assert.rejects(db(table).where({ id: row.id }).delete());
  }
});

test('planner HTTP is authenticated, tenant-scoped, sanitized, and exposes no execution authority', async () => {
  const left = await harness();
  const right = await harness();
  const created = await createGoal(left);
  const generated = await left.service.generatePlan(left.tenantKey, {
    goalVersionId: created.goal.id, planKey: 'http-plan', strategy: 'balanced',
    asOf: '2026-07-28T23:00:00.000Z', idempotencyKey: 'http-plan-v1',
  });
  await assert.rejects(db(PLANNER_TABLES.decisions).insert({
    id: randomUUID(), tenant_id: right.tenant.id, plan_id: generated.view.plan.id,
    idempotency_key: 'cross-tenant-insert', decision: 'rejected',
    reason_code: 'cross_tenant_probe', actor: 'founder', grants_action_authority: false,
    decision_hash: `sha256:${'0'.repeat(64)}`, created_at: '2026-07-28T23:00:00.000Z',
  }));
  const app = createApp({
    profile: 'egoric-readonly', knex: db, integrationReadAuth: AUTH,
    plannerClock: left.clock,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const base = `http://127.0.0.1:${address.port}/v1/tenants`;
    const token = signTenantReadToken(left.tenantKey, AUTH.secret);
    assert.equal((await fetch(`${base}/${left.tenantKey}/plans`)).status, 401);
    assert.equal((await fetch(`${base}/${right.tenantKey}/plans`, {
      headers: { authorization: `Bearer ${token}` },
    })).status, 403);
    const response = await fetch(`${base}/${left.tenantKey}/plans`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const raw = await response.text();
    assert.equal(raw.includes('tenant_id'), false);
    assert.equal(raw.includes('idempotency_key'), false);
    const parsed = JSON.parse(raw) as any;
    assert.equal(parsed.plans[0].action_authority, 'none');
    assert.equal(parsed.plans[0].advisory_only, true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('planner composition has no network, process, scheduler, or action adapter capability', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../services/plannerService.ts'), 'utf8');
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(source.includes('child_process'), false);
  assert.equal(source.includes('setInterval('), false);
  assert.equal(source.includes('ActionAdapterRegistry'), false);
  assert.equal(source.includes('execution_state: \'not_authorized\''), true);
  const fingerprint = createHash('sha256').update(source).digest('hex');
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
});

test('Phase 13 migration rolls back every Planner table and reapplies cleanly', async () => {
  await db.migrate.rollback();
  for (const table of Object.values(PLANNER_TABLES)) assert.equal(await db.schema.hasTable(table), false);
  await db.migrate.latest();
  for (const table of Object.values(PLANNER_TABLES)) assert.equal(await db.schema.hasTable(table), true);
});
