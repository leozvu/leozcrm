import { canonicalStringify } from '../domain/businessMemory';
import type { EgoricCeoBrief } from '../domain/egoricBrief';
import {
  PROACTIVE_POLICY,
  ProactiveAlertError,
  ProactiveAlertEventRecord,
  ProactiveAlertRecord,
  ProactiveAlertView,
  ProactiveCycleMode,
  ProactiveCycleRecord,
  ProactiveDeliveryResultRecord,
  ProactiveDeliveryView,
  ProactiveEvidenceQuality,
  ProactiveEvaluationStatus,
  ProactiveOutboxRecord,
  ProactiveRuleEvaluationRecord,
  ProactiveRuleId,
  ProactiveSeverity,
  ProactiveShadowBaseline,
  evaluateProactiveShadow,
  proactiveHash,
} from '../domain/proactiveAlerts';
import { NotificationDeliveryRegistry } from '../integrations/notifications/notificationDeliveryRegistry';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { ProactiveAlertRepository } from '../repositories/proactiveAlertRepository';
import { EgoricBriefService } from './egoricBriefService';

const KEY_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;
const ACTOR_RE = /^[A-Za-z0-9](?:[A-Za-z0-9 ._:@/-]{0,126}[A-Za-z0-9])?$/;
const SAFE_CODE_RE = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/;

const RULE_COPY: Readonly<Record<ProactiveRuleId, {
  title: string;
  rationale: (value: number) => string;
  recommendation: string;
}>> = Object.freeze({
  overdue_expected_close: {
    title: 'Expected-close commitments need review',
    rationale: (value) => `${value} active lead(s) have an expected close before the accepted cutoff.`,
    recommendation: 'Review the affected pipeline evidence and correct obsolete expected-close dates.',
  },
  active_owner_gap: {
    title: 'Active pipeline has ownership gaps',
    rationale: (value) => `${value} active lead(s) have no assigned owner in the accepted snapshot.`,
    recommendation: 'Review ownership coverage in Egoric; LeozOps will not assign an owner automatically.',
  },
});

interface RuleFact {
  id: ProactiveRuleId;
  value: number;
  threshold: number;
  urgentThreshold: number;
}

export interface ProactiveCycleOutput {
  cycle: ProactiveCycleRecord;
  replayed: boolean;
  evaluations: ProactiveRuleEvaluationRecord[];
  alerts: ProactiveAlertRecord[];
  outbox: ProactiveOutboxRecord[];
}

function exactIso(value: string | undefined, fallback: Date, code: string): string {
  const candidate = value ?? fallback.toISOString();
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(candidate)) {
    throw new ProactiveAlertError(code, 'timestamp must include an explicit timezone', 400);
  }
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) throw new ProactiveAlertError(code, 'timestamp is invalid', 400);
  return date.toISOString();
}

function key(value: string, code: string): string {
  if (!KEY_RE.test(value)) throw new ProactiveAlertError(code, 'idempotency key is invalid', 400);
  return value;
}

function actor(value: string): string {
  if (!ACTOR_RE.test(value)) throw new ProactiveAlertError('invalid_alert_actor', 'alert actor is invalid', 400);
  return value;
}

function code(value: string): string {
  if (!SAFE_CODE_RE.test(value)) throw new ProactiveAlertError('invalid_alert_reason', 'alert reason is invalid', 400);
  return value;
}

function severity(fact: RuleFact): ProactiveSeverity {
  return fact.value >= fact.urgentThreshold ? 'urgent' : 'warning';
}

function evidenceQuality(brief: EgoricCeoBrief): ProactiveEvidenceQuality {
  return brief.quality.missing_source > 0 || brief.quality.missing_created_at > 0 ? 'partial' : 'complete';
}

function ruleFacts(brief: EgoricCeoBrief): RuleFact[] {
  const assignedActive = brief.stages
    .filter((stage) => stage.kind === 'active')
    .reduce((total, stage) => total + stage.owner_assigned, 0);
  return [
    {
      id: 'overdue_expected_close',
      value: brief.headline.overdue_expected_close,
      ...PROACTIVE_POLICY.rules.overdue_expected_close,
    },
    {
      id: 'active_owner_gap',
      value: brief.headline.active_pipeline - assignedActive,
      ...PROACTIVE_POLICY.rules.active_owner_gap,
    },
  ];
}

function nextAvailableAt(now: string): string {
  const date = new Date(now);
  const hour = date.getUTCHours();
  if (hour >= PROACTIVE_POLICY.quietHoursUtc.startHour) {
    date.setUTCDate(date.getUTCDate() + 1);
    date.setUTCHours(PROACTIVE_POLICY.quietHoursUtc.endHour, 0, 0, 0);
  } else if (hour < PROACTIVE_POLICY.quietHoursUtc.endHour) {
    date.setUTCHours(PROACTIVE_POLICY.quietHoursUtc.endHour, 0, 0, 0);
  }
  return date.toISOString();
}

export class ProactiveAlertService {
  constructor(
    private readonly repository: ProactiveAlertRepository,
    private readonly memory: BusinessMemoryRepository,
    private readonly brief: EgoricBriefService,
    private readonly deliveries: NotificationDeliveryRegistry,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async tenant(tenantKey: string) {
    const tenant = await this.memory.findTenantByKey(tenantKey);
    if (!tenant) throw new ProactiveAlertError('tenant_not_found', 'tenant was not found', 404);
    return tenant;
  }

  async runCycle(tenantKey: string, input: {
    mode: ProactiveCycleMode;
    idempotencyKey: string;
    asOf?: string;
  }): Promise<ProactiveCycleOutput> {
    if (input.mode !== 'evaluate' && input.mode !== 'daily_brief') {
      throw new ProactiveAlertError('invalid_cycle_mode', 'proactive cycle mode is invalid', 400);
    }
    const tenant = await this.tenant(tenantKey);
    const evaluatedAt = exactIso(input.asOf, this.clock(), 'invalid_cycle_as_of');
    const idempotencyKey = key(input.idempotencyKey, 'invalid_cycle_idempotency_key');
    const brief = await this.brief.generate(tenantKey, evaluatedAt);
    const stored = await this.memory.findLatestSnapshotRunForTenant(tenant.id, evaluatedAt);
    if (!stored || stored.run.id !== brief.intelligence_run_id) {
      throw new ProactiveAlertError('proactive_provenance_mismatch', 'brief provenance does not match Business Memory');
    }
    const quality = evidenceQuality(brief);
    const request = {
      tenant_key: tenantKey,
      mode: input.mode,
      as_of: evaluatedAt,
      source_snapshot_id: stored.snapshot.id,
      intelligence_run_id: stored.run.id,
      policy_version: PROACTIVE_POLICY.version,
    };
    const cycleEvidence = {
      source_snapshot_hash: brief.source_snapshot_id,
      source_snapshot_id: stored.snapshot.id,
      intelligence_run_id: stored.run.id,
      freshness: brief.data_freshness,
      evidence_quality: quality,
      policy_version: PROACTIVE_POLICY.version,
    };
    return this.repository.withTransaction(async (repository) => {
      const runner = new ProactiveAlertService(repository, this.memory, this.brief, this.deliveries, this.clock);
      const created = await repository.createCycle({
        tenant_id: tenant.id,
        source_snapshot_id: stored.snapshot.id,
        intelligence_run_id: stored.run.id,
        policy_version: PROACTIVE_POLICY.version,
        mode: input.mode,
        idempotency_key: idempotencyKey,
        request_hash: proactiveHash(request),
        freshness_status: brief.data_freshness.status,
        evidence_quality: quality,
        evaluated_at: evaluatedAt,
        source_generated_at: brief.data_freshness.source_generated_at,
        source_received_at: brief.data_freshness.source_received_at,
        evidence_hash: proactiveHash(cycleEvidence),
      });
      if (!created.created) return runner.cycleOutput(tenant.id, created.cycle, true);

      for (const fact of ruleFacts(brief)) {
        await runner.evaluateRule(tenant.id, created.cycle, brief, quality, fact);
      }
      if (input.mode === 'daily_brief') await runner.stageDailyBrief(tenant.id, tenantKey, created.cycle);
      return runner.cycleOutput(tenant.id, created.cycle, false);
    });
  }

  private async cycleOutput(tenantId: string, cycle: ProactiveCycleRecord, replayed: boolean): Promise<ProactiveCycleOutput> {
    return {
      cycle,
      replayed,
      evaluations: await this.repository.listCycleEvaluations(tenantId, cycle.id),
      alerts: await this.repository.listCycleAlerts(tenantId, cycle.id),
      outbox: await this.repository.listCycleOutbox(tenantId, cycle.id),
    };
  }

  private async evaluateRule(
    tenantId: string,
    cycle: ProactiveCycleRecord,
    brief: EgoricCeoBrief,
    quality: ProactiveEvidenceQuality,
    fact: RuleFact,
  ): Promise<void> {
    const previous = await this.repository.latestEvaluation(tenantId, fact.id);
    const latestAlert = await this.repository.latestAlertForRule(tenantId, fact.id);
    const latestView = latestAlert
      ? await this.repository.alertView(tenantId, latestAlert.id, cycle.evaluated_at)
      : undefined;
    const currentSeverity = fact.value >= fact.threshold ? severity(fact) : null;
    const evidence = {
      rule_id: fact.id,
      metric_value: fact.value,
      previous_value: previous?.metric_value ?? null,
      threshold_value: fact.threshold,
      urgent_threshold: fact.urgentThreshold,
      freshness_status: brief.data_freshness.status,
      evidence_quality: quality,
      source_snapshot_hash: brief.source_snapshot_id,
      intelligence_run_id: brief.intelligence_run_id,
      policy_version: PROACTIVE_POLICY.version,
    };
    let status: ProactiveEvaluationStatus;

    if (brief.data_freshness.status !== 'fresh') {
      status = 'suppressed_stale';
    } else if (quality !== 'complete') {
      status = 'suppressed_partial';
    } else if (fact.value < fact.threshold) {
      const hadCondition = latestView !== undefined && latestView.state !== 'resolved';
      status = hadCondition ? 'resolved' : 'no_change';
      if (hadCondition) await this.resolveRuleAlerts(tenantId, fact.id, cycle);
    } else {
      const alertedMetric = latestAlert
        ? (JSON.parse(latestAlert.evidence_json) as { metric_value?: unknown }).metric_value
        : undefined;
      if (latestAlert && (!Number.isInteger(alertedMetric) || Number(alertedMetric) < 0)) {
        throw new ProactiveAlertError('corrupt_proactive_alert', 'alert metric evidence is invalid');
      }
      const meaningful = latestView === undefined
        || latestView.state === 'resolved'
        || fact.value > Number(alertedMetric);
      if (!meaningful) {
        status = 'no_change';
      } else {
        if (latestView?.state === 'snoozed') {
          status = 'suppressed_snooze';
        } else if (
          latestAlert
          && Date.parse(cycle.evaluated_at) - Date.parse(latestAlert.created_at) < PROACTIVE_POLICY.cooldownSeconds * 1_000
        ) {
          status = 'suppressed_cooldown';
        } else {
          status = 'triggered';
          await this.createAlert(
            tenantId,
            cycle,
            brief,
            fact,
            currentSeverity as ProactiveSeverity,
            latestAlert,
            latestView !== undefined && latestView.state !== 'resolved',
          );
        }
      }
    }

    await this.repository.addEvaluation({
      tenant_id: tenantId,
      cycle_id: cycle.id,
      rule_id: fact.id,
      status,
      severity: currentSeverity,
      metric_value: fact.value,
      previous_value: previous?.metric_value ?? null,
      threshold_value: fact.threshold,
      evidence_json: canonicalStringify(evidence),
      evidence_hash: proactiveHash(evidence),
    });
  }

  private async createAlert(
    tenantId: string,
    cycle: ProactiveCycleRecord,
    brief: EgoricCeoBrief,
    fact: RuleFact,
    alertSeverity: ProactiveSeverity,
    previousAlert: ProactiveAlertRecord | undefined,
    continuedEpisode: boolean,
  ): Promise<void> {
    const copy = RULE_COPY[fact.id];
    const episodeKey = continuedEpisode && previousAlert
      ? previousAlert.episode_key
      : proactiveHash({ tenant_id: tenantId, rule_id: fact.id, started_from_snapshot: cycle.source_snapshot_id });
    const alertEvidence = {
      rule_id: fact.id,
      metric_value: fact.value,
      threshold_value: fact.threshold,
      severity: alertSeverity,
      source_snapshot_hash: brief.source_snapshot_id,
      source_snapshot_id: cycle.source_snapshot_id,
      intelligence_run_id: cycle.intelligence_run_id,
      cycle_id: cycle.id,
      episode_key: episodeKey,
      policy_version: PROACTIVE_POLICY.version,
    };
    const alert = await this.repository.createAlert({
      tenant_id: tenantId,
      cycle_id: cycle.id,
      rule_id: fact.id,
      alert_key: proactiveHash({ episode_key: episodeKey, source_snapshot_id: cycle.source_snapshot_id, metric: fact.value }),
      episode_key: episodeKey,
      severity: alertSeverity,
      confidence: 'confirmed',
      title: copy.title,
      rationale: copy.rationale(fact.value),
      recommendation: copy.recommendation,
      source_snapshot_id: cycle.source_snapshot_id,
      intelligence_run_id: cycle.intelligence_run_id,
      evidence_json: canonicalStringify(alertEvidence),
      evidence_hash: proactiveHash(alertEvidence),
    });
    if (alert.created && alert.alert.severity === 'urgent') await this.stageUrgentAlert(tenantId, cycle, alert.alert);
  }

  private async resolveRuleAlerts(tenantId: string, ruleId: ProactiveRuleId, cycle: ProactiveCycleRecord): Promise<void> {
    const views = await this.repository.listAlertViews(tenantId, cycle.evaluated_at);
    for (const view of views.filter((row) => row.alert.rule_id === ruleId && row.state !== 'resolved')) {
      const resolutionEvidence = {
        alert_id: view.alert.id,
        rule_id: ruleId,
        source_snapshot_id: cycle.source_snapshot_id,
        cycle_id: cycle.id,
        policy_version: PROACTIVE_POLICY.version,
      };
      await this.repository.appendAlertEvent({
        tenant_id: tenantId,
        alert_id: view.alert.id,
        event_type: 'resolved',
        event_key: `resolve:${view.alert.id}:${cycle.source_snapshot_id}`,
        actor: `system:${PROACTIVE_POLICY.version}`,
        reason_code: 'condition_cleared',
        snoozed_until: null,
        evidence_hash: proactiveHash(resolutionEvidence),
      });
    }
  }

  private async stageUrgentAlert(tenantId: string, cycle: ProactiveCycleRecord, alert: ProactiveAlertRecord): Promise<void> {
    const payload = {
      kind: 'urgent_alert',
      alert_id: alert.id,
      severity: alert.severity,
      title: alert.title,
      rationale: alert.rationale,
      recommendation: alert.recommendation,
      evidence_hash: alert.evidence_hash,
      source_snapshot_id: alert.source_snapshot_id,
      policy_version: PROACTIVE_POLICY.version,
    };
    await this.repository.createOutbox({
      tenant_id: tenantId,
      cycle_id: cycle.id,
      alert_id: alert.id,
      delivery_kind: 'urgent_alert',
      logical_key: `urgent:${alert.alert_key}`,
      available_at: nextAvailableAt(cycle.evaluated_at),
      payload_json: canonicalStringify(payload),
      evidence_hash: proactiveHash(payload),
    });
  }

  private async stageDailyBrief(tenantId: string, tenantKey: string, cycle: ProactiveCycleRecord): Promise<void> {
    const alerts = await this.repository.listAlertViews(tenantId, cycle.evaluated_at);
    const active = alerts.filter((row) => row.state !== 'resolved');
    const payload = {
      kind: 'daily_brief',
      tenant_key: tenantKey,
      business_date_utc: cycle.evaluated_at.slice(0, 10),
      alert_count: active.length,
      urgent_count: active.filter((row) => row.alert.severity === 'urgent').length,
      alerts: active.slice(0, 10).map((row) => ({
        id: row.alert.id,
        severity: row.alert.severity,
        state: row.state,
        title: row.alert.title,
        evidence_hash: row.alert.evidence_hash,
      })),
      source_snapshot_id: cycle.source_snapshot_id,
      intelligence_run_id: cycle.intelligence_run_id,
      policy_version: PROACTIVE_POLICY.version,
    };
    await this.repository.createOutbox({
      tenant_id: tenantId,
      cycle_id: cycle.id,
      alert_id: null,
      delivery_kind: 'daily_brief',
      logical_key: `daily:${tenantId}:${cycle.evaluated_at.slice(0, 10)}`,
      available_at: nextAvailableAt(cycle.evaluated_at),
      payload_json: canonicalStringify(payload),
      evidence_hash: proactiveHash(payload),
    });
  }

  async listAlerts(tenantKey: string, state?: string): Promise<ProactiveAlertView[]> {
    const tenant = await this.tenant(tenantKey);
    const alerts = await this.repository.listAlertViews(tenant.id, this.clock().toISOString());
    if (state === undefined || state === 'all') return alerts;
    if (!['open', 'acknowledged', 'snoozed', 'resolved'].includes(state)) {
      throw new ProactiveAlertError('invalid_alert_state_filter', 'alert state filter is invalid', 400);
    }
    return alerts.filter((view) => view.state === state);
  }

  async acknowledge(tenantKey: string, input: {
    alertId: string;
    idempotencyKey: string;
    actor: string;
  }): Promise<{ event: ProactiveAlertEventRecord; replayed: boolean }> {
    const tenant = await this.tenant(tenantKey);
    const view = await this.repository.alertView(tenant.id, input.alertId, this.clock().toISOString());
    if (!view) throw new ProactiveAlertError('alert_not_found', 'alert was not found', 404);
    if (view.state === 'resolved') throw new ProactiveAlertError('alert_already_resolved', 'resolved alert cannot be acknowledged');
    const evidence = { alert_id: input.alertId, event_type: 'acknowledged', actor: actor(input.actor) };
    const result = await this.repository.appendAlertEvent({
      tenant_id: tenant.id,
      alert_id: input.alertId,
      event_type: 'acknowledged',
      event_key: `ack:${proactiveHash(key(input.idempotencyKey, 'invalid_alert_idempotency_key')).slice(7)}`,
      actor: evidence.actor,
      reason_code: 'founder_acknowledged',
      snoozed_until: null,
      evidence_hash: proactiveHash(evidence),
    });
    return { event: result.event, replayed: !result.created };
  }

  async snooze(tenantKey: string, input: {
    alertId: string;
    idempotencyKey: string;
    actor: string;
    until: string;
  }): Promise<{ event: ProactiveAlertEventRecord; replayed: boolean }> {
    const tenant = await this.tenant(tenantKey);
    const now = this.clock().toISOString();
    const view = await this.repository.alertView(tenant.id, input.alertId, now);
    if (!view) throw new ProactiveAlertError('alert_not_found', 'alert was not found', 404);
    if (view.state === 'resolved') throw new ProactiveAlertError('alert_already_resolved', 'resolved alert cannot be snoozed');
    const until = exactIso(input.until, this.clock(), 'invalid_snooze_until');
    const duration = Date.parse(until) - Date.parse(now);
    if (duration <= 0 || duration > PROACTIVE_POLICY.maxSnoozeSeconds * 1_000) {
      throw new ProactiveAlertError('invalid_snooze_window', 'snooze must be in the future and no longer than seven days', 400);
    }
    const evidence = { alert_id: input.alertId, event_type: 'snoozed', actor: actor(input.actor), until };
    const result = await this.repository.appendAlertEvent({
      tenant_id: tenant.id,
      alert_id: input.alertId,
      event_type: 'snoozed',
      event_key: `snooze:${proactiveHash(key(input.idempotencyKey, 'invalid_alert_idempotency_key')).slice(7)}`,
      actor: evidence.actor,
      reason_code: 'founder_snoozed',
      snoozed_until: until,
      evidence_hash: proactiveHash(evidence),
    });
    return { event: result.event, replayed: !result.created };
  }

  async recordOutcome(tenantKey: string, input: {
    alertId: string;
    idempotencyKey: string;
    actor: string;
    outcome: 'useful' | 'false_positive';
  }): Promise<{ event: ProactiveAlertEventRecord; replayed: boolean }> {
    if (input.outcome !== 'useful' && input.outcome !== 'false_positive') {
      throw new ProactiveAlertError('invalid_alert_outcome', 'alert outcome is invalid', 400);
    }
    const tenant = await this.tenant(tenantKey);
    const view = await this.repository.alertView(tenant.id, input.alertId, this.clock().toISOString());
    if (!view) throw new ProactiveAlertError('alert_not_found', 'alert was not found', 404);
    const eventKey = `outcome:${proactiveHash(key(input.idempotencyKey, 'invalid_alert_idempotency_key')).slice(7)}`;
    const existing = await this.repository.listAlertEvents(tenant.id, input.alertId);
    const existingOutcome = existing.find((event) =>
      event.event_type === 'rated_useful' || event.event_type === 'rated_false_positive');
    const eventType = input.outcome === 'useful' ? 'rated_useful' : 'rated_false_positive';
    if (existingOutcome && existingOutcome.event_type !== eventType) {
      throw new ProactiveAlertError('alert_outcome_conflict', 'alert already has a different immutable outcome');
    }
    if (existingOutcome) return { event: existingOutcome, replayed: true };
    const evidence = { alert_id: input.alertId, event_type: eventType, actor: actor(input.actor) };
    const result = await this.repository.appendAlertEvent({
      tenant_id: tenant.id,
      alert_id: input.alertId,
      event_type: eventType,
      event_key: eventKey,
      actor: evidence.actor,
      reason_code: input.outcome,
      snoozed_until: null,
      evidence_hash: proactiveHash(evidence),
    });
    return { event: result.event, replayed: !result.created };
  }

  async shadowBaseline(tenantKey: string, input: { from: string; to: string }): Promise<ProactiveShadowBaseline> {
    const tenant = await this.tenant(tenantKey);
    const from = exactIso(input.from, this.clock(), 'invalid_shadow_from');
    const to = exactIso(input.to, this.clock(), 'invalid_shadow_to');
    if (Date.parse(to) <= Date.parse(from)) throw new ProactiveAlertError('invalid_shadow_window', 'shadow window must end after it starts', 400);
    const days = Math.max(1, Math.ceil((Date.parse(to) - Date.parse(from)) / 86_400_000));
    const alerts = (await this.repository.listAlertViews(tenant.id, to))
      .filter((view) => Date.parse(view.alert.created_at) >= Date.parse(from) && Date.parse(view.alert.created_at) <= Date.parse(to));
    const deliveries = (await this.repository.listDeliveryViews(tenant.id))
      .filter((view) => Date.parse(view.outbox.created_at) >= Date.parse(from) && Date.parse(view.outbox.created_at) <= Date.parse(to));
    const reviewed = alerts.filter((view) => view.outcome !== null);
    return evaluateProactiveShadow({
      from,
      to,
      days,
      alert_count: alerts.length,
      alerts_per_day: alerts.length / days,
      reviewed_alert_count: reviewed.length,
      false_positive_count: reviewed.filter((view) => view.outcome === 'false_positive').length,
      false_positive_rate: null,
      delivered_count: deliveries.filter((view) => view.status === 'delivered').length,
      failed_delivery_count: deliveries.filter((view) => view.status === 'failed').length,
      unknown_delivery_count: deliveries.filter((view) => view.status === 'unknown').length,
    });
  }

  async listDeliveries(tenantKey: string): Promise<ProactiveDeliveryView[]> {
    const tenant = await this.tenant(tenantKey);
    return this.repository.listDeliveryViews(tenant.id);
  }

  async deliver(tenantKey: string, input: {
    outboxId: string;
    attemptKey: string;
  }): Promise<{ result: ProactiveDeliveryResultRecord; replayed: boolean }> {
    const tenant = await this.tenant(tenantKey);
    const now = this.clock().toISOString();
    const delivery = await this.repository.deliveryView(tenant.id, input.outboxId);
    if (!delivery) throw new ProactiveAlertError('delivery_not_found', 'delivery intent was not found', 404);
    if (Date.parse(delivery.outbox.available_at) > Date.parse(now)) {
      throw new ProactiveAlertError('delivery_quiet_hours', 'delivery is held until quiet hours end');
    }
    if (delivery.status === 'delivered' && delivery.latest_result) {
      return { result: delivery.latest_result, replayed: true };
    }
    if (delivery.status === 'unknown') {
      throw new ProactiveAlertError('delivery_outcome_unknown', 'delivery outcome is unknown; automatic retry is blocked');
    }
    const adapter = this.deliveries.get(delivery.outbox.delivery_kind);
    if (!adapter) throw new ProactiveAlertError('delivery_adapter_unavailable', 'delivery adapter is not registered', 503);
    const attemptKey = key(input.attemptKey, 'invalid_delivery_attempt_key');
    const attempt = await this.repository.startDeliveryAttempt({
      tenant_id: tenant.id,
      outbox_id: delivery.outbox.id,
      attempt_key: attemptKey,
      adapter_key: adapter.key,
      adapter_version: adapter.version,
      started_at: now,
    });
    if (!attempt.created) {
      const stored = await this.repository.resultForAttempt(tenant.id, attempt.attempt.id);
      if (!stored) throw new ProactiveAlertError('delivery_outcome_unknown', 'existing delivery attempt has no terminal result');
      return { result: stored, replayed: true };
    }

    const payload = JSON.parse(delivery.outbox.payload_json) as Record<string, unknown>;
    let status: 'delivered' | 'failed' | 'unknown';
    let receiptId: string | null = null;
    let failureCode: string | null = null;
    try {
      const response = await adapter.deliver({
        tenantKey,
        kind: delivery.outbox.delivery_kind,
        logicalNotificationKey: delivery.outbox.logical_key,
        payload,
      });
      if (response.status === 'delivered') {
        if (typeof response.receiptId !== 'string' || response.receiptId.length < 1 || response.receiptId.length > 256) {
          throw new Error('invalid adapter receipt');
        }
        status = 'delivered';
        receiptId = response.receiptId;
      } else {
        status = 'failed';
        failureCode = code(response.failureCode);
      }
    } catch {
      status = 'unknown';
      failureCode = 'adapter_outcome_unknown';
    }
    const resultEvidence = {
      outbox_id: delivery.outbox.id,
      attempt_id: attempt.attempt.id,
      logical_key: delivery.outbox.logical_key,
      adapter_key: adapter.key,
      adapter_version: adapter.version,
      status,
      receipt_id: receiptId,
      failure_code: failureCode,
    };
    const result = await this.repository.recordDeliveryResult({
      tenant_id: tenant.id,
      attempt_id: attempt.attempt.id,
      status,
      receipt_id: receiptId,
      failure_code: failureCode,
      completed_at: this.clock().toISOString(),
      evidence_hash: proactiveHash(resultEvidence),
    });
    return { result: result.result, replayed: false };
  }
}
