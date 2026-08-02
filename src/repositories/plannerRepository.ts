import { randomUUID } from 'node:crypto';
import type { Knex } from '../db/knex';
import {
  PLANNER_EVIDENCE_SCHEMA,
  PLANNER_POLICY_VERSION,
  PLANNER_TABLES,
  PlannerCheckpointRecord,
  PlannerConflictRecord,
  PlannerDecisionRecord,
  PlannerError,
  PlannerGoalManifest,
  PlannerGoalRecord,
  PlannerOutcomeRecord,
  PlannerPlanRecord,
  PlannerSimulationRecord,
  PlannerStepRecord,
  parsePlannerGoal,
  plannerHash,
  plannerMetricUnit,
} from '../domain/planner';
import { canonicalStringify } from '../domain/businessMemory';

export interface PlannerPlanView {
  plan: PlannerPlanRecord;
  goal: PlannerGoalRecord;
  goal_manifest: PlannerGoalManifest;
  steps: PlannerStepRecord[];
  conflicts: PlannerConflictRecord[];
  simulations: PlannerSimulationRecord[];
  decisions: PlannerDecisionRecord[];
  checkpoints: PlannerCheckpointRecord[];
  outcomes: PlannerOutcomeRecord[];
}

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function safeKey(value: string, code: string): string {
  if (!SAFE_KEY.test(value)) throw new PlannerError(code, 'idempotency or reason key is invalid');
  return value;
}

function numbers<T extends Record<string, unknown>>(row: T, keys: string[]): T {
  const output = { ...row };
  for (const key of keys) {
    if (output[key] !== null && output[key] !== undefined) {
      (output as Record<string, unknown>)[key] = Number(output[key]);
    }
  }
  return output;
}

function normalizeGoal(row: PlannerGoalRecord): PlannerGoalRecord {
  const value = numbers(row as unknown as Record<string, unknown>, ['version']) as unknown as PlannerGoalRecord;
  parsePlannerGoal(value);
  if (!Number.isInteger(value.version) || value.version < 1) throw new PlannerError('corrupt_goal', 'stored goal version is invalid', 500);
  return value;
}

function normalizePlan(row: PlannerPlanRecord): PlannerPlanRecord {
  const value = numbers(row as unknown as Record<string, unknown>, ['version', 'baseline_value', 'target_value']) as unknown as PlannerPlanRecord;
  value.advisory_only = Boolean(value.advisory_only);
  if (!value.advisory_only || value.action_authority !== 'none'
    || value.policy_version !== PLANNER_POLICY_VERSION
    || !['conservative', 'balanced', 'accelerated'].includes(value.strategy)
    || !['clear', 'advisory', 'blocking'].includes(value.conflict_status)
    || !Number.isInteger(value.version) || value.version < 1
    || (value.baseline_value !== null && !Number.isSafeInteger(value.baseline_value))
    || !Number.isSafeInteger(value.target_value)) {
    throw new PlannerError('corrupt_plan', 'stored plan authority or version is invalid', 500);
  }
  let evidence: unknown;
  try { evidence = JSON.parse(value.evidence_bundle_json); } catch { throw new PlannerError('corrupt_plan', 'stored plan evidence is invalid', 500); }
  if (typeof evidence !== 'object' || evidence === null || Array.isArray(evidence)) {
    throw new PlannerError('corrupt_plan', 'stored plan evidence is invalid', 500);
  }
  const { hash, ...evidenceCore } = evidence as Record<string, unknown>;
  if (hash !== value.evidence_bundle_hash || plannerHash(evidenceCore) !== value.evidence_bundle_hash) {
    throw new PlannerError('corrupt_plan', 'stored plan evidence fingerprint is invalid', 500);
  }
  return value;
}

function normalizeStep(row: PlannerStepRecord): PlannerStepRecord {
  const value = numbers(row as unknown as Record<string, unknown>, [
    'ordinal', 'effort_points', 'completion_target_value',
  ]) as unknown as PlannerStepRecord;
  const { id: _id, step_hash: hash, created_at: _createdAt, ...core } = value;
  const validAuthority = value.kind === 'action_candidate'
    ? value.action_route === 'g6_supervised_action' && value.execution_state === 'not_authorized'
    : value.action_route === 'none' && value.execution_state === 'not_applicable';
  if (!['analysis', 'review', 'action_candidate', 'measure'].includes(value.kind)
    || !['low', 'medium', 'high'].includes(value.confidence)
    || !Number.isInteger(value.ordinal) || value.ordinal < 1
    || !Number.isInteger(value.effort_points) || value.effort_points < 1
    || !Number.isSafeInteger(value.completion_target_value)
    || plannerMetricUnit(value.completion_metric_key) === undefined
    || !validAuthority || plannerHash(core) !== hash) {
    throw new PlannerError('corrupt_plan', 'stored plan step is invalid', 500);
  }
  return value;
}

function normalizeConflict(row: PlannerConflictRecord): PlannerConflictRecord {
  const { id: _id, conflict_hash: hash, created_at: _createdAt, ...core } = row;
  if (!['advisory', 'blocking'].includes(row.severity)
    || !['evidence', 'goal', 'budget', 'capacity', 'policy'].includes(row.category)
    || plannerHash(core) !== hash) {
    throw new PlannerError('corrupt_plan', 'stored plan conflict is invalid', 500);
  }
  return row;
}

function normalizeSimulation(row: PlannerSimulationRecord): PlannerSimulationRecord {
  const value = numbers(row as unknown as Record<string, unknown>, [
    'projected_value', 'target_value', 'progress_basis_points',
  ]) as unknown as PlannerSimulationRecord;
  const { id: _id, simulation_hash: hash, created_at: _createdAt, ...core } = value;
  if (!['conservative', 'expected', 'ambitious'].includes(value.scenario)
    || !['blocked', 'partial', 'meets_target'].includes(value.feasibility)
    || !['low', 'medium', 'high'].includes(value.uncertainty)
    || (value.projected_value !== null && !Number.isSafeInteger(value.projected_value))
    || !Number.isSafeInteger(value.target_value)
    || !Number.isInteger(value.progress_basis_points)
    || value.progress_basis_points < 0 || value.progress_basis_points > 10_000
    || plannerHash(core) !== hash) {
    throw new PlannerError('corrupt_plan', 'stored plan simulation is invalid', 500);
  }
  return value;
}

function normalizeDecision(row: PlannerDecisionRecord): PlannerDecisionRecord {
  const value = { ...row, grants_action_authority: Boolean(row.grants_action_authority) };
  if (value.grants_action_authority) {
    throw new PlannerError('corrupt_plan', 'stored plan decision grants forbidden action authority', 500);
  }
  const normalized = value as PlannerDecisionRecord;
  const { id: _id, decision_hash: hash, created_at: _createdAt, ...core } = normalized;
  if (!['accepted', 'rejected'].includes(normalized.decision)
    || normalized.actor !== 'founder'
    || !SAFE_KEY.test(normalized.reason_code)
    || plannerHash(core) !== hash) {
    throw new PlannerError('corrupt_plan', 'stored plan decision is invalid', 500);
  }
  return normalized;
}

function normalizeCheckpoint(row: PlannerCheckpointRecord): PlannerCheckpointRecord {
  const value = numbers(row as unknown as Record<string, unknown>, ['observed_value', 'target_value']) as unknown as PlannerCheckpointRecord;
  const { id: _id, evidence_hash: hash, created_at: _createdAt, ...core } = value;
  if ((value.observed_value !== null && !Number.isSafeInteger(value.observed_value))
    || !Number.isSafeInteger(value.target_value)
    || !['fresh', 'stale', 'future_source_timestamp'].includes(value.freshness_status)
    || !['target_met', 'progress', 'no_progress', 'unavailable'].includes(value.verdict)
    || plannerMetricUnit(value.metric_key) === undefined
    || plannerHash(core) !== hash) {
    throw new PlannerError('corrupt_plan', 'stored plan checkpoint is invalid', 500);
  }
  return value;
}

function normalizeOutcome(row: PlannerOutcomeRecord): PlannerOutcomeRecord {
  const { id: _id, outcome_hash: hash, created_at: _createdAt, ...core } = row;
  if (!['useful', 'not_useful'].includes(row.outcome)
    || row.actor !== 'founder'
    || plannerHash(core) !== hash) {
    throw new PlannerError('corrupt_plan', 'stored plan outcome is invalid', 500);
  }
  return row;
}

function normalizeGraph(
  planRow: PlannerPlanRecord,
  stepRows: PlannerStepRecord[],
  conflictRows: PlannerConflictRecord[],
  simulationRows: PlannerSimulationRecord[],
): {
  plan: PlannerPlanRecord;
  steps: PlannerStepRecord[];
  conflicts: PlannerConflictRecord[];
  simulations: PlannerSimulationRecord[];
} {
  const plan = normalizePlan(planRow);
  const steps = stepRows.map(normalizeStep).sort((left, right) => left.ordinal - right.ordinal);
  const conflicts = conflictRows.map(normalizeConflict)
    .sort((left, right) => left.conflict_key.localeCompare(right.conflict_key));
  const simulations = simulationRows.map(normalizeSimulation)
    .sort((left, right) => left.scenario.localeCompare(right.scenario));
  if (steps.length < 1 || steps.length > 12 || simulations.length !== 3 || conflicts.length > 32) {
    throw new PlannerError('corrupt_plan', 'stored plan graph cardinality is invalid', 500);
  }
  const linked = [...steps, ...conflicts, ...simulations].every((row) =>
    row.tenant_id === plan.tenant_id && row.plan_id === plan.id);
  const ordinalSet = new Set(steps.map((row) => row.ordinal));
  const conflictSet = new Set(conflicts.map((row) => row.conflict_key));
  const scenarioSet = new Set(simulations.map((row) => row.scenario));
  const conflictStatus = conflicts.some((row) => row.severity === 'blocking')
    ? 'blocking' : conflicts.length ? 'advisory' : 'clear';
  if (!linked || ordinalSet.size !== steps.length || steps.some((row, index) => row.ordinal !== index + 1)
    || conflictSet.size !== conflicts.length
    || !['conservative', 'expected', 'ambitious'].every((scenario) => scenarioSet.has(scenario as PlannerSimulationRecord['scenario']))
    || conflictStatus !== plan.conflict_status) {
    throw new PlannerError('corrupt_plan', 'stored plan graph linkage is invalid', 500);
  }
  const {
    id: _id, evidence_bundle_json: _evidenceJson, plan_hash: planHash,
    created_at: _createdAt, ...planCore
  } = plan;
  const expectedPlanHash = plannerHash({
    ...planCore,
    steps: steps.map((row) => row.step_hash),
    conflicts: conflicts.map((row) => row.conflict_hash),
    simulations: simulations.map((row) => row.simulation_hash),
  });
  if (expectedPlanHash !== planHash) throw new PlannerError('corrupt_plan', 'stored plan graph fingerprint is invalid', 500);
  return { plan, steps, conflicts, simulations };
}

function isPostgres(knex: Knex): boolean {
  const client = String(knex.client.config.client);
  return client === 'pg' || client.includes('postgres');
}

export class PlannerRepository {
  constructor(
    private readonly knex: Knex,
    private readonly clock: () => Date = () => new Date(),
    private readonly uuid: () => string = randomUUID,
  ) {}

  private now(): string { return this.clock().toISOString(); }

  newId(): string { return this.uuid(); }

  async createGoal(input: {
    tenantId: string;
    manifest: PlannerGoalManifest;
    idempotencyKey: string;
    previousGoalVersionId?: string;
  }): Promise<{ goal: PlannerGoalRecord; replayed: boolean }> {
    const idempotencyKey = safeKey(input.idempotencyKey, 'invalid_goal_idempotency');
    const manifestJson = canonicalStringify(input.manifest);
    const manifestHash = plannerHash(input.manifest);
    const requestHash = plannerHash({ manifest: input.manifest, previous_goal_version_id: input.previousGoalVersionId ?? null });
    return this.knex.transaction(async (trx) => {
      if (isPostgres(this.knex)) await trx('tenants').where({ id: input.tenantId }).forUpdate().first();
      const replay = await trx<PlannerGoalRecord>(PLANNER_TABLES.goals)
        .where({ tenant_id: input.tenantId, idempotency_key: idempotencyKey }).first();
      if (replay) {
        const normalized = normalizeGoal(replay);
        if (normalized.request_hash !== requestHash) throw new PlannerError('goal_idempotency_conflict', 'goal idempotency key binds different input', 409);
        return { goal: normalized, replayed: true };
      }
      let version = 1;
      let previous: PlannerGoalRecord | undefined;
      if (input.previousGoalVersionId) {
        previous = await trx<PlannerGoalRecord>(PLANNER_TABLES.goals)
          .where({ id: input.previousGoalVersionId, tenant_id: input.tenantId }).first();
        if (!previous) throw new PlannerError('goal_version_not_found', 'previous goal version was not found', 404);
        previous = normalizeGoal(previous);
        if (previous.goal_key !== input.manifest.goal_key) throw new PlannerError('goal_replacement_mismatch', 'goal replacement must preserve goal key', 409);
        const replacement = await trx<PlannerGoalRecord>(PLANNER_TABLES.goals)
          .where({ previous_goal_version_id: previous.id, tenant_id: input.tenantId }).first();
        if (replacement) throw new PlannerError('goal_already_replaced', 'goal version already has a successor', 409);
        version = previous.version + 1;
      } else {
        const existing = await trx<PlannerGoalRecord>(PLANNER_TABLES.goals)
          .where({ tenant_id: input.tenantId, goal_key: input.manifest.goal_key }).first();
        if (existing) throw new PlannerError('goal_version_required', 'existing goal must be replaced with a new version', 409);
      }
      const createdAt = this.now();
      const goal: PlannerGoalRecord = {
        id: this.uuid(), tenant_id: input.tenantId, goal_key: input.manifest.goal_key,
        version, previous_goal_version_id: previous?.id ?? null, idempotency_key: idempotencyKey,
        request_hash: requestHash, manifest_json: manifestJson, manifest_hash: manifestHash,
        created_at: createdAt,
      };
      await trx(PLANNER_TABLES.goals).insert(goal);
      return { goal, replayed: false };
    });
  }

  async findGoal(tenantId: string, id: string): Promise<PlannerGoalRecord | undefined> {
    const row = await this.knex<PlannerGoalRecord>(PLANNER_TABLES.goals).where({ tenant_id: tenantId, id }).first();
    return row ? normalizeGoal(row) : undefined;
  }

  async listGoals(tenantId: string): Promise<PlannerGoalRecord[]> {
    return (await this.knex<PlannerGoalRecord>(PLANNER_TABLES.goals)
      .where({ tenant_id: tenantId }).orderBy('created_at', 'desc')).map(normalizeGoal);
  }

  async goalReplacement(tenantId: string, goalId: string): Promise<PlannerGoalRecord | undefined> {
    const row = await this.knex<PlannerGoalRecord>(PLANNER_TABLES.goals)
      .where({ tenant_id: tenantId, previous_goal_version_id: goalId }).first();
    return row ? normalizeGoal(row) : undefined;
  }

  async insertPlanGraph(input: {
    plan: PlannerPlanRecord;
    steps: PlannerStepRecord[];
    conflicts: PlannerConflictRecord[];
    simulations: PlannerSimulationRecord[];
  }): Promise<{ view: PlannerPlanView; replayed: boolean }> {
    normalizeGraph(input.plan, input.steps, input.conflicts, input.simulations);
    return this.knex.transaction(async (trx) => {
      if (isPostgres(this.knex)) await trx('tenants').where({ id: input.plan.tenant_id }).forUpdate().first();
      const replay = await trx<PlannerPlanRecord>(PLANNER_TABLES.plans)
        .where({ tenant_id: input.plan.tenant_id, idempotency_key: input.plan.idempotency_key }).first();
      if (replay) {
        const normalized = normalizePlan(replay);
        if (normalized.request_hash !== input.plan.request_hash) throw new PlannerError('plan_idempotency_conflict', 'plan idempotency key binds different input', 409);
        return { view: await this.viewWith(trx, normalized), replayed: true };
      }
      const goalRow = await trx<PlannerGoalRecord>(PLANNER_TABLES.goals)
        .where({ tenant_id: input.plan.tenant_id, id: input.plan.goal_version_id }).first();
      if (!goalRow) throw new PlannerError('goal_version_not_found', 'goal version was not found', 404);
      const goal = normalizeGoal(goalRow);
      const goalReplacement = await trx<PlannerGoalRecord>(PLANNER_TABLES.goals)
        .where({ tenant_id: input.plan.tenant_id, previous_goal_version_id: goal.id }).first();
      if (goalReplacement) throw new PlannerError('goal_version_superseded', 'a superseded goal cannot create a new plan', 409);
      if (input.plan.previous_plan_version_id) {
        const previousRow = await trx<PlannerPlanRecord>(PLANNER_TABLES.plans)
          .where({ tenant_id: input.plan.tenant_id, id: input.plan.previous_plan_version_id }).first();
        if (!previousRow) throw new PlannerError('plan_version_not_found', 'previous plan version was not found', 404);
        const previous = normalizePlan(previousRow);
        if (previous.plan_key !== input.plan.plan_key) throw new PlannerError('plan_replacement_mismatch', 'plan replacement must preserve plan key', 409);
        if (input.plan.version !== previous.version + 1) throw new PlannerError('plan_version_mismatch', 'plan version must increment its predecessor', 409);
        const previousGoal = await trx<PlannerGoalRecord>(PLANNER_TABLES.goals)
          .where({ tenant_id: input.plan.tenant_id, id: previous.goal_version_id }).first();
        if (!previousGoal || previousGoal.goal_key !== goal.goal_key) {
          throw new PlannerError('plan_replacement_mismatch', 'plan replacement must preserve goal key', 409);
        }
        const replacement = await trx<PlannerPlanRecord>(PLANNER_TABLES.plans)
          .where({ tenant_id: input.plan.tenant_id, previous_plan_version_id: previous.id }).first();
        if (replacement) throw new PlannerError('plan_already_replaced', 'plan version already has a successor', 409);
      } else {
        if (input.plan.version !== 1) throw new PlannerError('plan_version_mismatch', 'an initial plan version must equal one', 409);
        const same = await trx(`${PLANNER_TABLES.plans} as p`)
          .join(`${PLANNER_TABLES.goals} as g`, 'g.id', 'p.goal_version_id')
          .where('p.tenant_id', input.plan.tenant_id)
          .where('p.plan_key', input.plan.plan_key)
          .where('g.goal_key', goal.goal_key)
          .first('p.id');
        if (same) throw new PlannerError('plan_version_required', 'existing plan key must be replaced with a new version', 409);
      }
      await trx(PLANNER_TABLES.plans).insert(input.plan);
      if (input.steps.length) await trx(PLANNER_TABLES.steps).insert(input.steps);
      if (input.conflicts.length) await trx(PLANNER_TABLES.conflicts).insert(input.conflicts);
      if (input.simulations.length) await trx(PLANNER_TABLES.simulations).insert(input.simulations);
      return { view: await this.viewWith(trx, input.plan), replayed: false };
    });
  }

  async findPlan(tenantId: string, id: string): Promise<PlannerPlanRecord | undefined> {
    const row = await this.knex<PlannerPlanRecord>(PLANNER_TABLES.plans).where({ tenant_id: tenantId, id }).first();
    return row ? normalizePlan(row) : undefined;
  }

  async listPlans(tenantId: string): Promise<PlannerPlanRecord[]> {
    return (await this.knex<PlannerPlanRecord>(PLANNER_TABLES.plans)
      .where({ tenant_id: tenantId }).orderBy('created_at', 'desc')).map(normalizePlan);
  }

  async planReplacement(tenantId: string, planId: string): Promise<PlannerPlanRecord | undefined> {
    const row = await this.knex<PlannerPlanRecord>(PLANNER_TABLES.plans)
      .where({ tenant_id: tenantId, previous_plan_version_id: planId }).first();
    return row ? normalizePlan(row) : undefined;
  }

  async planView(tenantId: string, id: string): Promise<PlannerPlanView> {
    const plan = await this.findPlan(tenantId, id);
    if (!plan) throw new PlannerError('plan_not_found', 'plan was not found', 404);
    return this.viewWith(this.knex, plan);
  }

  private async viewWith(connection: Knex | Knex.Transaction, plan: PlannerPlanRecord): Promise<PlannerPlanView> {
    const goalRow = await connection<PlannerGoalRecord>(PLANNER_TABLES.goals)
      .where({ tenant_id: plan.tenant_id, id: plan.goal_version_id }).first();
    if (!goalRow) throw new PlannerError('corrupt_plan', 'plan goal is missing', 500);
    const [steps, conflicts, simulations, decisions, checkpoints, outcomes] = await Promise.all([
      connection<PlannerStepRecord>(PLANNER_TABLES.steps).where({ tenant_id: plan.tenant_id, plan_id: plan.id }).orderBy('ordinal', 'asc'),
      connection<PlannerConflictRecord>(PLANNER_TABLES.conflicts).where({ tenant_id: plan.tenant_id, plan_id: plan.id }).orderBy('conflict_key', 'asc'),
      connection<PlannerSimulationRecord>(PLANNER_TABLES.simulations).where({ tenant_id: plan.tenant_id, plan_id: plan.id }).orderBy('scenario', 'asc'),
      connection<PlannerDecisionRecord>(PLANNER_TABLES.decisions).where({ tenant_id: plan.tenant_id, plan_id: plan.id }).orderBy('created_at', 'asc'),
      connection<PlannerCheckpointRecord>(PLANNER_TABLES.checkpoints).where({ tenant_id: plan.tenant_id, plan_id: plan.id }).orderBy('observed_at', 'asc'),
      connection<PlannerOutcomeRecord>(PLANNER_TABLES.outcomes).where({ tenant_id: plan.tenant_id, plan_id: plan.id }).orderBy('created_at', 'asc'),
    ]);
    const goal = normalizeGoal(goalRow);
    const goalManifest = parsePlannerGoal(goal);
    const graph = normalizeGraph(plan, steps, conflicts, simulations);
    const evidence = JSON.parse(graph.plan.evidence_bundle_json) as Record<string, unknown>;
    const evidenceMetric = typeof evidence.metric === 'object' && evidence.metric !== null
      ? evidence.metric as Record<string, unknown> : {};
    if (evidence.schema_version !== PLANNER_EVIDENCE_SCHEMA
      || evidence.policy_version !== graph.plan.policy_version
      || evidence.goal_version_id !== goal.id
      || evidence.goal_manifest_hash !== goal.manifest_hash
      || evidenceMetric.key !== goalManifest.metric.key
      || evidenceMetric.unit !== goalManifest.metric.unit
      || evidenceMetric.value !== graph.plan.baseline_value) {
      throw new PlannerError('corrupt_plan', 'stored plan evidence bindings are invalid', 500);
    }
    const normalizedDecisions = decisions.map(normalizeDecision);
    const normalizedCheckpoints = checkpoints.map(normalizeCheckpoint);
    const normalizedOutcomes = outcomes.map(normalizeOutcome);
    return {
      plan: graph.plan, goal, goal_manifest: goalManifest,
      steps: graph.steps, conflicts: graph.conflicts,
      simulations: graph.simulations, decisions: normalizedDecisions,
      checkpoints: normalizedCheckpoints, outcomes: normalizedOutcomes,
    };
  }

  async recordDecision(input: Omit<PlannerDecisionRecord, 'id' | 'decision_hash' | 'created_at'>): Promise<{ record: PlannerDecisionRecord; replayed: boolean }> {
    const idempotency = safeKey(input.idempotency_key, 'invalid_decision_idempotency');
    return this.knex.transaction(async (trx) => {
      const existing = await trx<PlannerDecisionRecord>(PLANNER_TABLES.decisions).where({
        tenant_id: input.tenant_id, plan_id: input.plan_id, idempotency_key: idempotency,
      }).first();
      const core = { ...input, idempotency_key: idempotency };
      const hash = plannerHash(core);
      if (existing) {
        if (existing.decision_hash !== hash) throw new PlannerError('decision_idempotency_conflict', 'decision key binds different input', 409);
        return { record: normalizeDecision(existing), replayed: true };
      }
      const createdAt = this.now();
      const record: PlannerDecisionRecord = { id: this.uuid(), ...core, decision_hash: hash, created_at: createdAt };
      await trx(PLANNER_TABLES.decisions).insert(record);
      return { record: normalizeDecision(record), replayed: false };
    });
  }

  async recordCheckpoint(input: Omit<PlannerCheckpointRecord, 'id' | 'evidence_hash' | 'created_at'>): Promise<{ record: PlannerCheckpointRecord; replayed: boolean }> {
    const idempotency = safeKey(input.idempotency_key, 'invalid_checkpoint_idempotency');
    return this.knex.transaction(async (trx) => {
      const existing = await trx<PlannerCheckpointRecord>(PLANNER_TABLES.checkpoints).where({
        tenant_id: input.tenant_id, plan_id: input.plan_id, idempotency_key: idempotency,
      }).first();
      const core = { ...input, idempotency_key: idempotency };
      const hash = plannerHash(core);
      if (existing) {
        if (existing.evidence_hash !== hash) throw new PlannerError('checkpoint_idempotency_conflict', 'checkpoint key binds different evidence', 409);
        return { record: normalizeCheckpoint(existing), replayed: true };
      }
      const record: PlannerCheckpointRecord = { id: this.uuid(), ...core, evidence_hash: hash, created_at: input.observed_at };
      await trx(PLANNER_TABLES.checkpoints).insert(record);
      return { record, replayed: false };
    });
  }

  async recordOutcome(input: Omit<PlannerOutcomeRecord, 'id' | 'outcome_hash' | 'created_at'>): Promise<{ record: PlannerOutcomeRecord; replayed: boolean }> {
    const idempotency = safeKey(input.idempotency_key, 'invalid_outcome_idempotency');
    return this.knex.transaction(async (trx) => {
      const existing = await trx<PlannerOutcomeRecord>(PLANNER_TABLES.outcomes).where({
        tenant_id: input.tenant_id, plan_id: input.plan_id, idempotency_key: idempotency,
      }).first();
      const core = { ...input, idempotency_key: idempotency };
      const hash = plannerHash(core);
      if (existing) {
        if (existing.outcome_hash !== hash) throw new PlannerError('outcome_idempotency_conflict', 'outcome key binds different input', 409);
        return { record: normalizeOutcome(existing), replayed: true };
      }
      const createdAt = this.now();
      const record: PlannerOutcomeRecord = { id: this.uuid(), ...core, outcome_hash: hash, created_at: createdAt };
      await trx(PLANNER_TABLES.outcomes).insert(record);
      return { record: normalizeOutcome(record), replayed: false };
    });
  }
}
