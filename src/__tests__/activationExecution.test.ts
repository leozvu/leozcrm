import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import knexFactory from 'knex';
import config from '../../knexfile';
import {
  ActivationExecutionError,
  PHASE8_TABLES,
} from '../domain/activationExecution';
import { validateActivationExecutionPolicy } from '../domain/activationExecutionPolicy';
import { buildActivationExecutionAdapterRegistry } from '../integrations/actions/activationExecutionAdapterRegistry';
import {
  PHASE8_EXECUTOR_CREDENTIAL,
  PHASE8_OBSERVER_CREDENTIAL,
  PHASE8_RELEASE_CREDENTIAL,
  PHASE8_ROLLBACK_CREDENTIAL,
  createActivationExecutionScenario,
} from './support/activationExecutionScenario';
import {
  PHASE7_AUTHORITY_CREDENTIAL,
  PHASE7_VERIFIER_CREDENTIAL,
} from './support/activationCeremonyScenario';

const db = knexFactory(config.test);

before(async () => {
  await db.migrate.latest();
});

after(async () => {
  await db.destroy();
});

function hasCode(code: string) {
  return (error: unknown) => error instanceof ActivationExecutionError && error.code === code;
}

test('Phase 8 policy exactly binds Phase 7 and requires four new credentials', async () => {
  const scenario = await createActivationExecutionScenario(db, 'policy-contract', { acceptPolicy: false });
  const state = await scenario.repository.findPhase7State(scenario.policy.phase7.policy_id);
  const validation = validateActivationExecutionPolicy(scenario.policy, {
    phase7: state.found.manifest,
    handoff: state.handoff,
    phase6: state.found.phase6.manifest,
    phase5: state.found.phase6.phase5.manifest,
    g7: state.found.phase6.phase5.g7.manifest,
    g6: state.found.phase6.phase5.g7.g6.manifest,
  });
  assert.equal(validation.ok, true);
  assert.match(validation.fingerprint!, /^sha256:[0-9a-f]{64}$/);
  assert.equal(new Set([
    scenario.policy.identities.release_credential_sha256,
    scenario.policy.identities.executor_credential_sha256,
    scenario.policy.identities.observer_credential_sha256,
    scenario.policy.identities.rollback_credential_sha256,
  ]).size, 4);

  const shared = structuredClone(scenario.policy);
  shared.identities.executor_credential_sha256 = shared.identities.release_credential_sha256;
  assert.match(validateActivationExecutionPolicy(shared).issues.join('\n'), /credentials must be different/);
  const waiver = structuredClone(scenario.policy);
  waiver.safety.waivers_allowed = true as false;
  assert.match(validateActivationExecutionPolicy(waiver).issues.join('\n'), /waivers_allowed must equal false/);
  const pending = JSON.parse(fs.readFileSync(
    path.resolve('config/phase8.activation-execution-policy.example.json'),
    'utf8',
  ));
  assert.equal(validateActivationExecutionPolicy(pending).ok, false);
  const drift = structuredClone(scenario.policy);
  drift.target.target_fingerprint = `sha256:${'9'.repeat(64)}`;
  assert.match(validateActivationExecutionPolicy(drift, {
    phase7: state.found.manifest,
    handoff: state.handoff,
    phase6: state.found.phase6.manifest,
    phase5: state.found.phase6.phase5.manifest,
    g7: state.found.phase6.phase5.g7.manifest,
    g6: state.found.phase6.phase5.g7.g6.manifest,
  }).issues.join('\n'), /target contract does not exactly match/);
});

test('acceptance requires the exact registered adapter and release credential', async () => {
  const scenario = await createActivationExecutionScenario(db, 'acceptance', { acceptPolicy: false });
  await assert.rejects(
    scenario.service.acceptPolicy(scenario.policy, 'wrong-credential'),
    hasCode('activation_release_authority_credential_rejected'),
  );
  scenario.adapter.descriptor.configuration_digest = `sha256:${'8'.repeat(64)}`;
  await assert.rejects(
    scenario.service.acceptPolicy(scenario.policy, PHASE8_RELEASE_CREDENTIAL),
    hasCode('activation_adapter_binding_mismatch'),
  );
  scenario.adapter.descriptor.configuration_digest = scenario.policy.target.configuration_digest;
  const accepted = await scenario.service.acceptPolicy(scenario.policy, PHASE8_RELEASE_CREDENTIAL);
  assert.equal(accepted.policy_id, scenario.policy.policy_id);
  assert.equal((await scenario.service.status(scenario.policy.policy_id)).kill_switch?.state, 'engaged');
});

test('production registry is empty by default and activation cannot bypass preview and release', async () => {
  assert.equal(buildActivationExecutionAdapterRegistry().size(), 0);
  const scenario = await createActivationExecutionScenario(db, 'kill-switch');
  await assert.rejects(scenario.activate(), hasCode('missing_activation_preview'));
  await scenario.service.preview({
    policyId: scenario.policy.policy_id,
    previewKey: 'phase8:kill-switch:preview:0001',
    actor: 'Leoz',
    executorCredential: PHASE8_EXECUTOR_CREDENTIAL,
  });
  await assert.rejects(scenario.activate(), hasCode('activation_not_released'));
  assert.equal(scenario.adapter.calls.activate, 0);
});

test('zero-mutation preview is idempotent and cannot be retargeted', async () => {
  const scenario = await createActivationExecutionScenario(db, 'preview-idempotency');
  const input = {
    policyId: scenario.policy.policy_id,
    previewKey: 'phase8:preview-idempotency:preview:0001',
    actor: 'Leoz',
    executorCredential: PHASE8_EXECUTOR_CREDENTIAL,
  };
  const first = await scenario.service.preview(input);
  const second = await scenario.service.preview(input);
  assert.equal(second.id, first.id);
  assert.equal(scenario.adapter.calls.preview, 1);
  await assert.rejects(
    scenario.service.preview({ ...input, previewKey: 'phase8:preview-idempotency:preview:0002' }),
    hasCode('activation_preview_conflict'),
  );
});

test('release requires independent credentials and expires fail-closed', async () => {
  const scenario = await createActivationExecutionScenario(db, 'dual-release');
  await scenario.service.preview({
    policyId: scenario.policy.policy_id,
    previewKey: 'phase8:dual-release:preview:0001',
    actor: 'Leoz',
    executorCredential: PHASE8_EXECUTOR_CREDENTIAL,
  });
  const release = {
    policyId: scenario.policy.policy_id,
    releaseKey: 'phase8:dual-release:release:0001',
    reasonCode: 'controlled_single_activation_approved',
    releaseActor: 'Leoz',
    releaseCredential: PHASE8_RELEASE_CREDENTIAL,
    observerActor: 'Leoz',
    observerCredential: PHASE8_OBSERVER_CREDENTIAL,
  };
  await assert.rejects(
    scenario.service.release({ ...release, observerCredential: PHASE8_RELEASE_CREDENTIAL }),
    hasCode('activation_observer_credential_rejected'),
  );
  const record = await scenario.service.release(release);
  assert.equal((await scenario.service.release(release)).id, record.id);
  scenario.ceremony.external.assurance.bounded.supervised.clock.now = new Date('2026-08-17T14:11:00.000Z');
  await assert.rejects(scenario.activate(), hasCode('activation_release_expired'));
  assert.equal(scenario.adapter.calls.activate, 0);
});

test('one successful activation consumes the claim and every retry is read-only', async () => {
  const scenario = await createActivationExecutionScenario(db, 'single-attempt');
  await scenario.previewAndRelease();
  const first = await scenario.activate();
  const second = await scenario.activate();
  assert.equal(first.state, 'terminal');
  assert.ok(first.outcome);
  assert.equal(first.outcome.outcome, 'succeeded');
  assert.equal(second.outcome?.id, first.outcome.id);
  assert.equal(scenario.adapter.calls.activate, 1);
  const status = await scenario.service.status(scenario.policy.policy_id);
  assert.equal(status.kill_switch?.state, 'engaged');
  assert.equal(status.activation_status, 'activation_succeeded');
  await assert.rejects(
    scenario.service.activate({
      policyId: scenario.policy.policy_id,
      activationKey: 'phase8:single-attempt:activation:0002',
      actor: 'Leoz',
      executorCredential: PHASE8_EXECUTOR_CREDENTIAL,
    }),
    hasCode('activation_already_claimed'),
  );
});

test('concurrent activation requests still invoke the adapter exactly once', async () => {
  const scenario = await createActivationExecutionScenario(db, 'concurrent-attempt');
  await scenario.previewAndRelease();
  let releaseAdapter!: () => void;
  scenario.adapter.activationGate = new Promise<void>((resolve) => { releaseAdapter = resolve; });
  let adapterEntered!: () => void;
  const entered = new Promise<void>((resolve) => { adapterEntered = resolve; });
  scenario.adapter.onActivate = adapterEntered;

  const firstPromise = scenario.activate();
  const secondPromise = scenario.activate();
  await entered;
  releaseAdapter();
  const results = await Promise.all([firstPromise, secondPromise]);
  assert.equal(results.some((item) => item.state === 'terminal'), true);
  assert.equal(scenario.adapter.calls.activate, 1);
});

test('lost activation response becomes terminal unknown with no automatic retry', async () => {
  const scenario = await createActivationExecutionScenario(db, 'lost-response');
  scenario.adapter.activateMode = 'throw';
  await scenario.previewAndRelease();
  const first = await scenario.activate();
  const second = await scenario.activate();
  assert.ok(first.outcome);
  assert.equal(first.outcome.outcome, 'unknown');
  assert.equal(second.outcome?.id, first.outcome.id);
  assert.equal(scenario.adapter.calls.activate, 1);
  const status = await scenario.service.status(scenario.policy.policy_id);
  assert.equal(status.incidents.length, 1);
  assert.equal(status.kill_switch?.state, 'engaged');
});

test('expired orphan claim reconciles to unknown without invoking the adapter', async () => {
  const scenario = await createActivationExecutionScenario(db, 'crash-reconcile');
  const setup = await scenario.previewAndRelease();
  const state = await scenario.repository.findPolicy(scenario.policy.policy_id);
  await scenario.repository.recordClaim({
    policy: state.record,
    phase7: state.phase7,
    release: setup.release,
    preview: setup.preview,
    activationKey: 'phase8:crash-reconcile:activation:0001',
    claimedBy: 'Leoz',
    claimedAt: '2026-08-17T14:05:00.000Z',
    leaseExpiresAt: '2026-08-17T14:05:30.000Z',
  });
  scenario.ceremony.external.assurance.bounded.supervised.clock.now = new Date('2026-08-17T14:05:31.000Z');
  await assert.rejects(scenario.activate(), hasCode('activation_reconciliation_required'));
  const outcome = await scenario.service.reconcileExpiredClaim({
    policyId: scenario.policy.policy_id,
    actor: 'Leoz',
    observerCredential: PHASE8_OBSERVER_CREDENTIAL,
  });
  assert.equal(outcome.outcome, 'unknown');
  assert.equal(scenario.adapter.calls.activate, 0);
  assert.equal((await scenario.service.status(scenario.policy.policy_id)).incidents.length, 1);
});

test('healthy observation waits for the exact canary window and is idempotent', async () => {
  const scenario = await createActivationExecutionScenario(db, 'healthy-observation');
  await scenario.previewAndRelease();
  await scenario.activate();
  const observe = {
    policyId: scenario.policy.policy_id,
    observationKey: 'phase8:healthy-observation:observation:0001',
    actor: 'Leoz',
    observerCredential: PHASE8_OBSERVER_CREDENTIAL,
  };
  await assert.rejects(scenario.service.observe(observe), hasCode('activation_observation_too_early'));
  scenario.ceremony.external.assurance.bounded.supervised.clock.now = new Date('2026-08-17T14:35:00.000Z');
  const first = await scenario.service.observe(observe);
  const second = await scenario.service.observe(observe);
  assert.equal(first.verdict, 'healthy');
  assert.equal(second.id, first.id);
  assert.equal(scenario.adapter.calls.observe, 1);
  assert.equal((await scenario.service.status(scenario.policy.policy_id)).activation_status, 'activated_healthy');
});

test('unhealthy or unknown observation opens an incident and never auto-rolls back', async () => {
  const unhealthy = await createActivationExecutionScenario(db, 'unhealthy-observation');
  unhealthy.adapter.observationMode = 'unhealthy';
  await unhealthy.previewAndRelease();
  await unhealthy.activate();
  unhealthy.ceremony.external.assurance.bounded.supervised.clock.now = new Date('2026-08-17T14:35:00.000Z');
  const observed = await unhealthy.service.observe({
    policyId: unhealthy.policy.policy_id,
    observationKey: 'phase8:unhealthy-observation:observation:0001',
    actor: 'Leoz',
    observerCredential: PHASE8_OBSERVER_CREDENTIAL,
  });
  assert.equal(observed.verdict, 'unhealthy');
  assert.equal(unhealthy.adapter.calls.rollback, 0);
  assert.equal((await unhealthy.service.status(unhealthy.policy.policy_id)).incidents.length, 1);

  const unknown = await createActivationExecutionScenario(db, 'uncertain-observation');
  unknown.adapter.observationMode = 'throw';
  await unknown.previewAndRelease();
  await unknown.activate();
  unknown.ceremony.external.assurance.bounded.supervised.clock.now = new Date('2026-08-17T14:35:00.000Z');
  const unknownRecord = await unknown.service.observe({
    policyId: unknown.policy.policy_id,
    observationKey: 'phase8:uncertain-observation:observation:0001',
    actor: 'Leoz',
    observerCredential: PHASE8_OBSERVER_CREDENTIAL,
  });
  assert.equal(unknownRecord.verdict, 'unknown');
  assert.equal(unknown.adapter.calls.observe, 1);
  assert.equal(unknown.adapter.calls.rollback, 0);
});

test('rollback is explicit, dual-authorized, bounded, and idempotent', async () => {
  const scenario = await createActivationExecutionScenario(db, 'manual-rollback');
  await scenario.previewAndRelease();
  await scenario.activate();
  const rollback = {
    policyId: scenario.policy.policy_id,
    rollbackKey: 'phase8:manual-rollback:rollback:0001',
    reasonCode: 'manual_safety_recovery',
    authorityActor: 'Leoz',
    authorityCredential: PHASE8_RELEASE_CREDENTIAL,
    rollbackActor: 'Leoz',
    rollbackCredential: PHASE8_ROLLBACK_CREDENTIAL,
  };
  await assert.rejects(
    scenario.service.rollback({ ...rollback, authorityCredential: 'wrong-credential' }),
    hasCode('activation_release_authority_credential_rejected'),
  );
  assert.equal(scenario.adapter.calls.rollback, 0);
  const first = await scenario.service.rollback(rollback);
  const second = await scenario.service.rollback(rollback);
  assert.equal(first.outcome, 'succeeded');
  assert.equal(second.id, first.id);
  assert.equal(scenario.adapter.calls.rollback, 1);
  assert.equal((await scenario.service.status(scenario.policy.policy_id)).activation_status, 'rolled_back');
});

test('failed activation cannot be observed or rolled back', async () => {
  const scenario = await createActivationExecutionScenario(db, 'failed-activation');
  scenario.adapter.activateMode = 'failed';
  await scenario.previewAndRelease();
  const result = await scenario.activate();
  assert.ok(result.outcome);
  assert.equal(result.outcome.outcome, 'failed');
  await assert.rejects(scenario.service.observe({
    policyId: scenario.policy.policy_id,
    observationKey: 'phase8:failed-activation:observation:0001',
    actor: 'Leoz',
    observerCredential: PHASE8_OBSERVER_CREDENTIAL,
  }), hasCode('activation_not_observable'));
  await assert.rejects(scenario.service.rollback({
    policyId: scenario.policy.policy_id,
    rollbackKey: 'phase8:failed-activation:rollback:0001',
    reasonCode: 'manual_safety_recovery',
    authorityActor: 'Leoz',
    authorityCredential: PHASE8_RELEASE_CREDENTIAL,
    rollbackActor: 'Leoz',
    rollbackCredential: PHASE8_ROLLBACK_CREDENTIAL,
  }), hasCode('activation_not_rollbackable'));
});

test('Phase 7 recall before claim blocks activation without touching the adapter', async () => {
  const scenario = await createActivationExecutionScenario(db, 'handoff-recall');
  await scenario.previewAndRelease();
  await scenario.ceremony.service.recallHandoff({
    policyId: scenario.ceremony.policy.policy_id,
    recallKey: 'phase8:handoff-recall:recall:0001',
    reasonCode: 'manual_handoff_recall',
    evidenceFingerprint: scenario.handoff.handoff_fingerprint,
    authorityActor: 'Leoz',
    authorityCredential: PHASE7_AUTHORITY_CREDENTIAL,
    verifierActor: 'Leoz',
    verifierCredential: PHASE7_VERIFIER_CREDENTIAL,
  });
  await assert.rejects(scenario.activate(), hasCode('phase7_handoff_recalled'));
  assert.equal(scenario.adapter.calls.activate, 0);
});

test('all Phase 8 tables are append-only and raw credentials are never persisted', async () => {
  const scenario = await createActivationExecutionScenario(db, 'immutability-secrets');
  await scenario.previewAndRelease();
  await scenario.activate();
  scenario.ceremony.external.assurance.bounded.supervised.clock.now = new Date('2026-08-17T14:35:00.000Z');
  await scenario.service.observe({
    policyId: scenario.policy.policy_id,
    observationKey: 'phase8:immutability-secrets:observation:0001',
    actor: 'Leoz',
    observerCredential: PHASE8_OBSERVER_CREDENTIAL,
  });
  for (const table of Object.values(PHASE8_TABLES)) {
    await assert.rejects(db(table).update({ created_at: '2026-08-17T16:00:00.000Z' }));
    await assert.rejects(db(table).delete());
  }
  const dump = (await Promise.all(Object.values(PHASE8_TABLES).map((table) => db(table).select('*'))))
    .flat().map((row) => JSON.stringify(row)).join('\n');
  for (const secret of [
    PHASE8_RELEASE_CREDENTIAL,
    PHASE8_EXECUTOR_CREDENTIAL,
    PHASE8_OBSERVER_CREDENTIAL,
    PHASE8_ROLLBACK_CREDENTIAL,
  ]) assert.equal(dump.includes(secret), false);
});

test('Phase 8 production builder has no network adapter or scheduler primitive', () => {
  const files = [
    'src/domain/activationExecution.ts',
    'src/domain/activationExecutionPolicy.ts',
    'src/repositories/activationExecutionRepository.ts',
    'src/services/activationExecutionService.ts',
    'src/integrations/actions/activationExecutionAdapterRegistry.ts',
  ];
  const source = files.map((file) => fs.readFileSync(path.resolve(file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /\b(fetch|axios|request|setInterval|setTimeout|child_process|execFile|spawn)\s*\(/);
  assert.equal(buildActivationExecutionAdapterRegistry().size(), 0);
});

test('Phase 8 migration completes SQLite latest, rollback, and latest lifecycle', async () => {
  const lifecycle = knexFactory(config.test);
  try {
    await lifecycle.migrate.latest();
    assert.equal(await lifecycle.schema.hasTable(PHASE8_TABLES.events), true);
    await lifecycle.migrate.rollback();
    assert.equal(await lifecycle.schema.hasTable(PHASE8_TABLES.policies), false);
    await lifecycle.migrate.latest();
    assert.equal(await lifecycle.schema.hasTable(PHASE8_TABLES.rollbacks), true);
  } finally {
    await lifecycle.destroy();
  }
});
