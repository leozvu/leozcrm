import { createHash } from 'node:crypto';
import { canonicalStringify } from './businessMemory';

export const PLANNER_GOAL_SCHEMA = 'leozops_planner_goal_v1' as const;
export const PLANNER_EVIDENCE_SCHEMA = 'leozops_planner_evidence_v1' as const;
export const PLANNER_POLICY_VERSION = 'planner_policy_v1' as const;

export const PLANNER_TABLES = {
  goals: 'planner_goal_versions',
  plans: 'planner_plan_versions',
  steps: 'planner_plan_steps',
  conflicts: 'planner_plan_conflicts',
  simulations: 'planner_plan_simulations',
  decisions: 'planner_plan_decisions',
  checkpoints: 'planner_plan_checkpoints',
  outcomes: 'planner_plan_outcomes',
} as const;

export type PlannerMetricKey =
  | 'active_pipeline'
  | 'won'
  | 'win_rate'
  | 'active_owner_coverage'
  | 'overdue_expected_close'
  | 'missing_source'
  | 'missing_created_at';
export type PlannerMetricUnit = 'count' | 'basis_points';
export type PlannerDirection = 'increase' | 'decrease' | 'maintain';
export type PlannerStrategy = 'conservative' | 'balanced' | 'accelerated';
export type PlannerDecision = 'accepted' | 'rejected';
export type PlannerOutcome = 'useful' | 'not_useful';

export interface PlannerGoalManifest {
  schema_version: typeof PLANNER_GOAL_SCHEMA;
  goal_key: string;
  title: string;
  metric: {
    key: PlannerMetricKey;
    direction: PlannerDirection;
    target_value: number;
    unit: PlannerMetricUnit;
  };
  horizon: { starts_on: string; target_on: string };
  constraints: {
    max_steps: number;
    max_effort_points: number;
    action_candidates_allowed: boolean;
  };
  assumptions: Array<{
    key: string;
    statement: string;
    confidence: 'low' | 'medium' | 'high';
    evidence_keys: string[];
  }>;
  owner: string;
}

export interface PlannerGoalRecord {
  id: string;
  tenant_id: string;
  goal_key: string;
  version: number;
  previous_goal_version_id: string | null;
  idempotency_key: string;
  request_hash: string;
  manifest_json: string;
  manifest_hash: string;
  created_at: string;
}

export interface PlannerEvidenceBundle {
  schema_version: typeof PLANNER_EVIDENCE_SCHEMA;
  policy_version: typeof PLANNER_POLICY_VERSION;
  goal_version_id: string;
  goal_manifest_hash: string;
  as_of: string;
  generated_at: string;
  freshness_status: 'fresh' | 'stale' | 'future_source_timestamp';
  source_snapshot_id: string;
  intelligence_run_id: string;
  formula_version: string;
  metric: { key: PlannerMetricKey; value: number | null; unit: PlannerMetricUnit };
  recommendation_codes: string[];
  evidence_keys: string[];
  hash: string;
}

export interface PlannerPlanRecord {
  id: string;
  tenant_id: string;
  goal_version_id: string;
  plan_key: string;
  version: number;
  previous_plan_version_id: string | null;
  strategy: PlannerStrategy;
  idempotency_key: string;
  request_hash: string;
  policy_version: typeof PLANNER_POLICY_VERSION;
  evidence_bundle_json: string;
  evidence_bundle_hash: string;
  baseline_value: number | null;
  target_value: number;
  conflict_status: 'clear' | 'advisory' | 'blocking';
  advisory_only: boolean;
  action_authority: 'none';
  plan_hash: string;
  created_at: string;
}

export interface PlannerStepRecord {
  id: string;
  tenant_id: string;
  plan_id: string;
  ordinal: number;
  step_key: string;
  kind: 'analysis' | 'review' | 'action_candidate' | 'measure';
  title: string;
  rationale: string;
  effort_points: number;
  confidence: 'low' | 'medium' | 'high';
  evidence_keys_json: string;
  completion_metric_key: PlannerMetricKey;
  completion_target_value: number;
  action_route: 'none' | 'g6_supervised_action';
  execution_state: 'not_applicable' | 'not_authorized';
  step_hash: string;
  created_at: string;
}

export interface PlannerConflictRecord {
  id: string;
  tenant_id: string;
  plan_id: string;
  conflict_key: string;
  severity: 'advisory' | 'blocking';
  category: 'evidence' | 'goal' | 'budget' | 'capacity' | 'policy';
  message: string;
  evidence_keys_json: string;
  conflict_hash: string;
  created_at: string;
}

export interface PlannerSimulationRecord {
  id: string;
  tenant_id: string;
  plan_id: string;
  scenario: 'conservative' | 'expected' | 'ambitious';
  projected_value: number | null;
  target_value: number;
  progress_basis_points: number;
  feasibility: 'blocked' | 'partial' | 'meets_target';
  uncertainty: 'low' | 'medium' | 'high';
  assumptions_json: string;
  simulation_hash: string;
  created_at: string;
}

export interface PlannerDecisionRecord {
  id: string;
  tenant_id: string;
  plan_id: string;
  idempotency_key: string;
  decision: PlannerDecision;
  reason_code: string;
  actor: 'founder';
  grants_action_authority: false;
  decision_hash: string;
  created_at: string;
}

export interface PlannerCheckpointRecord {
  id: string;
  tenant_id: string;
  plan_id: string;
  idempotency_key: string;
  source_snapshot_id: string;
  intelligence_run_id: string;
  metric_key: PlannerMetricKey;
  observed_value: number | null;
  target_value: number;
  freshness_status: 'fresh' | 'stale' | 'future_source_timestamp';
  verdict: 'target_met' | 'progress' | 'no_progress' | 'unavailable';
  evidence_hash: string;
  observed_at: string;
  created_at: string;
}

export interface PlannerOutcomeRecord {
  id: string;
  tenant_id: string;
  plan_id: string;
  idempotency_key: string;
  outcome: PlannerOutcome;
  note: string | null;
  actor: 'founder';
  outcome_hash: string;
  created_at: string;
}

export class PlannerError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: 400 | 404 | 409 | 500 = 400) {
    super(message);
    this.name = 'PlannerError';
  }
}

const SAFE_KEY = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const EVIDENCE_KEY = /^[a-z0-9][a-z0-9._:-]{0,191}$/;
const METRICS: Readonly<Record<PlannerMetricKey, PlannerMetricUnit>> = Object.freeze({
  active_pipeline: 'count',
  won: 'count',
  win_rate: 'basis_points',
  active_owner_coverage: 'basis_points',
  overdue_expected_close: 'count',
  missing_source: 'count',
  missing_created_at: 'count',
});

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PlannerError('invalid_goal', `${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new PlannerError('invalid_goal', `${path} has missing or unsupported fields`);
  }
}

function text(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string') throw new PlannerError('invalid_goal', `${path} must be text`);
  const output = value.trim();
  if (!output || output.length > max || /[\u0000-\u001F]/.test(output)) {
    throw new PlannerError('invalid_goal', `${path} is invalid`);
  }
  return output;
}

function key(value: unknown, path: string): string {
  const output = text(value, path, 128);
  if (!SAFE_KEY.test(output)) throw new PlannerError('invalid_goal', `${path} must be a stable lowercase key`);
  return output;
}

function isoDate(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PlannerError('invalid_goal', `${path} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new PlannerError('invalid_goal', `${path} is not a real date`);
  }
  return value;
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw new PlannerError('invalid_goal', `${path} must be an integer between ${min} and ${max}`);
  }
  return Number(value);
}

export function plannerHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

export function validatePlannerGoal(raw: unknown): PlannerGoalManifest {
  const root = object(raw, 'goal');
  exact(root, ['schema_version', 'goal_key', 'title', 'metric', 'horizon', 'constraints', 'assumptions', 'owner'], 'goal');
  if (root.schema_version !== PLANNER_GOAL_SCHEMA) throw new PlannerError('invalid_goal', `schema_version must equal ${PLANNER_GOAL_SCHEMA}`);
  const metric = object(root.metric, 'goal.metric');
  exact(metric, ['key', 'direction', 'target_value', 'unit'], 'goal.metric');
  if (typeof metric.key !== 'string' || !(metric.key in METRICS)) throw new PlannerError('invalid_goal_metric', 'metric key is unsupported');
  const metricKey = metric.key as PlannerMetricKey;
  if (!['increase', 'decrease', 'maintain'].includes(String(metric.direction))) throw new PlannerError('invalid_goal_metric', 'metric direction is unsupported');
  if (metric.unit !== METRICS[metricKey]) throw new PlannerError('invalid_goal_metric', 'metric unit does not match metric key');
  const maxTarget = metric.unit === 'basis_points' ? 10_000 : 1_000_000_000;
  const horizon = object(root.horizon, 'goal.horizon');
  exact(horizon, ['starts_on', 'target_on'], 'goal.horizon');
  const startsOn = isoDate(horizon.starts_on, 'goal.horizon.starts_on');
  const targetOn = isoDate(horizon.target_on, 'goal.horizon.target_on');
  const days = (Date.parse(`${targetOn}T00:00:00.000Z`) - Date.parse(`${startsOn}T00:00:00.000Z`)) / 86_400_000;
  if (days < 1 || days > 730) throw new PlannerError('invalid_goal_horizon', 'goal horizon must be between 1 and 730 days');
  const constraints = object(root.constraints, 'goal.constraints');
  exact(constraints, ['max_steps', 'max_effort_points', 'action_candidates_allowed'], 'goal.constraints');
  if (typeof constraints.action_candidates_allowed !== 'boolean') throw new PlannerError('invalid_goal_constraint', 'action_candidates_allowed must be boolean');
  if (!Array.isArray(root.assumptions) || root.assumptions.length > 12) throw new PlannerError('invalid_goal', 'assumptions must be a bounded array');
  const assumptions = root.assumptions.map((rawAssumption, index) => {
    const assumption = object(rawAssumption, `goal.assumptions[${index}]`);
    exact(assumption, ['key', 'statement', 'confidence', 'evidence_keys'], `goal.assumptions[${index}]`);
    if (!['low', 'medium', 'high'].includes(String(assumption.confidence))) throw new PlannerError('invalid_goal', 'assumption confidence is invalid');
    if (!Array.isArray(assumption.evidence_keys) || assumption.evidence_keys.length > 16) throw new PlannerError('invalid_goal', 'assumption evidence_keys must be bounded');
    const evidenceKeys = assumption.evidence_keys.map((item) => {
      if (typeof item !== 'string' || !EVIDENCE_KEY.test(item)) throw new PlannerError('invalid_goal', 'assumption evidence key is invalid');
      return item;
    });
    if (new Set(evidenceKeys).size !== evidenceKeys.length) throw new PlannerError('invalid_goal', 'assumption evidence keys contain duplicates');
    return {
      key: key(assumption.key, `goal.assumptions[${index}].key`),
      statement: text(assumption.statement, `goal.assumptions[${index}].statement`, 1_000),
      confidence: assumption.confidence as 'low' | 'medium' | 'high',
      evidence_keys: evidenceKeys,
    };
  });
  if (new Set(assumptions.map((assumption) => assumption.key)).size !== assumptions.length) {
    throw new PlannerError('invalid_goal', 'assumption keys contain duplicates');
  }
  return {
    schema_version: PLANNER_GOAL_SCHEMA,
    goal_key: key(root.goal_key, 'goal.goal_key'),
    title: text(root.title, 'goal.title', 200),
    metric: {
      key: metricKey,
      direction: metric.direction as PlannerDirection,
      target_value: integer(metric.target_value, 'goal.metric.target_value', 0, maxTarget),
      unit: metric.unit as PlannerMetricUnit,
    },
    horizon: { starts_on: startsOn, target_on: targetOn },
    constraints: {
      max_steps: integer(constraints.max_steps, 'goal.constraints.max_steps', 1, 12),
      max_effort_points: integer(constraints.max_effort_points, 'goal.constraints.max_effort_points', 1, 100),
      action_candidates_allowed: constraints.action_candidates_allowed,
    },
    assumptions,
    owner: text(root.owner, 'goal.owner', 128),
  };
}

export function parsePlannerGoal(record: PlannerGoalRecord): PlannerGoalManifest {
  let raw: unknown;
  try { raw = JSON.parse(record.manifest_json); } catch { throw new PlannerError('corrupt_goal', 'stored goal JSON is invalid', 500); }
  const goal = validatePlannerGoal(raw);
  if (plannerHash(goal) !== record.manifest_hash || goal.goal_key !== record.goal_key) {
    throw new PlannerError('corrupt_goal', 'stored goal fingerprint is invalid', 500);
  }
  return goal;
}

export function plannerMetricUnit(keyValue: PlannerMetricKey): PlannerMetricUnit {
  return METRICS[keyValue];
}
