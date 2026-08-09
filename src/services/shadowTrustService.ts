import {
  Phase2ReleaseDecisionRecord,
  ShadowDailyEvidence,
  ShadowReleaseDecision,
  ShadowTrustError,
  ShadowWindowEvaluation,
  businessDateAt,
  dailyFailureCodes,
  evaluateShadowWindow,
  expectedSyncsForWindow,
  isInsideBusinessWindow,
  shadowDailyEvidenceKey,
  weekdayOfBusinessDate,
} from '../domain/shadowTrust';
import { evidenceFingerprint } from '../domain/phase2Proof';
import {
  safeSourceOperationsCode,
  validateBusinessDate,
  validateBusinessTimezone,
} from '../domain/sourceOperations';
import { SourceOperationsRepository } from '../repositories/sourceOperationsRepository';
import { ShadowTrustRepository } from '../repositories/shadowTrustRepository';
import { SourceReconciliationService } from './sourceReconciliationService';

function nonNegativeInteger(value: number, code: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ShadowTrustError(code, 'shadow evidence count must be a non-negative integer');
  }
  return value;
}

function reviewScore(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new ShadowTrustError('invalid_reviewer_score', 'reviewer score must be an integer from 1 to 5');
  }
  return value;
}

function broadUtcWindow(businessDate: string): { from: string; to: string } {
  const center = new Date(`${businessDate}T00:00:00.000Z`);
  return {
    from: new Date(center.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
    to: new Date(center.getTime() + 48 * 60 * 60 * 1_000).toISOString(),
  };
}

export class ShadowTrustService {
  constructor(
    private readonly evidence: Pick<
      ShadowTrustRepository,
      'listPollRuns' | 'recordDailyEvidence' | 'listDailyEvidence' | 'recordReleaseDecision'
    >,
    private readonly operations: Pick<SourceOperationsRepository, 'findContext'>,
    private readonly reconciliation: Pick<SourceReconciliationService, 'run'>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async closeBusinessDay(input: {
    tenantId: string;
    sourceConnectionId: string;
    authorizationId: string;
    businessDate: string;
    businessTimezone: string;
    businessDays: string[];
    businessStartLocal: string;
    businessEndLocal: string;
    staleAfterMs: number;
    expectedReviewer: string;
    reviewer: string;
    reviewerScore: number;
    materialFalseClaim: boolean;
    observedSourceMutationCount: number;
    employeeWorkflowRegression: boolean;
    sourceLatencyRegression: boolean;
    sourceErrorRegression: boolean;
    incidentCount: number;
    rollbackEventCount: number;
  }): Promise<ShadowDailyEvidence> {
    const businessDate = validateBusinessDate(input.businessDate);
    const timezone = validateBusinessTimezone(input.businessTimezone);
    const allowedDays = new Set(input.businessDays.map((day) => day.toLowerCase()));
    if (!allowedDays.has(weekdayOfBusinessDate(businessDate))) {
      throw new ShadowTrustError('not_business_day', 'daily evidence date is not an approved business day');
    }
    if (input.reviewer !== input.expectedReviewer) {
      throw new ShadowTrustError('reviewer_mismatch', 'reviewer does not match the approved P1 identity');
    }
    if (!Number.isInteger(input.staleAfterMs) || input.staleAfterMs < 60_000) {
      throw new ShadowTrustError('invalid_stale_policy', 'stale policy is invalid');
    }

    const reconciliation = await this.reconciliation.run({
      tenantId: input.tenantId,
      sourceConnectionId: input.sourceConnectionId,
      businessDate,
      businessTimezone: timezone,
    });
    const context = await this.operations.findContext(input.tenantId, input.sourceConnectionId);
    if (!context) throw new ShadowTrustError('unknown_source_connection', 'source connection does not exist');

    const window = broadUtcWindow(businessDate);
    const allRuns = await this.evidence.listPollRuns({
      tenantId: input.tenantId,
      sourceConnectionId: input.sourceConnectionId,
      environment: 'production',
      ...window,
    });
    const dateRuns = allRuns.filter((run) => businessDateAt(run.started_at, timezone) === businessDate);
    const businessRuns = dateRuns.filter((run) => isInsideBusinessWindow(
      run.started_at,
      timezone,
      input.businessStartLocal,
      input.businessEndLocal,
    ));
    const authorizedRuns = businessRuns.filter((run) => run.authorization_id === input.authorizationId);
    const scheduled = authorizedRuns.filter((run) => run.outcome !== 'skipped');
    const successful = scheduled.filter(
      (run) => run.outcome === 'accepted' || run.outcome === 'not_modified',
    );
    const latestConfirmed = successful
      .map((run) => run.confirmed_fresh_at)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null;
    const reviewedAt = this.clock().toISOString();
    const confirmationAge = latestConfirmed === null
      ? null
      : Math.max(0, Math.floor((Date.parse(reviewedAt) - Date.parse(latestConfirmed)) / 1_000));

    const base = {
      tenant_id: input.tenantId,
      source_connection_id: input.sourceConnectionId,
      environment: 'production' as const,
      authorization_id: input.authorizationId,
      business_date: businessDate,
      business_timezone: timezone,
      expected_syncs: expectedSyncsForWindow(input.businessStartLocal, input.businessEndLocal),
      scheduled_syncs: scheduled.length,
      successful_syncs: successful.length,
      not_modified_syncs: successful.filter((run) => run.outcome === 'not_modified').length,
      failed_syncs: scheduled.filter((run) => run.outcome === 'failed').length,
      skipped_invocations: authorizedRuns.filter((run) => run.outcome === 'skipped').length,
      latest_confirmation_age_seconds: confirmationAge,
      stale_after_seconds: Math.floor(input.staleAfterMs / 1_000),
      reconciliation_id: reconciliation.id,
      reconciliation_status: reconciliation.status,
      source_total: reconciliation.source_total,
      snapshot_total: reconciliation.snapshot_total,
      brief_total: reconciliation.brief_total,
      native_stage_delta_count: reconciliation.status === 'passed' ? 0 : null,
      safe_source_delta_count: reconciliation.status === 'passed' ? 0 : null,
      source_mutation_count: dateRuns.reduce(
        (sum, run) => sum + run.source_mutation_count,
        nonNegativeInteger(input.observedSourceMutationCount, 'invalid_mutation_count'),
      ),
      employee_workflow_regression: input.employeeWorkflowRegression,
      source_latency_regression: input.sourceLatencyRegression,
      source_error_regression: input.sourceErrorRegression,
      formula_version: reconciliation.formula_version,
      snapshot_id: reconciliation.snapshot_id,
      intelligence_run_id: reconciliation.intelligence_run_id,
      reviewer: input.reviewer,
      reviewer_score: reviewScore(input.reviewerScore),
      material_false_claim: input.materialFalseClaim,
      incident_count: nonNegativeInteger(input.incidentCount, 'invalid_incident_count'),
      rollback_event_count: nonNegativeInteger(input.rollbackEventCount, 'invalid_rollback_count'),
      reviewed_at: reviewedAt,
    };
    const failureCodes = dailyFailureCodes(base);
    if (dateRuns.some((run) => run.authorization_id !== input.authorizationId)) {
      failureCodes.push('authorization_mismatch');
    }
    const failure_codes_json = JSON.stringify([...new Set(failureCodes)].sort());
    const withoutKey = {
      ...base,
      status: failureCodes.length === 0 ? 'passed' as const : 'failed' as const,
      failure_codes_json,
    };
    return this.evidence.recordDailyEvidence({
      ...withoutKey,
      evidence_key: shadowDailyEvidenceKey(withoutKey),
    });
  }

  async evaluate(input: {
    tenantId: string;
    sourceConnectionId: string;
    businessDays: string[];
  }): Promise<ShadowWindowEvaluation> {
    return evaluateShadowWindow(
      await this.evidence.listDailyEvidence(input.tenantId, input.sourceConnectionId),
      input.businessDays,
    );
  }

  async decide(input: {
    tenantId: string;
    sourceConnectionId: string;
    authorizationId: string;
    businessDays: string[];
    decision: ShadowReleaseDecision;
    decidedBy: string;
    reasonCode: string;
    extendUntilBusinessDate?: string;
  }): Promise<{ decision: Phase2ReleaseDecisionRecord; evaluation: ShadowWindowEvaluation }> {
    const evaluation = await this.evaluate(input);
    if (input.decision === 'go' && evaluation.verdict !== 'pass') {
      throw new ShadowTrustError('shadow_gate_blocked', 'go requires a passing ten-business-day shadow');
    }
    const reasonCode = safeSourceOperationsCode(input.reasonCode);
    if (reasonCode !== input.reasonCode) {
      throw new ShadowTrustError('invalid_reason_code', 'release reason code is invalid');
    }
    const extendUntil = input.decision === 'extend'
      ? validateBusinessDate(input.extendUntilBusinessDate ?? '')
      : null;
    if (input.decision !== 'extend' && input.extendUntilBusinessDate !== undefined) {
      throw new ShadowTrustError('invalid_extension_date', 'only extend may set an extension date');
    }
    const decidedAt = this.clock().toISOString();
    const core = {
      tenant_id: input.tenantId,
      source_connection_id: input.sourceConnectionId,
      authorization_id: input.authorizationId,
      decision: input.decision,
      decided_by: input.decidedBy,
      decided_at: decidedAt,
      evaluation_fingerprint: evaluation.evidence_fingerprint,
      reason_code: reasonCode,
      extend_until_business_date: extendUntil,
    };
    return {
      decision: await this.evidence.recordReleaseDecision({
        ...core,
        evidence_key: evidenceFingerprint(core),
      }),
      evaluation,
    };
  }
}
