import { Router, json } from 'express';
import {
  PlannerDecision,
  PlannerError,
  PlannerOutcome,
  PlannerPlanRecord,
  PlannerStrategy,
} from '../../domain/planner';
import { PlannerPlanView } from '../../repositories/plannerRepository';
import { PlannerService, plannerGoalInput } from '../../services/plannerService';
import { asyncHandler } from '../asyncHandler';
import { enforceTenantReadScope } from '../integrationReadAuth';

const parseJson = json({ limit: '32kb', strict: true });

function body(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function exact(input: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new PlannerError('invalid_planner_input', 'request has missing or unsupported fields');
  }
}

function idempotency(req: { header(name: string): string | undefined }): string {
  const value = req.header('Idempotency-Key');
  if (!value) throw new PlannerError('missing_idempotency_key', 'Idempotency-Key is required');
  return value;
}

function nullableText(value: unknown, field: string): string | undefined {
  if (value === null) return undefined;
  if (typeof value !== 'string') throw new PlannerError('invalid_planner_input', `${field} must be text or null`);
  return value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new PlannerError('invalid_planner_input', `${field} must be text`);
  return value;
}

function strategy(value: unknown): PlannerStrategy {
  if (!['conservative', 'balanced', 'accelerated'].includes(String(value))) {
    throw new PlannerError('invalid_plan_strategy', 'plan strategy is invalid');
  }
  return value as PlannerStrategy;
}

function decision(value: unknown): PlannerDecision {
  if (!['accepted', 'rejected'].includes(String(value))) {
    throw new PlannerError('invalid_plan_decision', 'plan decision is invalid');
  }
  return value as PlannerDecision;
}

function outcome(value: unknown): PlannerOutcome {
  if (!['useful', 'not_useful'].includes(String(value))) {
    throw new PlannerError('invalid_plan_outcome', 'plan outcome is invalid');
  }
  return value as PlannerOutcome;
}

function planSummary(plan: PlannerPlanRecord) {
  return {
    id: plan.id,
    goal_version_id: plan.goal_version_id,
    plan_key: plan.plan_key,
    version: plan.version,
    previous_plan_version_id: plan.previous_plan_version_id,
    strategy: plan.strategy,
    policy_version: plan.policy_version,
    baseline_value: plan.baseline_value,
    target_value: plan.target_value,
    conflict_status: plan.conflict_status,
    advisory_only: plan.advisory_only,
    action_authority: plan.action_authority,
    plan_hash: plan.plan_hash,
    created_at: plan.created_at,
  };
}

function planView(view: PlannerPlanView) {
  const evidence = JSON.parse(view.plan.evidence_bundle_json) as unknown;
  return {
    plan: planSummary(view.plan),
    goal: {
      id: view.goal.id,
      goal_key: view.goal.goal_key,
      version: view.goal.version,
      previous_goal_version_id: view.goal.previous_goal_version_id,
      manifest: view.goal_manifest,
      manifest_hash: view.goal.manifest_hash,
      created_at: view.goal.created_at,
    },
    evidence,
    steps: view.steps.map((step) => ({
      id: step.id, ordinal: step.ordinal, key: step.step_key, kind: step.kind,
      title: step.title, rationale: step.rationale, effort_points: step.effort_points,
      confidence: step.confidence, evidence_keys: JSON.parse(step.evidence_keys_json),
      completion: { metric_key: step.completion_metric_key, target_value: step.completion_target_value },
      action_boundary: { route: step.action_route, execution_state: step.execution_state },
      step_hash: step.step_hash,
    })),
    conflicts: view.conflicts.map((conflict) => ({
      key: conflict.conflict_key, severity: conflict.severity, category: conflict.category,
      message: conflict.message, evidence_keys: JSON.parse(conflict.evidence_keys_json),
      conflict_hash: conflict.conflict_hash,
    })),
    simulations: view.simulations.map((simulation) => ({
      scenario: simulation.scenario, projected_value: simulation.projected_value,
      target_value: simulation.target_value, progress_basis_points: simulation.progress_basis_points,
      feasibility: simulation.feasibility, uncertainty: simulation.uncertainty,
      assumptions: JSON.parse(simulation.assumptions_json), simulation_hash: simulation.simulation_hash,
    })),
    decisions: view.decisions.map((decision) => ({
      id: decision.id, decision: decision.decision, reason_code: decision.reason_code,
      actor: decision.actor, grants_action_authority: Boolean(decision.grants_action_authority),
      decision_hash: decision.decision_hash, created_at: decision.created_at,
    })),
    checkpoints: view.checkpoints.map((checkpoint) => ({
      id: checkpoint.id, source_snapshot_id: checkpoint.source_snapshot_id,
      intelligence_run_id: checkpoint.intelligence_run_id, metric_key: checkpoint.metric_key,
      observed_value: checkpoint.observed_value, target_value: checkpoint.target_value,
      freshness_status: checkpoint.freshness_status, verdict: checkpoint.verdict,
      evidence_hash: checkpoint.evidence_hash, observed_at: checkpoint.observed_at,
    })),
    outcomes: view.outcomes.map((outcome) => ({
      id: outcome.id, outcome: outcome.outcome, note: outcome.note,
      actor: outcome.actor, outcome_hash: outcome.outcome_hash, created_at: outcome.created_at,
    })),
  };
}

export function createPlannerRouter(service: PlannerService): Router {
  const router = Router();

  router.get('/:tenantKey/goals', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const goals = await service.listGoals(tenantKey);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json({ goals: goals.map(({ goal, manifest, current }) => ({
      id: goal.id, goal_key: goal.goal_key, version: goal.version,
      previous_goal_version_id: goal.previous_goal_version_id,
      manifest, manifest_hash: goal.manifest_hash, current, created_at: goal.created_at,
    })) });
  }));

  router.post('/:tenantKey/goals', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const input = body(req.body);
    exact(input, ['goal_key', 'title', 'metric', 'horizon', 'constraints', 'assumptions', 'owner', 'replaces_goal_version_id']);
    const output = await service.createGoal(tenantKey, {
      idempotencyKey: idempotency(req),
      previousGoalVersionId: nullableText(input.replaces_goal_version_id, 'replaces_goal_version_id'),
      goal: plannerGoalInput({
        goal_key: input.goal_key,
        title: input.title,
        metric: input.metric,
        horizon: input.horizon,
        constraints: input.constraints,
        assumptions: input.assumptions,
        owner: input.owner,
      }),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(output.replayed ? 200 : 201).json({
      goal: { id: output.goal.id, goal_key: output.goal.goal_key, version: output.goal.version, manifest_hash: output.goal.manifest_hash },
      replayed: output.replayed,
    });
  }));

  router.get('/:tenantKey/plans', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const plans = await service.listPlans(tenantKey);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json({ plans: plans.map((view) => ({
      ...planSummary(view.plan),
      goal_key: view.goal.goal_key,
      goal_title: view.goal_manifest.title,
      metric: view.goal_manifest.metric,
      latest_decision: view.decisions.at(-1)?.decision ?? null,
      checkpoint_count: view.checkpoints.length,
    })) });
  }));

  router.post('/:tenantKey/goals/:goalVersionId/plans', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const input = body(req.body);
    exact(input, ['plan_key', 'strategy', 'as_of', 'replaces_plan_id']);
    const output = await service.generatePlan(tenantKey, {
      goalVersionId: req.params.goalVersionId,
      planKey: requiredText(input.plan_key, 'plan_key'),
      strategy: strategy(input.strategy),
      asOf: nullableText(input.as_of, 'as_of'),
      replacesPlanId: nullableText(input.replaces_plan_id, 'replaces_plan_id'),
      idempotencyKey: idempotency(req),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(output.replayed ? 200 : 201).json({ ...planView(output.view), replayed: output.replayed });
  }));

  router.get('/:tenantKey/plans/compare', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    if (typeof req.query.left !== 'string' || typeof req.query.right !== 'string') {
      throw new PlannerError('invalid_plan_comparison', 'left and right plan IDs are required');
    }
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json(await service.compare(tenantKey, req.query.left, req.query.right));
  }));

  router.get('/:tenantKey/plans/:planId', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json(planView(await service.plan(tenantKey, req.params.planId)));
  }));

  router.post('/:tenantKey/plans/:planId/decisions', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const input = body(req.body);
    exact(input, ['decision', 'reason_code']);
    const output = await service.decide(tenantKey, {
      planId: req.params.planId, idempotencyKey: idempotency(req),
      decision: decision(input.decision), reasonCode: requiredText(input.reason_code, 'reason_code'),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(output.replayed ? 200 : 201).json({
      decision: {
        id: output.record.id, decision: output.record.decision,
        grants_action_authority: false, decision_hash: output.record.decision_hash,
        created_at: output.record.created_at,
      },
      replayed: output.replayed,
    });
  }));

  router.post('/:tenantKey/plans/:planId/checkpoints', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const input = body(req.body);
    exact(input, ['as_of']);
    const output = await service.checkpoint(tenantKey, {
      planId: req.params.planId, idempotencyKey: idempotency(req),
      asOf: nullableText(input.as_of, 'as_of'),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(output.replayed ? 200 : 201).json({
      checkpoint: {
        id: output.record.id, observed_value: output.record.observed_value,
        target_value: output.record.target_value, verdict: output.record.verdict,
        evidence_hash: output.record.evidence_hash, observed_at: output.record.observed_at,
      }, replayed: output.replayed,
    });
  }));

  router.post('/:tenantKey/plans/:planId/outcomes', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const input = body(req.body);
    exact(input, ['outcome', 'note']);
    const output = await service.outcome(tenantKey, {
      planId: req.params.planId, idempotencyKey: idempotency(req),
      outcome: outcome(input.outcome), note: nullableText(input.note, 'note'),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(output.replayed ? 200 : 201).json({
      outcome: { id: output.record.id, outcome: output.record.outcome, outcome_hash: output.record.outcome_hash },
      replayed: output.replayed,
    });
  }));

  return router;
}
