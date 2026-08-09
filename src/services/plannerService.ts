import { canonicalStringify } from '../domain/businessMemory';
import type { EgoricCeoBrief } from '../domain/egoricBrief';
import {
  PLANNER_EVIDENCE_SCHEMA,
  PLANNER_GOAL_SCHEMA,
  PLANNER_POLICY_VERSION,
  PlannerConflictRecord,
  PlannerDecision,
  PlannerError,
  PlannerEvidenceBundle,
  PlannerGoalManifest,
  PlannerMetricKey,
  PlannerOutcome,
  PlannerPlanRecord,
  PlannerSimulationRecord,
  PlannerStepRecord,
  PlannerStrategy,
  parsePlannerGoal,
  plannerHash,
  validatePlannerGoal,
} from '../domain/planner';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { PlannerPlanView, PlannerRepository } from '../repositories/plannerRepository';
import { EgoricBriefService } from './egoricBriefService';

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function safeKey(value: string, code: string): string {
  if (typeof value !== 'string' || !SAFE_KEY.test(value)) throw new PlannerError(code, 'stable key is invalid');
  return value;
}

function metricValue(brief: EgoricCeoBrief, key: PlannerMetricKey): number | null {
  switch (key) {
    case 'active_pipeline': return brief.headline.active_pipeline;
    case 'won': return brief.headline.won;
    case 'win_rate': return brief.headline.win_rate === null ? null : Math.round(brief.headline.win_rate * 10_000);
    case 'active_owner_coverage': return brief.headline.active_owner_coverage === null
      ? null : Math.round(brief.headline.active_owner_coverage * 10_000);
    case 'overdue_expected_close': return brief.headline.overdue_expected_close;
    case 'missing_source': return brief.quality.missing_source;
    case 'missing_created_at': return brief.quality.missing_created_at;
  }
}

function targetMet(direction: PlannerGoalManifest['metric']['direction'], value: number, target: number): boolean {
  if (direction === 'increase') return value >= target;
  if (direction === 'decrease') return value <= target;
  return value === target;
}

function recommendationCodes(brief: EgoricCeoBrief): string[] {
  return brief.observations.map((row) => row.code).sort();
}

function evidenceBundle(goal: ReturnType<typeof parsePlannerGoal>, goalId: string, goalHash: string, brief: EgoricCeoBrief): PlannerEvidenceBundle {
  const core = {
    schema_version: PLANNER_EVIDENCE_SCHEMA,
    policy_version: PLANNER_POLICY_VERSION,
    goal_version_id: goalId,
    goal_manifest_hash: goalHash,
    as_of: brief.as_of,
    generated_at: brief.generated_at,
    freshness_status: brief.data_freshness.status,
    source_snapshot_id: brief.source_snapshot_id,
    intelligence_run_id: brief.intelligence_run_id,
    formula_version: brief.formula_version,
    metric: { key: goal.metric.key, value: metricValue(brief, goal.metric.key), unit: goal.metric.unit },
    recommendation_codes: recommendationCodes(brief),
    evidence_keys: [
      'brief.freshness.status',
      `brief.metric.${goal.metric.key}`,
      'brief.provenance.source_snapshot_id',
      'goal.manifest',
    ],
  };
  return { ...core, hash: plannerHash(core) };
}

const COPY: Readonly<Record<PlannerMetricKey, { review: string; action: string }>> = Object.freeze({
  active_pipeline: { review: 'Review active pipeline composition and leakage', action: 'Prepare a supervised follow-up task proposal' },
  won: { review: 'Review winning patterns in current closed evidence', action: 'Prepare a supervised follow-up task proposal' },
  win_rate: { review: 'Review won and lost outcome evidence', action: 'Prepare a supervised follow-up task proposal' },
  active_owner_coverage: { review: 'Review active records without assigned ownership', action: 'Prepare a supervised ownership-update proposal' },
  overdue_expected_close: { review: 'Review records with overdue expected-close dates', action: 'Prepare a supervised expected-close update proposal' },
  missing_source: { review: 'Review records with missing acquisition source', action: 'Prepare a supervised source-repair proposal' },
  missing_created_at: { review: 'Review records with missing creation timestamps', action: 'Prepare a supervised data-repair proposal' },
});

function stepDrafts(goal: PlannerGoalManifest, strategy: PlannerStrategy, confidence: PlannerStepRecord['confidence']) {
  const effort = strategy === 'conservative' ? [1, 2, 2, 1] : strategy === 'balanced' ? [1, 2, 3, 1] : [1, 3, 4, 1];
  return [
    {
      step_key: 'verify_baseline', kind: 'analysis' as const, title: 'Verify the recorded baseline',
      rationale: 'Confirm freshness, metric definition, snapshot identity, and goal assumptions before choosing a change.',
      effort_points: effort[0], action_route: 'none' as const, execution_state: 'not_applicable' as const,
    },
    {
      step_key: 'review_exceptions', kind: 'review' as const, title: COPY[goal.metric.key].review,
      rationale: 'Inspect the bounded evidence behind the gap without inventing missing history or attribution.',
      effort_points: effort[1], action_route: 'none' as const, execution_state: 'not_applicable' as const,
    },
    {
      step_key: 'prepare_supervised_proposal', kind: 'action_candidate' as const, title: COPY[goal.metric.key].action,
      rationale: 'Describe a candidate only. Any operational command requires a separate exact G6 proposal, preview, approval, and adapter.',
      effort_points: effort[2], action_route: 'g6_supervised_action' as const, execution_state: 'not_authorized' as const,
    },
    {
      step_key: 'measure_checkpoint', kind: 'measure' as const, title: 'Measure a new evidence-bound checkpoint',
      rationale: 'Compare a later accepted snapshot with the immutable baseline and retain both even when progress is absent.',
      effort_points: effort[3], action_route: 'none' as const, execution_state: 'not_applicable' as const,
    },
  ].map((row) => ({ ...row, confidence }));
}

function simulationProgress(strategy: PlannerStrategy): Array<[PlannerSimulationRecord['scenario'], number]> {
  if (strategy === 'conservative') return [['conservative', 2500], ['expected', 5000], ['ambitious', 8000]];
  if (strategy === 'accelerated') return [['conservative', 4500], ['expected', 8500], ['ambitious', 10000]];
  return [['conservative', 3500], ['expected', 7000], ['ambitious', 10000]];
}

export class PlannerService {
  constructor(
    private readonly repository: PlannerRepository,
    private readonly memory: BusinessMemoryRepository,
    private readonly brief: EgoricBriefService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async tenant(tenantKey: string) {
    const tenant = await this.memory.findTenantByKey(tenantKey);
    if (!tenant) throw new PlannerError('tenant_not_found', 'tenant was not found', 404);
    return tenant;
  }

  async createGoal(tenantKey: string, input: {
    idempotencyKey: string;
    previousGoalVersionId?: string;
    goal: unknown;
  }) {
    const tenant = await this.tenant(tenantKey);
    const goal = validatePlannerGoal(input.goal);
    return this.repository.createGoal({
      tenantId: tenant.id,
      manifest: goal,
      idempotencyKey: input.idempotencyKey,
      previousGoalVersionId: input.previousGoalVersionId,
    });
  }

  async listGoals(tenantKey: string) {
    const tenant = await this.tenant(tenantKey);
    const goals = await this.repository.listGoals(tenant.id);
    const replacements = new Set(goals.map((goal) => goal.previous_goal_version_id).filter(Boolean));
    return goals.map((goal) => ({ goal, manifest: parsePlannerGoal(goal), current: !replacements.has(goal.id) }));
  }

  async generatePlan(tenantKey: string, input: {
    goalVersionId: string;
    planKey: string;
    strategy: PlannerStrategy;
    asOf?: string;
    idempotencyKey: string;
    replacesPlanId?: string;
  }): Promise<{ view: PlannerPlanView; replayed: boolean }> {
    const tenant = await this.tenant(tenantKey);
    const goalRecord = await this.repository.findGoal(tenant.id, input.goalVersionId);
    if (!goalRecord) throw new PlannerError('goal_version_not_found', 'goal version was not found', 404);
    if (await this.repository.goalReplacement(tenant.id, goalRecord.id)) {
      throw new PlannerError('goal_version_superseded', 'a superseded goal cannot create a new plan', 409);
    }
    const goal = parsePlannerGoal(goalRecord);
    const strategy = input.strategy;
    if (!['conservative', 'balanced', 'accelerated'].includes(strategy)) throw new PlannerError('invalid_plan_strategy', 'plan strategy is invalid');
    const planKey = safeKey(input.planKey, 'invalid_plan_key');
    const brief = await this.brief.generate(tenantKey, input.asOf);
    const evidence = evidenceBundle(goal, goalRecord.id, goalRecord.manifest_hash, brief);
    const baseline = evidence.metric.value;
    const confidence: PlannerStepRecord['confidence'] = brief.data_freshness.status === 'fresh' && baseline !== null ? 'high' : 'low';
    const drafts = stepDrafts(goal, strategy, confidence);
    const effort = drafts.reduce((sum, row) => sum + row.effort_points, 0);
    const conflictDrafts: Array<Omit<PlannerConflictRecord, 'id' | 'tenant_id' | 'plan_id' | 'conflict_hash' | 'created_at'>> = [];
    if (brief.data_freshness.status !== 'fresh') conflictDrafts.push({
      conflict_key: 'source_not_fresh', severity: 'blocking', category: 'evidence',
      message: 'The source evidence is not fresh enough for an accepted plan decision.',
      evidence_keys_json: canonicalStringify(['brief.freshness.status']),
    });
    if (baseline === null) conflictDrafts.push({
      conflict_key: 'metric_unavailable', severity: 'blocking', category: 'evidence',
      message: 'The selected metric has no reproducible baseline in the current evidence.',
      evidence_keys_json: canonicalStringify([`brief.metric.${goal.metric.key}`]),
    });
    if (baseline !== null) {
      const directionConflict = (goal.metric.direction === 'increase' && goal.metric.target_value < baseline)
        || (goal.metric.direction === 'decrease' && goal.metric.target_value > baseline)
        || (goal.metric.direction === 'maintain' && goal.metric.target_value !== baseline);
      if (directionConflict) conflictDrafts.push({
        conflict_key: 'target_direction_conflict', severity: 'blocking', category: 'goal',
        message: 'The target value conflicts with the declared metric direction and recorded baseline.',
        evidence_keys_json: canonicalStringify([`brief.metric.${goal.metric.key}`, 'goal.manifest']),
      });
      if (targetMet(goal.metric.direction, baseline, goal.metric.target_value)) conflictDrafts.push({
        conflict_key: 'target_already_satisfied', severity: 'advisory', category: 'goal',
        message: 'The current baseline already satisfies the target; use this plan only to preserve or verify the result.',
        evidence_keys_json: canonicalStringify([`brief.metric.${goal.metric.key}`]),
      });
    }
    if (drafts.length > goal.constraints.max_steps) conflictDrafts.push({
      conflict_key: 'step_capacity_exceeded', severity: 'blocking', category: 'capacity',
      message: 'The deterministic plan requires more steps than the goal constraint allows.',
      evidence_keys_json: canonicalStringify(['goal.manifest']),
    });
    if (effort > goal.constraints.max_effort_points) conflictDrafts.push({
      conflict_key: 'effort_budget_exceeded', severity: 'blocking', category: 'budget',
      message: 'The deterministic plan exceeds the accepted effort-point budget.',
      evidence_keys_json: canonicalStringify(['goal.manifest']),
    });
    if (!goal.constraints.action_candidates_allowed) conflictDrafts.push({
      conflict_key: 'action_candidate_forbidden', severity: 'blocking', category: 'policy',
      message: 'The goal policy forbids even a non-executable action candidate step.',
      evidence_keys_json: canonicalStringify(['goal.manifest']),
    });
    for (const assumption of goal.assumptions) if (assumption.evidence_keys.length === 0) conflictDrafts.push({
      conflict_key: `uncited_assumption:${assumption.key}`, severity: 'advisory', category: 'evidence',
      message: 'A declared assumption has no evidence reference and remains explicitly uncertain.',
      evidence_keys_json: canonicalStringify(['goal.manifest']),
    });
    const conflictStatus: PlannerPlanRecord['conflict_status'] = conflictDrafts.some((row) => row.severity === 'blocking')
      ? 'blocking' : conflictDrafts.length ? 'advisory' : 'clear';
    let version = 1;
    if (input.replacesPlanId) {
      const previous = await this.repository.findPlan(tenant.id, input.replacesPlanId);
      if (!previous) throw new PlannerError('plan_version_not_found', 'previous plan version was not found', 404);
      if (previous.plan_key !== planKey) throw new PlannerError('plan_replacement_mismatch', 'plan replacement must preserve plan key', 409);
      const previousGoal = await this.repository.findGoal(tenant.id, previous.goal_version_id);
      if (!previousGoal || previousGoal.goal_key !== goalRecord.goal_key) {
        throw new PlannerError('plan_replacement_mismatch', 'plan replacement must preserve goal key', 409);
      }
      version = previous.version + 1;
    }
    const createdAt = this.clock().toISOString();
    const planId = this.repository.newId();
    const requestHash = plannerHash({
      goal_version_id: goalRecord.id, plan_key: planKey, strategy, as_of: brief.as_of,
      replaces_plan_id: input.replacesPlanId ?? null, evidence_bundle_hash: evidence.hash,
    });
    const steps: PlannerStepRecord[] = drafts.map((row, index) => {
      const core = {
        tenant_id: tenant.id, plan_id: planId, ordinal: index + 1, ...row,
        evidence_keys_json: canonicalStringify(evidence.evidence_keys),
        completion_metric_key: goal.metric.key,
        completion_target_value: goal.metric.target_value,
      };
      return { id: this.repository.newId(), ...core, step_hash: plannerHash(core), created_at: createdAt };
    });
    const conflicts: PlannerConflictRecord[] = conflictDrafts.map((row) => {
      const core = { tenant_id: tenant.id, plan_id: planId, ...row };
      return { id: this.repository.newId(), ...core, conflict_hash: plannerHash(core), created_at: createdAt };
    });
    const simulations: PlannerSimulationRecord[] = simulationProgress(strategy).map(([scenario, progress]) => {
      const projected = baseline === null ? null : Math.round(baseline + (goal.metric.target_value - baseline) * progress / 10_000);
      const feasibility: PlannerSimulationRecord['feasibility'] = conflictStatus === 'blocking' || projected === null
        ? 'blocked' : targetMet(goal.metric.direction, projected, goal.metric.target_value) ? 'meets_target' : 'partial';
      const core = {
        tenant_id: tenant.id, plan_id: planId, scenario, projected_value: projected,
        target_value: goal.metric.target_value, progress_basis_points: progress,
        feasibility,
        uncertainty: confidence === 'low' || scenario === 'ambitious' ? 'high' as const : scenario === 'expected' ? 'medium' as const : 'low' as const,
        assumptions_json: canonicalStringify(goal.assumptions.map((assumption) => ({
          key: assumption.key, confidence: assumption.confidence, evidence_keys: assumption.evidence_keys,
        }))),
      };
      return { id: this.repository.newId(), ...core, simulation_hash: plannerHash(core), created_at: createdAt };
    });
    const planCore = {
      tenant_id: tenant.id, goal_version_id: goalRecord.id, plan_key: planKey, version,
      previous_plan_version_id: input.replacesPlanId ?? null, strategy,
      idempotency_key: safeKey(input.idempotencyKey, 'invalid_plan_idempotency'), request_hash: requestHash,
      policy_version: PLANNER_POLICY_VERSION, evidence_bundle_hash: evidence.hash,
      baseline_value: baseline, target_value: goal.metric.target_value,
      conflict_status: conflictStatus, advisory_only: true as const, action_authority: 'none' as const,
    };
    const plan: PlannerPlanRecord = {
      id: planId, ...planCore, evidence_bundle_json: canonicalStringify(evidence),
      plan_hash: plannerHash({
        ...planCore,
        steps: steps.map((row) => row.step_hash),
        conflicts: [...conflicts].sort((left, right) => left.conflict_key.localeCompare(right.conflict_key))
          .map((row) => row.conflict_hash),
        simulations: [...simulations].sort((left, right) => left.scenario.localeCompare(right.scenario))
          .map((row) => row.simulation_hash),
      }),
      created_at: createdAt,
    };
    return this.repository.insertPlanGraph({ plan, steps, conflicts, simulations });
  }

  async listPlans(tenantKey: string) {
    const tenant = await this.tenant(tenantKey);
    const plans = await this.repository.listPlans(tenant.id);
    return Promise.all(plans.map((plan) => this.repository.planView(tenant.id, plan.id)));
  }

  async plan(tenantKey: string, planId: string) {
    const tenant = await this.tenant(tenantKey);
    return this.repository.planView(tenant.id, planId);
  }

  async decide(tenantKey: string, input: { planId: string; idempotencyKey: string; decision: PlannerDecision; reasonCode: string }) {
    const tenant = await this.tenant(tenantKey);
    const view = await this.repository.planView(tenant.id, input.planId);
    if (!['accepted', 'rejected'].includes(input.decision)) throw new PlannerError('invalid_plan_decision', 'plan decision is invalid');
    if (input.decision === 'accepted' && view.conflicts.some((row) => row.severity === 'blocking')) {
      throw new PlannerError('plan_has_blocking_conflicts', 'a plan with blocking conflicts cannot be accepted', 409);
    }
    if (input.decision === 'accepted' && (await this.repository.planReplacement(tenant.id, view.plan.id))) {
      throw new PlannerError('plan_version_superseded', 'a superseded plan cannot be accepted', 409);
    }
    if (input.decision === 'accepted' && (await this.repository.goalReplacement(tenant.id, view.goal.id))) {
      throw new PlannerError('goal_version_superseded', 'a plan for a superseded goal cannot be accepted', 409);
    }
    return this.repository.recordDecision({
      tenant_id: tenant.id, plan_id: view.plan.id,
      idempotency_key: input.idempotencyKey, decision: input.decision,
      reason_code: safeKey(input.reasonCode, 'invalid_decision_reason'), actor: 'founder',
      grants_action_authority: false,
    });
  }

  async checkpoint(tenantKey: string, input: { planId: string; idempotencyKey: string; asOf?: string }) {
    const tenant = await this.tenant(tenantKey);
    const view = await this.repository.planView(tenant.id, input.planId);
    const latest = view.decisions.at(-1);
    if (!latest || latest.decision !== 'accepted') throw new PlannerError('plan_not_accepted', 'checkpoint requires the latest plan decision to be accepted', 409);
    const brief = await this.brief.generate(tenantKey, input.asOf);
    const observed = metricValue(brief, view.goal_manifest.metric.key);
    let verdict: 'target_met' | 'progress' | 'no_progress' | 'unavailable' = 'unavailable';
    if (brief.data_freshness.status === 'fresh' && observed !== null && view.plan.baseline_value !== null) {
      if (targetMet(view.goal_manifest.metric.direction, observed, view.goal_manifest.metric.target_value)) verdict = 'target_met';
      else {
        const progressed = view.goal_manifest.metric.direction === 'increase'
          ? observed > view.plan.baseline_value
          : view.goal_manifest.metric.direction === 'decrease'
            ? observed < view.plan.baseline_value
            : observed === view.plan.baseline_value;
        verdict = progressed ? 'progress' : 'no_progress';
      }
    }
    return this.repository.recordCheckpoint({
      tenant_id: tenant.id, plan_id: view.plan.id, idempotency_key: input.idempotencyKey,
      source_snapshot_id: brief.source_snapshot_id, intelligence_run_id: brief.intelligence_run_id,
      metric_key: view.goal_manifest.metric.key, observed_value: observed,
      target_value: view.goal_manifest.metric.target_value,
      freshness_status: brief.data_freshness.status, verdict,
      observed_at: this.clock().toISOString(),
    });
  }

  async outcome(tenantKey: string, input: { planId: string; idempotencyKey: string; outcome: PlannerOutcome; note?: string }) {
    const tenant = await this.tenant(tenantKey);
    const view = await this.repository.planView(tenant.id, input.planId);
    if (!['useful', 'not_useful'].includes(input.outcome)) throw new PlannerError('invalid_plan_outcome', 'plan outcome is invalid');
    if (!view.checkpoints.length) throw new PlannerError('checkpoint_required', 'plan feedback requires checkpoint evidence', 409);
    const note = input.note?.trim();
    if (note && (note.length > 1_000 || /[\u0000-\u001F]/.test(note))) throw new PlannerError('invalid_plan_outcome', 'outcome note is invalid');
    return this.repository.recordOutcome({
      tenant_id: tenant.id, plan_id: view.plan.id, idempotency_key: input.idempotencyKey,
      outcome: input.outcome, note: note || null, actor: 'founder',
    });
  }

  async compare(tenantKey: string, leftId: string, rightId: string) {
    const tenant = await this.tenant(tenantKey);
    const [left, right] = await Promise.all([
      this.repository.planView(tenant.id, leftId), this.repository.planView(tenant.id, rightId),
    ]);
    if (left.goal.goal_key !== right.goal.goal_key) throw new PlannerError('plan_comparison_mismatch', 'plans must belong to versions of the same goal key', 409);
    const score = (view: PlannerPlanView) => {
      const expected = view.simulations.find((row) => row.scenario === 'expected');
      const effort = view.steps.reduce((sum, row) => sum + row.effort_points, 0);
      const blocking = view.conflicts.filter((row) => row.severity === 'blocking').length;
      const advisory = view.conflicts.length - blocking;
      return (expected?.progress_basis_points ?? 0) - effort * 100 - blocking * 10_000 - advisory * 500;
    };
    const leftScore = score(left);
    const rightScore = score(right);
    return {
      policy_version: PLANNER_POLICY_VERSION,
      goal_key: left.goal.goal_key,
      left: { plan_id: left.plan.id, plan_hash: left.plan.plan_hash, score: leftScore },
      right: { plan_id: right.plan.id, plan_hash: right.plan.plan_hash, score: rightScore },
      preferred_plan_id: leftScore === rightScore ? null : leftScore > rightScore ? left.plan.id : right.plan.id,
      tie: leftScore === rightScore,
      advisory_only: true as const,
      grants_action_authority: false as const,
      comparison_hash: plannerHash({ left: left.plan.plan_hash, right: right.plan.plan_hash, leftScore, rightScore }),
    };
  }
}

export function plannerGoalInput(input: {
  goal_key: unknown; title: unknown; metric: unknown; horizon: unknown;
  constraints: unknown; assumptions: unknown; owner: unknown;
}): unknown {
  return {
    schema_version: PLANNER_GOAL_SCHEMA,
    goal_key: input.goal_key,
    title: input.title,
    metric: input.metric,
    horizon: input.horizon,
    constraints: input.constraints,
    assumptions: input.assumptions,
    owner: input.owner,
  };
}
