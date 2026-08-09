import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import { validateG6ActionPolicy } from '../domain/g6Policy';
import { G6_TABLES, SupervisedActionError, actionFingerprint } from '../domain/supervisedAction';
import { buildActionAdapterRegistry } from '../integrations/actions/buildActionAdapterRegistry';
import {
  APPROVAL_CREDENTIAL,
  COMMAND_CREDENTIAL,
  OPERATOR_CREDENTIAL,
  createSupervisedActionScenario,
  proposePreviewApprove,
} from './support/supervisedActionScenario';

const db = knexFactory(config.test);

before(async () => {
  await db.migrate.latest();
});

after(async () => {
  await db.destroy();
});

function hasCode(code: string) {
  return (error: unknown) => error instanceof SupervisedActionError && error.code === code;
}

test('checked-in operator composition has no real command adapter', () => {
  const registry = buildActionAdapterRegistry();
  assert.equal(registry.size(), 0);
  assert.throws(
    () => registry.resolve({
      environment: 'production',
      commandKey: 'egoric.lead.set_status.v1',
      commandVersion: 'v1',
      adapterId: 'unreleased-adapter',
    }),
    hasCode('action_adapter_not_registered'),
  );
});

test('G6 policy is exact, G5-bound, pending-intolerant, and requires separate credentials', async () => {
  const scenario = await createSupervisedActionScenario(db, 'policy-contract');
  const valid = validateG6ActionPolicy(scenario.policy, scenario.g5);
  assert.equal(valid.ok, true);
  assert.match(valid.fingerprint!, /^sha256:[0-9a-f]{64}$/);

  const pending = structuredClone(scenario.policy) as any;
  pending.status = 'pending';
  pending.verdict = 'pending';
  assert.equal(validateG6ActionPolicy(pending, scenario.g5).ok, false);

  const extra = structuredClone(scenario.policy) as any;
  extra.command.wildcard = '*';
  assert.match(validateG6ActionPolicy(extra, scenario.g5).issues.join('\n'), /wildcard is not allowed/);

  const sharedCredential = structuredClone(scenario.policy);
  sharedCredential.identities.operator_credential_sha256 =
    sharedCredential.identities.approval_credential_sha256;
  assert.match(
    validateG6ActionPolicy(sharedCredential, scenario.g5).issues.join('\n'),
    /must be different/,
  );

  const wrongG5 = { ...scenario.g5, evidence_key: actionFingerprint('wrong') };
  assert.match(validateG6ActionPolicy(scenario.policy, wrongG5).issues.join('\n'), /does not match/);

  const credentialEndpoint = structuredClone(scenario.policy);
  credentialEndpoint.target.command_endpoint_url =
    'https://user:password@test-actions.example/api/integrations/leozops/v1/commands/set-lead-status';
  assert.match(
    validateG6ActionPolicy(credentialEndpoint, scenario.g5).issues.join('\n'),
    /credential-free dedicated HTTPS command URL/,
  );
});

test('proposal rejects sensitive payload fields and command-schema drift before persistence', async () => {
  const scenario = await createSupervisedActionScenario(db, 'payload-safety');
  const base = {
    policyId: scenario.policy.policy_id,
    reasonCode: 'follow_up_priority_lead',
    expectedImpactCode: 'advance_qualified_lead',
    evidenceRefs: ['brief.current'],
    estimatedCostMinor: 25,
    currency: 'USD',
    idempotencyKey: 'action:payload-safety:0001',
    requestedBy: 'Leoz',
    expiresAt: '2026-08-17T15:00:00.000Z',
  };
  await assert.rejects(
    scenario.service.propose({ ...base, payload: { lead_id: 'lead_1', status_code: 'contacted', email: 'x@y.z' } }),
    hasCode('unsafe_action_payload'),
  );
  await assert.rejects(
    scenario.service.propose({
      ...base,
      idempotencyKey: 'action:payload-safety:0002',
      payload: { lead_id: 'lead_1', status_code: 'contacted', unexpected_field: 'x' },
    }),
    hasCode('action_payload_schema_invalid'),
  );
  assert.equal(await db(G6_TABLES.proposals).where({ tenant_id: scenario.seeded.tenant.id }).count({ c: '*' }).first().then((r) => Number(r?.c)), 0);
});

test('dry-run must match the exact command request and records zero immutable mutations', async () => {
  const scenario = await createSupervisedActionScenario(db, 'preview-binding');
  const proposal = await scenario.service.propose({
    policyId: scenario.policy.policy_id,
    payload: { lead_id: 'lead_preview_0001', status_code: 'contacted' },
    reasonCode: 'follow_up_priority_lead',
    expectedImpactCode: 'advance_qualified_lead',
    evidenceRefs: ['brief.current'],
    estimatedCostMinor: 25,
    currency: 'USD',
    idempotencyKey: 'action:preview-binding:0001',
    requestedBy: 'Leoz',
    expiresAt: '2026-08-17T15:00:00.000Z',
  });
  scenario.adapter.mismatchPreview = true;
  await assert.rejects(
    scenario.service.preview({
      proposalId: proposal.id,
      operator: 'Leoz',
      operatorCredential: OPERATOR_CREDENTIAL,
    }),
    hasCode('preview_fingerprint_mismatch'),
  );
  assert.equal(await db(G6_TABLES.previews).where({ proposal_id: proposal.id }).count({ c: '*' }).first().then((r) => Number(r?.c)), 0);
  scenario.adapter.mismatchPreview = false;
  const preview = await scenario.service.preview({
    proposalId: proposal.id,
    operator: 'Leoz',
    operatorCredential: OPERATOR_CREDENTIAL,
  });
  assert.equal(preview.external_mutation_count, 0);
  await assert.rejects(
    db(G6_TABLES.previews).where({ id: preview.id }).update({ summary_code: 'tampered' }),
    /immutable/,
  );
});

test('approval is separately authenticated, immutable, and a rejection cannot execute', async () => {
  const scenario = await createSupervisedActionScenario(db, 'approval-contract');
  const { proposal } = await proposePreviewApprove(scenario, 'approvalgood00001');
  const approval = await scenario.repository.findApproval(
    (await scenario.repository.findPreview(proposal.id, 'execute')).id,
  );
  assert.equal(approval.decision, 'approved');
  await assert.rejects(
    db(G6_TABLES.approvals).where({ id: approval.id }).delete(),
    /immutable/,
  );

  const rejectedScenario = await createSupervisedActionScenario(db, 'approval-reject');
  const proposed = await rejectedScenario.service.propose({
    policyId: rejectedScenario.policy.policy_id,
    payload: { lead_id: 'lead_reject_0001', status_code: 'contacted' },
    reasonCode: 'follow_up_priority_lead',
    expectedImpactCode: 'advance_qualified_lead',
    evidenceRefs: ['brief.current'],
    estimatedCostMinor: 25,
    currency: 'USD',
    idempotencyKey: 'action:approval-reject:0001',
    requestedBy: 'Leoz',
    expiresAt: '2026-08-17T15:00:00.000Z',
  });
  await rejectedScenario.service.preview({
    proposalId: proposed.id,
    operator: 'Leoz',
    operatorCredential: OPERATOR_CREDENTIAL,
  });
  await assert.rejects(
    rejectedScenario.service.decide({
      proposalId: proposed.id,
      kind: 'execute',
      decision: 'approved',
      approver: 'Leoz',
      approvalCredential: 'wrong-approval-credential-0000',
      reasonCode: 'ceo_approved_execution',
      nonce: 'approval:wrong-credential:0001',
      maxCostMinor: 25,
    }),
    hasCode('approval_auth_failed'),
  );
  await rejectedScenario.service.decide({
    proposalId: proposed.id,
    kind: 'execute',
    decision: 'rejected',
    approver: 'Leoz',
    approvalCredential: APPROVAL_CREDENTIAL,
    reasonCode: 'ceo_rejected_execution',
    nonce: 'approval:rejected:000000001',
    maxCostMinor: 25,
  });
  await assert.rejects(
    rejectedScenario.service.execute({
      proposalId: proposed.id,
      operator: 'Leoz',
      operatorCredential: OPERATOR_CREDENTIAL,
    }),
    hasCode('approval_binding_mismatch'),
  );
  assert.equal(rejectedScenario.adapter.executeCalls, 0);
});

test('execution is explicit and idempotent; replay returns evidence without a second adapter call', async () => {
  const scenario = await createSupervisedActionScenario(db, 'execute-once');
  const { proposal } = await proposePreviewApprove(scenario, 'executeonce00001');
  const first = await scenario.service.execute({
    proposalId: proposal.id,
    operator: 'Leoz',
    operatorCredential: OPERATOR_CREDENTIAL,
  });
  assert.equal(first.attempt.status, 'succeeded');
  assert.equal(first.attempt.external_mutation_count, 1);
  assert.equal(first.replayed, false);

  const replay = await scenario.service.execute({
    proposalId: proposal.id,
    operator: 'Leoz',
    operatorCredential: OPERATOR_CREDENTIAL,
  });
  assert.equal(replay.attempt.id, first.attempt.id);
  assert.equal(replay.replayed, true);
  assert.equal(scenario.adapter.executeCalls, 1);
  const persisted = await Promise.all(Object.values(G6_TABLES).map((table) => db(table).select('*')));
  assert.doesNotMatch(JSON.stringify(persisted), new RegExp(APPROVAL_CREDENTIAL));
  assert.doesNotMatch(JSON.stringify(persisted), new RegExp(OPERATOR_CREDENTIAL));
  assert.doesNotMatch(JSON.stringify(persisted), new RegExp(COMMAND_CREDENTIAL));
  assert.deepEqual(
    (await scenario.repository.listEvents(proposal.id)).map((event) => event.event_type),
    ['proposed', 'execute_previewed', 'execute_approved', 'execution_started', 'execution_succeeded'],
  );
  await assert.rejects(
    db(G6_TABLES.attempts).where({ id: first.attempt.id }).update({ result_code: 'rewritten' }),
    /guarded terminal transition/,
  );
});

test('expired approval and a later G5 revoke both block execution before the adapter', async () => {
  const expired = await createSupervisedActionScenario(db, 'approval-expiry');
  const { proposal: expiredProposal } = await proposePreviewApprove(expired, 'approvalexpire001');
  expired.clock.now = new Date('2026-08-17T14:31:00.000Z');
  await assert.rejects(
    expired.service.execute({
      proposalId: expiredProposal.id,
      operator: 'Leoz',
      operatorCredential: OPERATOR_CREDENTIAL,
    }),
    hasCode('action_approval_expired'),
  );
  assert.equal(expired.adapter.executeCalls, 0);

  const revoked = await createSupervisedActionScenario(db, 'g5-revoked');
  const { proposal: revokedProposal } = await proposePreviewApprove(revoked, 'g5revoked0000001');
  const revokeCore = {
    tenant_id: revoked.seeded.tenant.id,
    source_connection_id: revoked.seeded.connection.id,
    authorization_id: 'P2-g5-revoked',
    decision: 'revoke' as const,
    decided_by: 'Leoz',
    decided_at: '2026-08-17T14:01:00.000Z',
    evaluation_fingerprint: actionFingerprint({ verdict: 'revoked' }),
    reason_code: 'g5_revoked_before_action',
    extend_until_business_date: null,
  };
  await revoked.shadow.recordReleaseDecision({
    ...revokeCore,
    evidence_key: actionFingerprint(revokeCore),
  });
  await assert.rejects(
    revoked.service.execute({
      proposalId: revokedProposal.id,
      operator: 'Leoz',
      operatorCredential: OPERATOR_CREDENTIAL,
    }),
    hasCode('g5_not_current_go'),
  );
  assert.equal(revoked.adapter.executeCalls, 0);
});

test('unknown adapter outcome becomes reconciliation-required and is never retried', async () => {
  const scenario = await createSupervisedActionScenario(db, 'adapter-outcome');
  const { proposal } = await proposePreviewApprove(scenario, 'unknownoutcome001');
  scenario.adapter.throwOnExecute = true;
  const first = await scenario.service.execute({
    proposalId: proposal.id,
    operator: 'Leoz',
    operatorCredential: OPERATOR_CREDENTIAL,
  });
  assert.equal(first.attempt.status, 'reconciliation_required');
  assert.equal(first.attempt.external_mutation_count, null);
  const replay = await scenario.service.execute({
    proposalId: proposal.id,
    operator: 'Leoz',
    operatorCredential: OPERATOR_CREDENTIAL,
  });
  assert.equal(replay.attempt.id, first.attempt.id);
  assert.equal(replay.replayed, true);
  assert.equal(scenario.adapter.executeCalls, 1);
});

test('an expired in-progress lease is sealed for manual reconciliation, not retried', async () => {
  const scenario = await createSupervisedActionScenario(db, 'expired-lease');
  const { proposal, preview, approval } = await proposePreviewApprove(scenario, 'expiredlease0001');
  await scenario.repository.claimAttempt({
    tenant_id: proposal.tenant_id,
    proposal_id: proposal.id,
    preview_id: preview.id,
    approval_id: approval.id,
    kind: 'execute',
    subject_execution_id: null,
    idempotency_key: proposal.idempotency_key,
    request_fingerprint: preview.request_fingerprint,
    operator: 'Leoz',
    reserved_cost_minor: 25,
    started_at: '2026-08-17T14:00:00.000Z',
    lease_expires_at: '2026-08-17T14:01:00.000Z',
    currency: 'USD',
  }, { maxPerHour: 10, maxPerDay: 20, maxCostMinor: 100 });
  scenario.clock.now = new Date('2026-08-17T14:31:01.000Z');
  const result = await scenario.service.reconcileExpiredAttempt({
    proposalId: proposal.id,
    kind: 'execute',
    operator: 'Leoz',
    operatorCredential: OPERATOR_CREDENTIAL,
  });
  assert.equal(result.status, 'reconciliation_required');
  assert.equal(result.result_code, 'execution_lease_expired');
  assert.equal(scenario.adapter.executeCalls, 0);
});

test('hourly and budget limits are checked atomically before another adapter call', async () => {
  const hourly = await createSupervisedActionScenario(db, 'hourly-limit', { maxPerHour: 1 });
  const first = await proposePreviewApprove(hourly, 'hourlylimit00001');
  await hourly.service.execute({
    proposalId: first.proposal.id,
    operator: 'Leoz',
    operatorCredential: OPERATOR_CREDENTIAL,
  });
  const second = await proposePreviewApprove(hourly, 'hourlylimit00002');
  await assert.rejects(
    hourly.service.execute({
      proposalId: second.proposal.id,
      operator: 'Leoz',
      operatorCredential: OPERATOR_CREDENTIAL,
    }),
    hasCode('hourly_action_limit_exceeded'),
  );
  assert.equal(hourly.adapter.executeCalls, 1);

  const budget = await createSupervisedActionScenario(db, 'budget-limit', { maxCostMinor: 30 });
  const budgetFirst = await proposePreviewApprove(budget, 'budgetlimit00001');
  await budget.service.execute({
    proposalId: budgetFirst.proposal.id,
    operator: 'Leoz',
    operatorCredential: OPERATOR_CREDENTIAL,
  });
  const budgetSecond = await proposePreviewApprove(budget, 'budgetlimit00002');
  await assert.rejects(
    budget.service.execute({
      proposalId: budgetSecond.proposal.id,
      operator: 'Leoz',
      operatorCredential: OPERATOR_CREDENTIAL,
    }),
    hasCode('daily_action_budget_exceeded'),
  );
  assert.equal(budget.adapter.executeCalls, 1);
});

test('rollback requires a new dry-run and approval, then stays available after G5 revoke', async () => {
  const scenario = await createSupervisedActionScenario(db, 'rollback-safe', { maxPerHour: 1 });
  const { proposal } = await proposePreviewApprove(scenario, 'rollbacksafe0001');
  const execution = await scenario.service.execute({
    proposalId: proposal.id,
    operator: 'Leoz',
    operatorCredential: OPERATOR_CREDENTIAL,
  });
  assert.equal(execution.attempt.status, 'succeeded');

  const revokeCore = {
    tenant_id: scenario.seeded.tenant.id,
    source_connection_id: scenario.seeded.connection.id,
    authorization_id: 'P2-rollback-safe',
    decision: 'revoke' as const,
    decided_by: 'Leoz',
    decided_at: '2026-08-17T14:01:00.000Z',
    evaluation_fingerprint: actionFingerprint({ verdict: 'revoked_for_recovery' }),
    reason_code: 'g5_revoked_for_recovery',
    extend_until_business_date: null,
  };
  await scenario.shadow.recordReleaseDecision({
    ...revokeCore,
    evidence_key: actionFingerprint(revokeCore),
  });
  scenario.clock.now = new Date('2026-08-17T14:02:00.000Z');
  const rollbackPreview = await scenario.service.previewRollback({
    proposalId: proposal.id,
    operator: 'Leoz',
    operatorCredential: OPERATOR_CREDENTIAL,
  });
  await assert.rejects(
    scenario.service.rollback({
      proposalId: proposal.id,
      operator: 'Leoz',
      operatorCredential: OPERATOR_CREDENTIAL,
    }),
    hasCode('missing_action_approval'),
  );
  await scenario.service.decide({
    proposalId: proposal.id,
    kind: 'rollback',
    decision: 'approved',
    approver: 'Leoz',
    approvalCredential: APPROVAL_CREDENTIAL,
    reasonCode: 'ceo_approved_rollback',
    nonce: 'approval:rollback-safe:0001',
    maxCostMinor: rollbackPreview.estimated_cost_minor,
  });
  const rollback = await scenario.service.rollback({
    proposalId: proposal.id,
    operator: 'Leoz',
    operatorCredential: OPERATOR_CREDENTIAL,
  });
  assert.equal(rollback.attempt.status, 'succeeded');
  assert.equal(scenario.adapter.rollbackCalls, 1);
  assert.deepEqual(
    (await scenario.repository.listEvents(proposal.id)).map((event) => event.event_type),
    [
      'proposed',
      'execute_previewed',
      'execute_approved',
      'execution_started',
      'execution_succeeded',
      'rollback_previewed',
      'rollback_approved',
      'rollback_started',
      'rollback_succeeded',
    ],
  );
});

test('policy and audit facts are immutable while attempt permits exactly one terminal transition', async () => {
  const scenario = await createSupervisedActionScenario(db, 'db-guards');
  const { proposal } = await proposePreviewApprove(scenario, 'dbguards00000001');
  const execution = await scenario.service.execute({
    proposalId: proposal.id,
    operator: 'Leoz',
    operatorCredential: OPERATOR_CREDENTIAL,
  });
  const event = (await scenario.repository.listEvents(proposal.id))[0];
  for (const mutation of [
    db(G6_TABLES.policies).where({ id: scenario.policyRecord.id }).update({ risk_tier: 'medium' }),
    db(G6_TABLES.proposals).where({ id: proposal.id }).delete(),
    db(G6_TABLES.events).where({ id: event.id }).update({ reason_code: 'rewritten' }),
    db(G6_TABLES.attempts).where({ id: execution.attempt.id }).delete(),
  ]) await assert.rejects(mutation, /immutable|cannot be deleted/);
});
