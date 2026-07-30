import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import knexFactory from 'knex';
import config from '../../knexfile';
import {
  ActivationCeremonyError,
  PHASE7_TABLES,
} from '../domain/activationCeremony';
import { validateActivationCeremonyPolicy } from '../domain/activationCeremonyPolicy';
import { PHASE6_EVIDENCE_MATRIX } from '../domain/externalEvidencePolicy';
import { ActionAdapterRegistry } from '../integrations/actions/actionAdapterRegistry';
import { ActivationCeremonyRepository } from '../repositories/activationCeremonyRepository';
import { ExternalEvidenceRepository } from '../repositories/externalEvidenceRepository';
import { ActivationCeremonyService } from '../services/activationCeremonyService';
import { ExternalEvidenceService } from '../services/externalEvidenceService';
import {
  PHASE7_AUTHORITY_CREDENTIAL,
  PHASE7_OPERATOR_CREDENTIAL,
  PHASE7_VERIFIER_CREDENTIAL,
  createActivationCeremonyScenario,
} from './support/activationCeremonyScenario';
import { PHASE6_ASSESSOR_CREDENTIAL } from './support/externalEvidenceScenario';

const db = knexFactory(config.test);

before(async () => {
  await db.migrate.latest();
});

after(async () => {
  await db.destroy();
});

function hasCode(code: string) {
  return (error: unknown) => error instanceof ActivationCeremonyError && error.code === code;
}

test('Phase 7 policy is exact, credential-separated, handoff-only, and has no executor', async () => {
  const scenario = await createActivationCeremonyScenario(db, 'policy-contract', { acceptPolicy: false });
  const validation = validateActivationCeremonyPolicy(
    scenario.policy,
    scenario.external.policy,
    scenario.external.assurance.policy,
    scenario.external.assurance.bounded.policy,
    scenario.external.assurance.bounded.supervised.policy,
  );
  assert.equal(validation.ok, true);
  assert.match(validation.fingerprint!, /^sha256:[0-9a-f]{64}$/);
  assert.equal(new Set(Object.values(scenario.policy.identities).filter((value) => String(value).startsWith('sha256:'))).size, 3);
  assert.equal(scenario.policy.safety.activation_executor_not_implemented, true);
  assert.equal(scenario.policy.safety.external_execution_requires_new_authority, true);
  assert.equal(new ActionAdapterRegistry().size(), 0);

  const waiver = structuredClone(scenario.policy);
  waiver.safety.waivers_allowed = true as false;
  assert.match(validateActivationCeremonyPolicy(waiver).issues.join('\n'), /waivers_allowed must equal false/);
  const shared = structuredClone(scenario.policy);
  shared.identities.operator_credential_sha256 = shared.identities.authority_credential_sha256;
  assert.match(validateActivationCeremonyPolicy(shared).issues.join('\n'), /credentials must be different/);
  const extra = { ...structuredClone(scenario.policy), execute: true };
  assert.match(validateActivationCeremonyPolicy(extra).issues.join('\n'), /execute is not allowed/);
  const pending = JSON.parse(fs.readFileSync(path.resolve('config/phase7.activation-ceremony-policy.example.json'), 'utf8'));
  assert.equal(validateActivationCeremonyPolicy(pending).ok, false);
});

test('acceptance requires authority credential, exact fresh Phase 6 assessment, exact target, and empty registry', async () => {
  const scenario = await createActivationCeremonyScenario(db, 'acceptance', { acceptPolicy: false });
  await assert.rejects(scenario.service.acceptPolicy(scenario.policy, 'wrong-credential'), hasCode('activation_authority_credential_rejected'));

  const targetDrift = structuredClone(scenario.policy);
  targetDrift.target.target_fingerprint = `sha256:${'9'.repeat(64)}`;
  await assert.rejects(
    scenario.service.acceptPolicy(targetDrift, PHASE7_AUTHORITY_CREDENTIAL),
    hasCode('phase6_target_binding_changed'),
  );

  const registry = new ActionAdapterRegistry([scenario.external.assurance.bounded.supervised.adapter]);
  const blockedService = new ActivationCeremonyService(
    new ActivationCeremonyRepository(db),
    new ExternalEvidenceService(new ExternalEvidenceRepository(db), registry, () => new Date(scenario.external.assurance.bounded.supervised.clock.now)),
    registry,
    () => new Date(scenario.external.assurance.bounded.supervised.clock.now),
  );
  await assert.rejects(
    blockedService.acceptPolicy(scenario.policy, PHASE7_AUTHORITY_CREDENTIAL),
    hasCode('production_registry_not_empty'),
  );

  const accepted = await scenario.service.acceptPolicy(scenario.policy, PHASE7_AUTHORITY_CREDENTIAL);
  assert.equal(accepted.phase6_assessment_fingerprint, scenario.phase6Assessment.assessment_fingerprint);
});

test('ceremony derives an immutable dossier, independent approval, and sealed external handoff without activation', async () => {
  const scenario = await createActivationCeremonyScenario(db, 'happy-path');
  const approved = await scenario.createApprovedDossier();
  const handoff = await scenario.service.sealHandoff({
    policyId: scenario.policy.policy_id,
    dossierKey: approved.dossierKey,
    handoffKey: 'phase7:happy-path:handoff:0001',
    actor: 'Leoz',
    operatorCredential: PHASE7_OPERATOR_CREDENTIAL,
  });
  assert.equal(handoff.handoff_status, 'rehearsal_handoff_sealed');
  assert.equal(handoff.activation_status, 'not_executed');
  assert.equal(handoff.external_execution_required, true);
  const facts = JSON.parse(approved.dossier.facts_json) as { evidence: unknown[]; deployment_id: string };
  assert.equal(facts.evidence.length, 8);
  assert.equal(facts.deployment_id, scenario.policy.target.deployment_id);
  const status = await scenario.service.status(scenario.policy.policy_id);
  assert.equal(status.ceremony_status, 'sealed_external_handoff');
  assert.equal(status.execution_implemented, false);
  assert.equal(status.activation_possible, false);
  assert.deepEqual(status.events.map((event) => event.event_type), [
    'policy_accepted', 'dossier_created', 'dossier_approved', 'handoff_sealed',
  ]);
});

test('separate credentials enforce all three solo roles and rejection cannot be sealed', async () => {
  const scenario = await createActivationCeremonyScenario(db, 'role-boundary');
  const dossierKey = 'phase7:role-boundary:dossier:0001';
  await assert.rejects(scenario.service.createDossier({
    policyId: scenario.policy.policy_id,
    dossierKey,
    actor: 'Leoz',
    authorityCredential: PHASE7_VERIFIER_CREDENTIAL,
  }), hasCode('activation_authority_credential_rejected'));
  await scenario.service.createDossier({
    policyId: scenario.policy.policy_id,
    dossierKey,
    actor: 'Leoz',
    authorityCredential: PHASE7_AUTHORITY_CREDENTIAL,
  });
  await assert.rejects(scenario.service.verifyDossier({
    policyId: scenario.policy.policy_id,
    dossierKey,
    verificationKey: 'phase7:role-boundary:verification:wrong',
    decision: 'approved',
    reasonCode: 'independent_verification_passed',
    actor: 'Leoz',
    verifierCredential: PHASE7_OPERATOR_CREDENTIAL,
  }), hasCode('activation_verifier_credential_rejected'));
  await scenario.service.verifyDossier({
    policyId: scenario.policy.policy_id,
    dossierKey,
    verificationKey: 'phase7:role-boundary:verification:0001',
    decision: 'rejected',
    reasonCode: 'verification_failed_closed',
    actor: 'Leoz',
    verifierCredential: PHASE7_VERIFIER_CREDENTIAL,
  });
  await assert.rejects(scenario.service.sealHandoff({
    policyId: scenario.policy.policy_id,
    dossierKey,
    handoffKey: 'phase7:role-boundary:handoff:0001',
    actor: 'Leoz',
    operatorCredential: PHASE7_OPERATOR_CREDENTIAL,
  }), hasCode('activation_dossier_not_approved'));
});

test('freshness and latest-assessment drift fail closed before dossier creation', async () => {
  const stale = await createActivationCeremonyScenario(db, 'stale-assessment');
  stale.external.assurance.bounded.supervised.clock.now = new Date('2026-08-17T14:36:00.000Z');
  await assert.rejects(stale.service.createDossier({
    policyId: stale.policy.policy_id,
    dossierKey: 'phase7:stale-assessment:dossier:0001',
    actor: 'Leoz',
    authorityCredential: PHASE7_AUTHORITY_CREDENTIAL,
  }), hasCode('phase6_assessment_stale'));

  const changed = await createActivationCeremonyScenario(db, 'assessment-drift');
  changed.external.assurance.bounded.supervised.clock.now = new Date('2026-08-17T14:06:00.000Z');
  await changed.external.service.assess({
    policyId: changed.external.policy.policy_id,
    assessmentKey: 'phase7:assessment-drift:phase6-assessment:0002',
    actor: 'Leoz',
    assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
  });
  await assert.rejects(changed.service.createDossier({
    policyId: changed.policy.policy_id,
    dossierKey: 'phase7:assessment-drift:dossier:0001',
    actor: 'Leoz',
    authorityCredential: PHASE7_AUTHORITY_CREDENTIAL,
  }), hasCode('phase6_assessment_not_current'));
});

test('revocation after dossier creation prevents sealing even with a prior approval', async () => {
  const scenario = await createActivationCeremonyScenario(db, 'evidence-drift');
  const approved = await scenario.createApprovedDossier();
  const facts = JSON.parse(approved.dossier.facts_json) as { evidence: Array<{ evidence_type: string; attestation_id: string }> };
  const canary = facts.evidence.find((item) => item.evidence_type === 'production_canary')!;
  scenario.external.assurance.bounded.supervised.clock.now = new Date('2026-08-17T14:06:00.000Z');
  await scenario.external.service.admit({
    policyId: scenario.external.policy.policy_id,
    envelope: scenario.external.signAttestation('production_canary', {
      statement: 'revoke',
      supersedesAttestationId: canary.attestation_id,
      issuedAt: '2026-08-17T14:06:00.000Z',
      observedUntil: '2026-08-17T14:05:30.000Z',
    }),
    actor: 'Leoz',
    assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
  });
  await assert.rejects(scenario.service.sealHandoff({
    policyId: scenario.policy.policy_id,
    dossierKey: approved.dossierKey,
    handoffKey: 'phase7:evidence-drift:handoff:0001',
    actor: 'Leoz',
    operatorCredential: PHASE7_OPERATOR_CREDENTIAL,
  }), hasCode('phase6_readiness_changed'));
  assert.equal(await db(PHASE7_TABLES.handoffs).where({ policy_record_id: scenario.policyRecord!.id }).first(), undefined);
});

test('verification expires and handoff idempotency cannot be retargeted', async () => {
  const expired = await createActivationCeremonyScenario(db, 'verification-expiry');
  const approved = await expired.createApprovedDossier();
  expired.external.assurance.bounded.supervised.clock.now = new Date('2026-08-17T14:21:00.000Z');
  await assert.rejects(expired.service.sealHandoff({
    policyId: expired.policy.policy_id,
    dossierKey: approved.dossierKey,
    handoffKey: 'phase7:verification-expiry:handoff:0001',
    actor: 'Leoz',
    operatorCredential: PHASE7_OPERATOR_CREDENTIAL,
  }), hasCode('activation_verification_expired'));

  const scenario = await createActivationCeremonyScenario(db, 'handoff-idempotency');
  const first = await scenario.createApprovedDossier('0001');
  const handoff = await scenario.service.sealHandoff({
    policyId: scenario.policy.policy_id,
    dossierKey: first.dossierKey,
    handoffKey: 'phase7:handoff-idempotency:handoff:0001',
    actor: 'Leoz',
    operatorCredential: PHASE7_OPERATOR_CREDENTIAL,
  });
  assert.equal((await scenario.service.sealHandoff({
    policyId: scenario.policy.policy_id,
    dossierKey: first.dossierKey,
    handoffKey: 'phase7:handoff-idempotency:handoff:0001',
    actor: 'Leoz',
    operatorCredential: PHASE7_OPERATOR_CREDENTIAL,
  })).id, handoff.id);
  const secondDossier = await scenario.service.createDossier({
    policyId: scenario.policy.policy_id,
    dossierKey: 'phase7:handoff-idempotency:dossier:0002',
    actor: 'Leoz',
    authorityCredential: PHASE7_AUTHORITY_CREDENTIAL,
  });
  assert.ok(secondDossier.id);
  await assert.rejects(scenario.service.sealHandoff({
    policyId: scenario.policy.policy_id,
    dossierKey: 'phase7:handoff-idempotency:dossier:0002',
    handoffKey: 'phase7:handoff-idempotency:handoff:0001',
    actor: 'Leoz',
    operatorCredential: PHASE7_OPERATOR_CREDENTIAL,
  }), hasCode('activation_handoff_conflict'));
  await scenario.service.verifyDossier({
    policyId: scenario.policy.policy_id,
    dossierKey: 'phase7:handoff-idempotency:dossier:0002',
    verificationKey: 'phase7:handoff-idempotency:verification:0002',
    decision: 'approved',
    reasonCode: 'independent_verification_passed',
    actor: 'Leoz',
    verifierCredential: PHASE7_VERIFIER_CREDENTIAL,
  });
  await assert.rejects(scenario.service.sealHandoff({
    policyId: scenario.policy.policy_id,
    dossierKey: 'phase7:handoff-idempotency:dossier:0002',
    handoffKey: 'phase7:handoff-idempotency:handoff:0002',
    actor: 'Leoz',
    operatorCredential: PHASE7_OPERATOR_CREDENTIAL,
  }), hasCode('activation_policy_already_sealed'));
});

test('dual-credential recall is additive, immutable, and never executes recovery', async () => {
  const scenario = await createActivationCeremonyScenario(db, 'recall');
  const approved = await scenario.createApprovedDossier();
  const handoff = await scenario.service.sealHandoff({
    policyId: scenario.policy.policy_id,
    dossierKey: approved.dossierKey,
    handoffKey: 'phase7:recall:handoff:0001',
    actor: 'Leoz',
    operatorCredential: PHASE7_OPERATOR_CREDENTIAL,
  });
  const recallInput = {
    policyId: scenario.policy.policy_id,
    recallKey: 'phase7:recall:recall:0001',
    reasonCode: 'manual_handoff_recall',
    evidenceFingerprint: handoff.handoff_fingerprint,
    authorityActor: 'Leoz',
    authorityCredential: PHASE7_AUTHORITY_CREDENTIAL,
    verifierActor: 'Leoz',
    verifierCredential: PHASE7_VERIFIER_CREDENTIAL,
  };
  await assert.rejects(
    scenario.service.recallHandoff({ ...recallInput, verifierCredential: 'wrong-credential' }),
    hasCode('activation_verifier_credential_rejected'),
  );
  const recall = await scenario.service.recallHandoff(recallInput);
  assert.equal(recall.recalled_by, 'Leoz');
  assert.equal(recall.verified_by, 'Leoz');
  assert.equal((await scenario.service.recallHandoff(recallInput)).id, recall.id);
  await assert.rejects(
    scenario.service.recallHandoff({ ...recallInput, recallKey: 'phase7:recall:recall:0002' }),
    hasCode('activation_handoff_already_recalled'),
  );
  const status = await scenario.service.status(scenario.policy.policy_id);
  assert.equal(status.ceremony_status, 'recalled');
  assert.equal(status.activation_status, 'not_executed');
  await assert.rejects(db(PHASE7_TABLES.handoffs).where({ id: handoff.id }).update({ activation_status: 'executed' }));
  await assert.rejects(db(PHASE7_TABLES.recalls).where({ id: recall.id }).delete());
});

test('all Phase 7 persistence tables reject update and delete', async () => {
  const scenario = await createActivationCeremonyScenario(db, 'immutability');
  const approved = await scenario.createApprovedDossier();
  const handoff = await scenario.service.sealHandoff({
    policyId: scenario.policy.policy_id,
    dossierKey: approved.dossierKey,
    handoffKey: 'phase7:immutability:handoff:0001',
    actor: 'Leoz',
    operatorCredential: PHASE7_OPERATOR_CREDENTIAL,
  });
  await scenario.service.recallHandoff({
    policyId: scenario.policy.policy_id,
    recallKey: 'phase7:immutability:recall:0001',
    reasonCode: 'immutability_probe_recall',
    evidenceFingerprint: handoff.handoff_fingerprint,
    authorityActor: 'Leoz',
    authorityCredential: PHASE7_AUTHORITY_CREDENTIAL,
    verifierActor: 'Leoz',
    verifierCredential: PHASE7_VERIFIER_CREDENTIAL,
  });
  for (const table of Object.values(PHASE7_TABLES)) {
    await assert.rejects(db(table).update({ created_at: '2026-08-17T15:00:00.000Z' }));
    await assert.rejects(db(table).delete());
  }
  assert.equal(PHASE6_EVIDENCE_MATRIX.length, 8);
});

test('raw ceremony credentials are never persisted', async () => {
  const scenario = await createActivationCeremonyScenario(db, 'secret-hygiene');
  const approved = await scenario.createApprovedDossier();
  await scenario.service.sealHandoff({
    policyId: scenario.policy.policy_id,
    dossierKey: approved.dossierKey,
    handoffKey: 'phase7:secret-hygiene:handoff:0001',
    actor: 'Leoz',
    operatorCredential: PHASE7_OPERATOR_CREDENTIAL,
  });
  const dump = (await Promise.all(Object.values(PHASE7_TABLES).map((table) => db(table).select('*'))))
    .flat()
    .map((row) => JSON.stringify(row))
    .join('\n');
  assert.equal(dump.includes(PHASE7_AUTHORITY_CREDENTIAL), false);
  assert.equal(dump.includes(PHASE7_VERIFIER_CREDENTIAL), false);
  assert.equal(dump.includes(PHASE7_OPERATOR_CREDENTIAL), false);
});

test('Phase 7 implementation contains no network, scheduler, or activation execution primitive', () => {
  const files = [
    'src/domain/activationCeremony.ts',
    'src/domain/activationCeremonyPolicy.ts',
    'src/repositories/activationCeremonyRepository.ts',
    'src/services/activationCeremonyService.ts',
    'src/activationCeremonyOperator.ts',
  ];
  const source = files.map((file) => fs.readFileSync(path.resolve(file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /\b(fetch|axios|request|setInterval|setTimeout|child_process|execFile|spawn)\s*\(/);
  assert.doesNotMatch(source, /register\s*\([^)]*production|\b(activate|deploy|promote|execute)\s*\(/i);
});

test('directly inserted corrupt Phase 7 evidence fails closed on read', async () => {
  const scenario = await createActivationCeremonyScenario(db, 'corruption');
  const dossier = await scenario.service.createDossier({
    policyId: scenario.policy.policy_id,
    dossierKey: 'phase7:corruption:dossier:0001',
    actor: 'Leoz',
    authorityCredential: PHASE7_AUTHORITY_CREDENTIAL,
  });
  await db(PHASE7_TABLES.dossiers).insert({
    ...dossier,
    id: '61000000-0000-4000-8000-000000000001',
    dossier_key: 'phase7:corruption:dossier:0002',
    facts_json: '{}',
    facts_fingerprint: `sha256:${'d'.repeat(64)}`,
    dossier_fingerprint: `sha256:${'e'.repeat(64)}`,
  });
  await assert.rejects(
    scenario.repository.findDossier(scenario.policyRecord!.id, 'phase7:corruption:dossier:0002'),
    /stored object keys are invalid/,
  );
});

test('Phase 7 migration completes SQLite latest, rollback, and latest lifecycle', async () => {
  const lifecycle = knexFactory(config.test);
  try {
    await lifecycle.migrate.latest();
    assert.equal(await lifecycle.schema.hasTable(PHASE7_TABLES.events), true);
    await lifecycle.migrate.rollback();
    assert.equal(await lifecycle.schema.hasTable(PHASE7_TABLES.policies), false);
    await lifecycle.migrate.latest();
    assert.equal(await lifecycle.schema.hasTable(PHASE7_TABLES.recalls), true);
  } finally {
    await lifecycle.destroy();
  }
});
