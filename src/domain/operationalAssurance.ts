import { timingSafeEqual } from 'node:crypto';
import { credentialFingerprint } from './g6Policy';
import { evidenceFingerprint } from './phase2Proof';
import type { OperationalAssurancePolicyManifest } from './operationalAssurancePolicy';

export const PHASE5_TABLES = {
  policies: 'operational_assurance_policies',
  assessments: 'operational_assurance_assessments',
  releasePackages: 'operational_assurance_release_packages',
  events: 'operational_assurance_events',
} as const;

export const PHASE5_EXTERNAL_BLOCKERS = [
  'external_g5_release_unproven',
  'command_specific_g6_release_unproven',
  'production_supervised_history_unproven',
  'production_adapter_and_credential_absent',
  'deployed_monitoring_and_kill_switch_unproven',
  'production_canary_unproven',
  'external_incident_recovery_drill_unproven',
  'product_owner_g7_release_unproven',
] as const;

export type Phase5ExternalBlocker = typeof PHASE5_EXTERNAL_BLOCKERS[number];
export type AssuranceLocalStatus = 'pass' | 'fail';
export type AssuranceReleaseStatus = 'blocked_external';
export type AssuranceEventType = 'policy_accepted' | 'assessment_passed' | 'assessment_failed' | 'release_package_blocked';

export interface OperationalAssurancePolicyRecord {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  g7_policy_record_id: string;
  policy_id: string;
  environment: 'test' | 'production';
  g7_policy_fingerprint: string;
  valid_from: string;
  valid_until: string;
  policy_fingerprint: string;
  manifest_json: string;
  accepted_at: string;
  created_at: string;
}

export interface AssuranceDerivedFacts {
  assessed_at: string;
  window_started_at: string;
  assurance_policy_active: boolean;
  g5_current_go: boolean;
  g6_active: boolean;
  g7_active: boolean;
  simulation_passed: boolean;
  kill_switch_state: 'engaged' | 'released';
  open_incident_count: number;
  successful_executions: number;
  failed_executions: number;
  reconciliation_required_executions: number;
  in_progress_executions: number;
  successful_recoveries: number;
  resolved_incident_drills: number;
  event_count: number;
  event_chain_fingerprint: string;
  production_registry_size: number;
}

export interface AssuranceCheck {
  code: string;
  passed: boolean;
  evidence_fingerprint: string;
}

export interface OperationalAssuranceAssessmentRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  assessment_key: string;
  policy_fingerprint: string;
  g7_policy_fingerprint: string;
  facts_json: string;
  facts_fingerprint: string;
  checks_json: string;
  local_status: AssuranceLocalStatus;
  external_status: AssuranceReleaseStatus;
  external_blockers_json: string;
  assessed_by: string;
  assessed_at: string;
  assessment_fingerprint: string;
  created_at: string;
}

export interface OperationalAssuranceReleasePackageRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  assessment_id: string;
  package_key: string;
  policy_fingerprint: string;
  assessment_fingerprint: string;
  local_status: 'pass';
  release_status: AssuranceReleaseStatus;
  external_blockers_json: string;
  reviewed_by: string;
  reviewed_at: string;
  package_fingerprint: string;
  created_at: string;
}

export interface OperationalAssuranceEventRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  sequence: number;
  event_type: AssuranceEventType;
  actor: string;
  evidence_fingerprint: string;
  reason_code: string;
  occurred_at: string;
  event_fingerprint: string;
  created_at: string;
}

export class OperationalAssuranceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message);
    this.name = 'OperationalAssuranceError';
  }
}

export function assuranceFingerprint(value: unknown): string {
  return evidenceFingerprint(value);
}

export function assuranceCredentialMatches(secret: string, expected: string): boolean {
  let actual: string;
  try {
    actual = credentialFingerprint(secret);
  } catch {
    return false;
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(expected) || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function operationalAssurancePolicyIsActive(policy: OperationalAssurancePolicyManifest, at: string): boolean {
  const instant = Date.parse(at);
  return Number.isFinite(instant)
    && instant >= Date.parse(policy.valid_from)
    && instant < Date.parse(policy.valid_until);
}

export function evaluateOperationalAssurance(
  policy: OperationalAssurancePolicyManifest,
  facts: AssuranceDerivedFacts,
): { checks: AssuranceCheck[]; local_status: AssuranceLocalStatus } {
  const items: Array<[string, boolean, unknown]> = [
    ['assurance_policy_active', facts.assurance_policy_active, { assurance_policy_active: facts.assurance_policy_active }],
    ['g5_current_go', facts.g5_current_go, { g5_current_go: facts.g5_current_go }],
    ['g6_active', facts.g6_active, { g6_active: facts.g6_active }],
    ['g7_active', facts.g7_active, { g7_active: facts.g7_active }],
    ['simulation_passed', facts.simulation_passed, { simulation_passed: facts.simulation_passed }],
    ['kill_switch_engaged', facts.kill_switch_state === 'engaged', { kill_switch_state: facts.kill_switch_state }],
    ['no_open_incident', facts.open_incident_count === 0, { open_incident_count: facts.open_incident_count }],
    [
      'successful_execution_threshold',
      facts.successful_executions >= policy.window.min_successful_executions,
      { successful_executions: facts.successful_executions, required: policy.window.min_successful_executions },
    ],
    ['no_failed_execution', facts.failed_executions <= policy.window.max_failed_executions, { failed_executions: facts.failed_executions }],
    [
      'no_reconciliation_required_execution',
      facts.reconciliation_required_executions <= policy.window.max_reconciliation_required_executions,
      { reconciliation_required_executions: facts.reconciliation_required_executions },
    ],
    ['no_in_progress_execution', facts.in_progress_executions === 0, { in_progress_executions: facts.in_progress_executions }],
    ['successful_human_recovery', facts.successful_recoveries >= 1, { successful_recoveries: facts.successful_recoveries }],
    ['resolved_incident_halt_drill', facts.resolved_incident_drills >= 1, { resolved_incident_drills: facts.resolved_incident_drills }],
    ['production_registry_empty', facts.production_registry_size === 0, { production_registry_size: facts.production_registry_size }],
    ['event_chain_present', facts.event_count > 0, { event_count: facts.event_count, chain: facts.event_chain_fingerprint }],
  ];
  const checks = items.map(([code, passed, evidence]) => ({
    code,
    passed,
    evidence_fingerprint: assuranceFingerprint({ code, evidence, assessed_at: facts.assessed_at }),
  }));
  return { checks, local_status: checks.every((check) => check.passed) ? 'pass' : 'fail' };
}
