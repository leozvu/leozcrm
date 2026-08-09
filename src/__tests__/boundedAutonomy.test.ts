import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import {
  BoundedAutonomyError,
  G7_TABLES,
  autonomyFingerprint,
} from '../domain/boundedAutonomy';
import { validateG7Policy } from '../domain/g7Policy';
import { actionFingerprint } from '../domain/supervisedAction';
import { buildActionAdapterRegistry } from '../integrations/actions/buildActionAdapterRegistry';
import { ActionAdapterRegistry } from '../integrations/actions/actionAdapterRegistry';
import { BoundedAutonomyRepository } from '../repositories/boundedAutonomyRepository';
import { BoundedAutonomyService } from '../services/boundedAutonomyService';
import {
  G7_EXECUTOR_CREDENTIAL,
  G7_KILL_SWITCH_CREDENTIAL,
  G7_RELEASE_CREDENTIAL,
  autonomyCandidate,
  createBoundedAutonomyScenario,
} from './support/boundedAutonomyScenario';

const db = knexFactory(config.test);

before(async () => {
  await db.migrate.latest();
});

after(async () => {
  await db.destroy();
});

function hasCode(code: string) {
  return (error: unknown) => error instanceof BoundedAutonomyError && error.code === code;
}

test('production composition remains empty and G7 policy is exact, low-risk, and credential-separated', async () => {
  assert.equal(buildActionAdapterRegistry().size(), 0);
  const scenario = await createBoundedAutonomyScenario(db, 'policy-contract');
  const valid = validateG7Policy(scenario.policy, scenario.supervised.policy);
  assert.equal(valid.ok, true);
  assert.match(valid.fingerprint!, /^sha256:[0-9a-f]{64}$/);

  const extra = structuredClone(scenario.policy) as any;
  extra.scope = '*';
  assert.match(validateG7Policy(extra, scenario.supervised.policy).issues.join('\n'), /scope is not allowed/);

  const shared = structuredClone(scenario.policy);
  shared.identities.executor_credential_sha256 = shared.identities.release_credential_sha256;
  assert.match(validateG7Policy(shared, scenario.supervised.policy).issues.join('\n'), /must be different/);

  const mediumG6 = structuredClone(scenario.supervised.policy);
  mediumG6.command.risk_tier = 'medium';
  assert.match(validateG7Policy(scenario.policy, mediumG6).issues.join('\n'), /requires a low-risk/);
});

test('canonical simulator covers every safety branch and persists immutable exact evidence', async () => {
  const scenario = await createBoundedAutonomyScenario(db, 'simulator');
  assert.equal(scenario.simulation.result.passed, true);
  assert.equal(scenario.simulation.result.outcomes.length, 13);
  assert.equal(scenario.simulation.result.outcomes.every((outcome) => outcome.passed), true);
  assert.deepEqual(
    scenario.simulation.result.outcomes.map((outcome) => outcome.scenario),
    [
      'happy_path', 'g5_revoked', 'g6_expired', 'history_unqualified',
      'kill_switch_engaged', 'source_stale', 'incident_open',
      'hourly_exhausted', 'daily_exhausted', 'cooldown_active',
      'action_cost_exceeded', 'daily_cost_exceeded', 'dry_run_mutated',
    ],
  );
  await assert.rejects(
    db(G7_TABLES.simulations).where({ id: scenario.simulation.record.id }).update({ passed: false }),
    /immutable/,
  );
});

test('policy acceptance requires real qualifying G6 history and the initial kill switch is engaged', async () => {
  const unqualified = await createBoundedAutonomyScenario(db, 'unqualified', { qualifyHistory: false });
  await assert.rejects(
    unqualified.service.acceptPolicy(unqualified.policy, G7_RELEASE_CREDENTIAL),
    hasCode('supervised_history_not_qualified'),
  );
  assert.equal(await db(G7_TABLES.policies).where({ policy_id: unqualified.policy.policy_id }).count({ c: '*' }).first().then((row) => Number(row?.c)), 0);

  const engaged = await createBoundedAutonomyScenario(db, 'initial-engaged', { releaseKillSwitch: false });
  assert.equal((await engaged.repository.latestKillSwitch(engaged.policyRecord!.id)).state, 'engaged');
  const result = await engaged.service.runCandidate(autonomyCandidate(engaged.policy.policy_id, 'engaged00000001'));
  assert.equal(result.evaluation.decision, 'deny');
  assert.equal(result.evaluation.decision_code, 'kill_switch_engaged');
  assert.equal(engaged.supervised.adapter.executeCalls, 5);
});

test('kill-switch release requires two distinct credentials and manual engagement ignores broken prerequisites', async () => {
  const scenario = await createBoundedAutonomyScenario(db, 'kill-auth', { releaseKillSwitch: false });
  await assert.rejects(
    scenario.service.releaseKillSwitch({
      policyId: scenario.policy.policy_id,
      actor: 'Leoz',
      releaseCredential: G7_RELEASE_CREDENTIAL,
      killSwitchCredential: 'wrong-kill-switch-credential',
      reasonCode: 'ceo_released_bounded_rehearsal',
    }),
    hasCode('kill_switch_credential_rejected'),
  );
  const released = await scenario.service.releaseKillSwitch({
    policyId: scenario.policy.policy_id,
    actor: 'Leoz',
    releaseCredential: G7_RELEASE_CREDENTIAL,
    killSwitchCredential: G7_KILL_SWITCH_CREDENTIAL,
    reasonCode: 'ceo_released_bounded_rehearsal',
  });
  assert.equal(released.state, 'released');

  const revokeCore = {
    tenant_id: scenario.supervised.seeded.tenant.id,
    source_connection_id: scenario.supervised.seeded.connection.id,
    authorization_id: `P2-g7-kill-auth`,
    decision: 'revoke' as const,
    decided_by: 'Leoz',
    decided_at: '2026-08-17T14:01:00.000Z',
    evaluation_fingerprint: actionFingerprint({ verdict: 'revoked' }),
    reason_code: 'g5_revoked_for_kill_drill',
    extend_until_business_date: null,
  };
  await scenario.supervised.shadow.recordReleaseDecision({ ...revokeCore, evidence_key: actionFingerprint(revokeCore) });
  scenario.supervised.clock.now = new Date('2026-08-17T14:02:00.000Z');
  const engaged = await scenario.service.engageKillSwitch({
    policyId: scenario.policy.policy_id,
    actor: 'Leoz',
    killSwitchCredential: G7_KILL_SWITCH_CREDENTIAL,
    reasonCode: 'manual_emergency_stop',
  });
  assert.equal(engaged.state, 'engaged');
});

test('one bounded candidate dry-runs, executes once, and replays without another adapter call', async () => {
  const scenario = await createBoundedAutonomyScenario(db, 'execute-once');
  const baselinePreview = scenario.supervised.adapter.previewCalls;
  const baselineExecute = scenario.supervised.adapter.executeCalls;
  const candidate = autonomyCandidate(scenario.policy.policy_id, 'executeonce0001');
  const first = await scenario.service.runCandidate(candidate);
  assert.equal(first.evaluation.decision, 'allow');
  assert.equal(first.attempt?.status, 'succeeded');
  assert.equal(first.attempt?.external_mutation_count, 1);
  assert.equal(first.replayed, false);
  assert.equal(scenario.supervised.adapter.previewCalls, baselinePreview + 1);
  assert.equal(scenario.supervised.adapter.executeCalls, baselineExecute + 1);

  const replay = await scenario.service.runCandidate(candidate);
  assert.equal(replay.replayed, true);
  assert.equal(replay.attempt?.id, first.attempt?.id);
  assert.equal(scenario.supervised.adapter.previewCalls, baselinePreview + 1);
  assert.equal(scenario.supervised.adapter.executeCalls, baselineExecute + 1);
});

test('G5 revoke and stale source deny before dry-run or command execution', async () => {
  const revoked = await createBoundedAutonomyScenario(db, 'g5-deny');
  const previewBefore = revoked.supervised.adapter.previewCalls;
  const executeBefore = revoked.supervised.adapter.executeCalls;
  const revokeCore = {
    tenant_id: revoked.supervised.seeded.tenant.id,
    source_connection_id: revoked.supervised.seeded.connection.id,
    authorization_id: 'P2-g7-g5-deny',
    decision: 'revoke' as const,
    decided_by: 'Leoz',
    decided_at: '2026-08-17T14:01:00.000Z',
    evaluation_fingerprint: actionFingerprint({ verdict: 'revoke_g7' }),
    reason_code: 'g5_revoked_before_autonomy',
    extend_until_business_date: null,
  };
  await revoked.supervised.shadow.recordReleaseDecision({ ...revokeCore, evidence_key: actionFingerprint(revokeCore) });
  revoked.supervised.clock.now = new Date('2026-08-17T14:02:00.000Z');
  const denied = await revoked.service.runCandidate(autonomyCandidate(revoked.policy.policy_id, 'revoked000000001'));
  assert.equal(denied.evaluation.decision_code, 'g5_not_current_go');
  assert.equal(revoked.supervised.adapter.previewCalls, previewBefore);
  assert.equal(revoked.supervised.adapter.executeCalls, executeBefore);

  const stale = await createBoundedAutonomyScenario(db, 'stale-source');
  const stalePreview = stale.supervised.adapter.previewCalls;
  stale.supervised.clock.now = new Date('2026-08-17T14:20:01.000Z');
  const staleResult = await stale.service.runCandidate(autonomyCandidate(stale.policy.policy_id, 'stalesource00001'));
  assert.equal(staleResult.evaluation.decision_code, 'source_snapshot_stale');
  assert.equal(stale.supervised.adapter.previewCalls, stalePreview);
});

test('cooldown and rolling rate/cost limits deny atomically without a second execution', async () => {
  const cooldown = await createBoundedAutonomyScenario(db, 'cooldown-limit');
  const first = await cooldown.service.runCandidate(autonomyCandidate(cooldown.policy.policy_id, 'cooldown0000001'));
  assert.equal(first.attempt?.status, 'succeeded');
  const executeAfterFirst = cooldown.supervised.adapter.executeCalls;
  cooldown.supervised.clock.now = new Date('2026-08-17T14:00:30.000Z');
  const denied = await cooldown.service.runCandidate(autonomyCandidate(cooldown.policy.policy_id, 'cooldown0000002'));
  assert.equal(denied.evaluation.decision_code, 'cooldown_active');
  assert.equal(cooldown.supervised.adapter.executeCalls, executeAfterFirst);

  const hourly = await createBoundedAutonomyScenario(db, 'hourly-g7', { maxPerHour: 1, cooldownSeconds: 60 });
  await hourly.service.runCandidate(autonomyCandidate(hourly.policy.policy_id, 'hourly000000001'));
  hourly.supervised.clock.now = new Date('2026-08-17T14:01:01.000Z');
  const hourlyDenied = await hourly.service.runCandidate(autonomyCandidate(hourly.policy.policy_id, 'hourly000000002'));
  assert.equal(hourlyDenied.evaluation.decision_code, 'hourly_limit_exhausted');

  const budget = await createBoundedAutonomyScenario(db, 'budget-g7', { maxDailyCost: 25 });
  await budget.service.runCandidate(autonomyCandidate(budget.policy.policy_id, 'budget000000001'));
  budget.supervised.clock.now = new Date('2026-08-17T14:01:01.000Z');
  const budgetDenied = await budget.service.runCandidate(autonomyCandidate(budget.policy.policy_id, 'budget000000002'));
  assert.equal(budgetDenied.evaluation.decision_code, 'daily_cost_exceeds_limit');
});

test('unknown adapter outcome becomes reconciliation-required, opens incident, engages kill switch, and never retries', async () => {
  const scenario = await createBoundedAutonomyScenario(db, 'adapter-uncertain');
  const baseline = scenario.supervised.adapter.executeCalls;
  scenario.supervised.adapter.throwOnExecute = true;
  const candidate = autonomyCandidate(scenario.policy.policy_id, 'unknown00000001');
  const result = await scenario.service.runCandidate(candidate);
  assert.equal(result.attempt?.status, 'reconciliation_required');
  assert.equal((await scenario.repository.latestKillSwitch(scenario.policyRecord!.id)).state, 'engaged');
  assert.equal((await scenario.repository.listOpenIncidents(scenario.policyRecord!.id)).length, 1);
  assert.equal(scenario.supervised.adapter.executeCalls, baseline + 1);

  const replay = await scenario.service.runCandidate(candidate);
  assert.equal(replay.replayed, true);
  assert.equal(scenario.supervised.adapter.executeCalls, baseline + 1);
  const blocked = await scenario.service.runCandidate(autonomyCandidate(scenario.policy.policy_id, 'unknown00000002'));
  assert.equal(blocked.evaluation.decision_code, 'kill_switch_engaged');
  assert.equal(scenario.supervised.adapter.executeCalls, baseline + 1);
});

test('incident resolution is separately authenticated and does not silently release the kill switch', async () => {
  const scenario = await createBoundedAutonomyScenario(db, 'incident-recovery');
  scenario.supervised.adapter.throwOnExecute = true;
  await scenario.service.runCandidate(autonomyCandidate(scenario.policy.policy_id, 'incident0000001'));
  const [incident] = await scenario.repository.listOpenIncidents(scenario.policyRecord!.id);
  await assert.rejects(
    scenario.service.resolveIncident({
      policyId: scenario.policy.policy_id,
      incidentId: incident.incident_id,
      actor: 'Leoz',
      releaseCredential: G7_RELEASE_CREDENTIAL,
      killSwitchCredential: 'wrong-kill-switch',
      reasonCode: 'manual_reconciliation_complete',
      evidenceRefs: ['incident.command_log'],
    }),
    hasCode('kill_switch_credential_rejected'),
  );
  await scenario.service.resolveIncident({
    policyId: scenario.policy.policy_id,
    incidentId: incident.incident_id,
    actor: 'Leoz',
    releaseCredential: G7_RELEASE_CREDENTIAL,
    killSwitchCredential: G7_KILL_SWITCH_CREDENTIAL,
    reasonCode: 'manual_reconciliation_complete',
    evidenceRefs: ['incident.command_log'],
  });
  assert.equal((await scenario.repository.listOpenIncidents(scenario.policyRecord!.id)).length, 0);
  assert.equal((await scenario.repository.latestKillSwitch(scenario.policyRecord!.id)).state, 'engaged');
  scenario.supervised.adapter.throwOnExecute = false;
  const released = await scenario.service.releaseKillSwitch({
    policyId: scenario.policy.policy_id,
    actor: 'Leoz',
    releaseCredential: G7_RELEASE_CREDENTIAL,
    killSwitchCredential: G7_KILL_SWITCH_CREDENTIAL,
    reasonCode: 'ceo_released_after_reconciliation',
  });
  assert.equal(released.state, 'released');
});

test('database guards reject policy, evaluation, event, incident, and terminal-attempt rewrites', async () => {
  const scenario = await createBoundedAutonomyScenario(db, 'db-guards');
  const result = await scenario.service.runCandidate(autonomyCandidate(scenario.policy.policy_id, 'dbguards00000001'));
  const event = (await scenario.repository.listEvents(scenario.policyRecord!.id))[0];
  for (const mutation of [
    db(G7_TABLES.policies).where({ id: scenario.policyRecord!.id }).update({ command_key: 'rewritten' }),
    db(G7_TABLES.evaluations).where({ id: result.evaluation.id }).delete(),
    db(G7_TABLES.events).where({ id: event.id }).update({ reason_code: 'rewritten' }),
    db(G7_TABLES.attempts).where({ id: result.attempt!.id }).update({ result_code: 'rewritten' }),
    db(G7_TABLES.attempts).where({ id: result.attempt!.id }).delete(),
  ]) await assert.rejects(mutation, /immutable|guarded terminal transition|not deletable/);
});

test('raw release, executor, kill-switch, and command credentials are never persisted', async () => {
  const scenario = await createBoundedAutonomyScenario(db, 'secret-absence');
  await scenario.service.runCandidate(autonomyCandidate(scenario.policy.policy_id, 'secrets000000001'));
  const rows = await Promise.all(Object.values(G7_TABLES).map((table) => db(table).select('*')));
  const persisted = JSON.stringify(rows);
  for (const secret of [
    G7_RELEASE_CREDENTIAL,
    G7_EXECUTOR_CREDENTIAL,
    G7_KILL_SWITCH_CREDENTIAL,
    'test-command-credential-0003',
  ]) assert.doesNotMatch(persisted, new RegExp(secret));
});

test('an expired claimed lease is sealed with incident evidence and cannot call the adapter', async () => {
  const scenario = await createBoundedAutonomyScenario(db, 'expired-lease');
  const context = await scenario.repository.findPolicy(scenario.policy.policy_id);
  const at = '2026-08-17T14:00:00.000Z';
  const payloadJson = JSON.stringify({ lead_id: 'lease_manual_1', status_code: 'contacted' });
  const requestFingerprint = actionFingerprint({ request: 'manual_expired_lease' });
  const evaluationCore = {
    tenant_id: context.record.tenant_id,
    source_connection_id: context.record.source_connection_id,
    policy_record_id: context.record.id,
    idempotency_key: 'autonomy:expired-lease:manual:0001',
    payload_json: payloadJson,
    payload_fingerprint: actionFingerprint(payloadJson),
    reason_code: 'bounded_priority_follow_up',
    evidence_refs_json: JSON.stringify(['brief.current']),
    request_fingerprint: requestFingerprint,
    target_fingerprint: context.record.target_fingerprint,
    preview_fingerprint: actionFingerprint({ preview: 'manual' }),
    effect_fingerprint: actionFingerprint({ effect: 'manual' }),
    summary_code: 'lead_status_will_change',
    rollback_strategy_code: 'restore_previous_status',
    estimated_cost_minor: 25,
    currency: 'USD',
    preview_mutation_count: 0,
    decision: 'allow' as const,
    decision_code: 'bounded_candidate_allowed',
    evaluated_at: at,
  };
  const evaluation = await scenario.repository.recordEvaluation({
    ...evaluationCore,
    evaluation_fingerprint: autonomyFingerprint(evaluationCore),
  }, 'Leoz');
  const claimed = await scenario.repository.claimAttempt({
    tenant_id: context.record.tenant_id,
    policy_record_id: context.record.id,
    evaluation_id: evaluation.id,
    idempotency_key: evaluation.idempotency_key,
    request_fingerprint: requestFingerprint,
    executor: 'Leoz',
    reserved_cost_minor: 25,
    currency: 'USD',
    started_at: at,
    lease_expires_at: '2026-08-17T14:01:00.000Z',
  }, {
    g5ReleaseDecisionId: context.record.g5_release_decision_id,
    g6PolicyRecordId: context.g6.record.id,
    g6PolicyFingerprint: context.g6.record.policy_fingerprint,
    simulationId: context.simulation.id,
    historyWindowDays: context.manifest.history.window_days,
    minSuccessfulExecutions: context.manifest.history.min_successful_executions,
    maxSourceAgeMinutes: context.manifest.limits.max_source_age_minutes,
    maxPerHour: context.manifest.limits.max_executions_per_hour,
    maxPerDay: context.manifest.limits.max_executions_per_day,
    maxCostPerDay: context.manifest.limits.max_cost_minor_per_day,
    cooldownSeconds: context.manifest.limits.cooldown_seconds,
  });
  assert.equal(claimed.attempt.status, 'in_progress');
  const executeBefore = scenario.supervised.adapter.executeCalls;
  scenario.supervised.clock.now = new Date('2026-08-17T14:01:01.000Z');
  const adapterlessReconciler = new BoundedAutonomyService(
    scenario.repository,
    buildActionAdapterRegistry(),
    () => new Date(scenario.supervised.clock.now),
  );
  const reconciled = await adapterlessReconciler.reconcileExpiredAttempt({
    policyId: scenario.policy.policy_id,
    evaluationId: evaluation.id,
    actor: 'Leoz',
    executorCredential: G7_EXECUTOR_CREDENTIAL,
  });
  assert.equal(reconciled.status, 'reconciliation_required');
  assert.equal(reconciled.result_code, 'expired_autonomy_lease');
  assert.equal(scenario.supervised.adapter.executeCalls, executeBefore);
});

test('human recovery requires kill switch, fresh preview, separate approval, and stays available after G5 revoke', async () => {
  const scenario = await createBoundedAutonomyScenario(db, 'human-recovery');
  const action = await scenario.service.runCandidate(autonomyCandidate(scenario.policy.policy_id, 'recovery00000001'));
  assert.equal(action.attempt?.status, 'succeeded');
  const revokeCore = {
    tenant_id: scenario.supervised.seeded.tenant.id,
    source_connection_id: scenario.supervised.seeded.connection.id,
    authorization_id: 'P2-g7-human-recovery',
    decision: 'revoke' as const,
    decided_by: 'Leoz',
    decided_at: '2026-08-17T14:01:00.000Z',
    evaluation_fingerprint: actionFingerprint({ verdict: 'revoke_for_recovery' }),
    reason_code: 'g5_revoked_for_human_recovery',
    extend_until_business_date: null,
  };
  await scenario.supervised.shadow.recordReleaseDecision({ ...revokeCore, evidence_key: actionFingerprint(revokeCore) });
  scenario.supervised.clock.now = new Date('2026-08-17T14:02:00.000Z');
  await assert.rejects(
    scenario.service.previewRecovery({
      policyId: scenario.policy.policy_id,
      subjectAttemptId: action.attempt!.id,
      actor: 'Leoz',
      executorCredential: G7_EXECUTOR_CREDENTIAL,
    }),
    hasCode('kill_switch_must_be_engaged'),
  );
  await scenario.service.engageKillSwitch({
    policyId: scenario.policy.policy_id,
    actor: 'Leoz',
    killSwitchCredential: G7_KILL_SWITCH_CREDENTIAL,
    reasonCode: 'prepare_human_recovery',
  });
  const preview = await scenario.service.previewRecovery({
    policyId: scenario.policy.policy_id,
    subjectAttemptId: action.attempt!.id,
    actor: 'Leoz',
    executorCredential: G7_EXECUTOR_CREDENTIAL,
  });
  assert.equal(preview.external_mutation_count, 0);
  await assert.rejects(
    scenario.service.recover({
      policyId: scenario.policy.policy_id,
      subjectAttemptId: action.attempt!.id,
      actor: 'Leoz',
      executorCredential: G7_EXECUTOR_CREDENTIAL,
    }),
    hasCode('missing_recovery_approval'),
  );
  const approval = await scenario.service.decideRecovery({
    policyId: scenario.policy.policy_id,
    subjectAttemptId: action.attempt!.id,
    decision: 'approved',
    actor: 'Leoz',
    releaseCredential: G7_RELEASE_CREDENTIAL,
    killSwitchCredential: G7_KILL_SWITCH_CREDENTIAL,
    reasonCode: 'ceo_approved_human_recovery',
    nonce: 'approval:g7-human-recovery:0001',
    maxCostMinor: preview.estimated_cost_minor,
  });
  assert.equal(approval.decision, 'approved');
  const recovered = await scenario.service.recover({
    policyId: scenario.policy.policy_id,
    subjectAttemptId: action.attempt!.id,
    actor: 'Leoz',
    executorCredential: G7_EXECUTOR_CREDENTIAL,
  });
  assert.equal(recovered.attempt.kind, 'recovery');
  assert.equal(recovered.attempt.status, 'succeeded');
  assert.equal(scenario.supervised.adapter.recoveryCalls, 1);
  const replay = await scenario.service.recover({
    policyId: scenario.policy.policy_id,
    subjectAttemptId: action.attempt!.id,
    actor: 'Leoz',
    executorCredential: G7_EXECUTOR_CREDENTIAL,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.attempt.id, recovered.attempt.id);
  assert.equal(scenario.supervised.adapter.recoveryCalls, 1);
  assert.equal((await scenario.repository.latestKillSwitch(scenario.policyRecord!.id)).state, 'engaged');
  await assert.rejects(
    db(G7_TABLES.recoveryPreviews).where({ id: preview.id }).update({ summary_code: 'rewritten' }),
    /immutable/,
  );
  await assert.rejects(
    db(G7_TABLES.recoveryApprovals).where({ id: approval.id }).delete(),
    /immutable/,
  );
});
