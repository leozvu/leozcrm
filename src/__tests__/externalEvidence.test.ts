import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import knexFactory from 'knex';
import config from '../../knexfile';
import {
  ExternalEvidenceError,
  PHASE6_TABLES,
  externalEvidenceFingerprint,
  validateExternalEvidenceEnvelope,
} from '../domain/externalEvidence';
import {
  PHASE6_EVIDENCE_MATRIX,
  PHASE6_ISSUER_ROLES,
  validateExternalEvidencePolicy,
} from '../domain/externalEvidencePolicy';
import { ActionAdapterRegistry } from '../integrations/actions/actionAdapterRegistry';
import {
  PHASE6_ASSESSOR_CREDENTIAL,
  PHASE6_AUTHORITY_CREDENTIAL,
  createExternalEvidenceScenario,
} from './support/externalEvidenceScenario';

const db = knexFactory(config.test);

before(async () => {
  await db.migrate.latest();
});

after(async () => {
  await db.destroy();
});

function hasCode(code: string) {
  return (error: unknown) => error instanceof ExternalEvidenceError && error.code === code;
}

test('Phase 6 policy is exact, key-pinned, credential-separated, and grants no release authority', async () => {
  assert.equal(new ActionAdapterRegistry().size(), 0);
  const scenario = await createExternalEvidenceScenario(db, 'policy-contract', { acceptPolicy: false });
  const validation = validateExternalEvidencePolicy(
    scenario.policy,
    scenario.assurance.policy,
    scenario.assurance.bounded.policy,
    scenario.assurance.bounded.supervised.policy,
  );
  assert.equal(validation.ok, true);
  assert.match(validation.fingerprint!, /^sha256:[0-9a-f]{64}$/);
  assert.equal(PHASE6_EVIDENCE_MATRIX.length, 8);
  assert.equal(new Set(PHASE6_EVIDENCE_MATRIX.map((item) => item.blocker_code)).size, 8);
  for (const role of PHASE6_ISSUER_ROLES) {
    assert.match(scenario.policy.issuers[role].public_key_pem, /^-----BEGIN PUBLIC KEY-----/);
    assert.equal(scenario.policy.issuers[role].public_key_pem.includes('PRIVATE'), false);
  }

  const release = structuredClone(scenario.policy) as any;
  release.release = true;
  assert.match(validateExternalEvidencePolicy(release).issues.join('\n'), /release is not allowed/);
  const waiver = structuredClone(scenario.policy);
  waiver.safety.waivers_allowed = true as false;
  assert.match(validateExternalEvidencePolicy(waiver).issues.join('\n'), /waivers_allowed must equal false/);
  const sharedCredential = structuredClone(scenario.policy);
  sharedCredential.identities.assessor_credential_sha256 = sharedCredential.identities.authority_credential_sha256;
  assert.match(validateExternalEvidencePolicy(sharedCredential).issues.join('\n'), /credentials must be different/);
  const sharedKey = structuredClone(scenario.policy);
  sharedKey.issuers.monitoring = structuredClone(sharedKey.issuers.implementation);
  sharedKey.issuers.monitoring.issuer_id = 'different-monitoring-issuer';
  sharedKey.issuers.monitoring.key_id = 'different-monitoring-key';
  assert.match(validateExternalEvidencePolicy(sharedKey).issues.join('\n'), /public keys must be unique/);

  const pendingPolicy = JSON.parse(fs.readFileSync(path.resolve('config/phase6.external-evidence-policy.example.json'), 'utf8'));
  assert.equal(validateExternalEvidencePolicy(pendingPolicy).ok, false);
  const unsignedTemplate = JSON.parse(fs.readFileSync(path.resolve('config/phase6.external-attestation.template.json'), 'utf8'));
  assert.equal(validateExternalEvidenceEnvelope(unsignedTemplate).ok, false);
});

test('policy acceptance requires exact passing Phase 5 package and trust-authority credential', async () => {
  const scenario = await createExternalEvidenceScenario(db, 'acceptance', { acceptPolicy: false });
  await assert.rejects(
    scenario.service.acceptPolicy(scenario.policy, 'wrong-credential'),
    hasCode('external_evidence_authority_credential_rejected'),
  );
  const drifted = structuredClone(scenario.policy);
  drifted.phase5.release_package_fingerprint = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(
    scenario.service.acceptPolicy(drifted, PHASE6_AUTHORITY_CREDENTIAL),
    hasCode('phase5_package_binding_changed'),
  );
  const accepted = await scenario.service.acceptPolicy(scenario.policy, PHASE6_AUTHORITY_CREDENTIAL);
  assert.equal(accepted.phase5_policy_record_id, scenario.assurance.policyRecord!.id);
  assert.equal(accepted.phase5_release_package_fingerprint, scenario.phase5Package.package_fingerprint);
});

test('empty evidence derives an eight-row incomplete matrix and stays activation-blocked', async () => {
  const scenario = await createExternalEvidenceScenario(db, 'empty-matrix');
  const assessment = await scenario.service.assess({
    policyId: scenario.policy.policy_id,
    assessmentKey: 'phase6:empty-matrix:assessment:0001',
    actor: 'Leoz',
    assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
  });
  const matrix = JSON.parse(assessment.matrix_json) as Array<{ status: string }>;
  assert.equal(matrix.length, 8);
  assert.equal(matrix.every((item) => item.status === 'missing'), true);
  assert.equal(assessment.status, 'incomplete');
  assert.equal(assessment.release_status, 'blocked_external_activation');
  const status = await scenario.service.status(scenario.policy.policy_id);
  assert.equal(status.external_release_possible, false);
  assert.equal(status.activation_possible, false);
});

test('admission rejects invalid signature, unpinned identity, wrong package, stale evidence, and future issuance', async () => {
  const scenario = await createExternalEvidenceScenario(db, 'adversarial-admission');
  const type = 'external_g5_release' as const;
  await assert.rejects(
    scenario.service.admit({
      policyId: scenario.policy.policy_id,
      envelope: scenario.signAttestation(type, { privateKey: scenario.keys.monitoring.privateKey }),
      actor: 'Leoz',
      assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
    }),
    hasCode('external_attestation_signature_rejected'),
  );
  await assert.rejects(
    scenario.service.admit({
      policyId: scenario.policy.policy_id,
      envelope: scenario.signAttestation(type, { issuerId: 'untrusted-product-owner' }),
      actor: 'Leoz',
      assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
    }),
    hasCode('invalid_external_attestation'),
  );
  await assert.rejects(
    scenario.service.admit({
      policyId: scenario.policy.policy_id,
      envelope: scenario.signAttestation(type, { packageFingerprint: `sha256:${'1'.repeat(64)}` }),
      actor: 'Leoz',
      assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
    }),
    hasCode('invalid_external_attestation'),
  );
  await assert.rejects(
    scenario.service.admit({
      policyId: scenario.policy.policy_id,
      envelope: scenario.signAttestation(type, {
        observedFrom: '2026-08-09T12:00:00.000Z',
        observedUntil: '2026-08-10T12:00:00.000Z',
      }),
      actor: 'Leoz',
      assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
    }),
    hasCode('attestation_stale'),
  );
  await assert.rejects(
    scenario.service.admit({
      policyId: scenario.policy.policy_id,
      envelope: scenario.signAttestation(type, {
        observedUntil: '2026-08-17T14:10:00.000Z',
        issuedAt: '2026-08-17T14:11:00.000Z',
      }),
      actor: 'Leoz',
      assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
    }),
    hasCode('attestation_from_future'),
  );
});

test('eight valid signed attestations produce complete_unreleased, never release', async () => {
  const scenario = await createExternalEvidenceScenario(db, 'complete-matrix');
  for (const item of PHASE6_EVIDENCE_MATRIX) {
    await scenario.service.admit({
      policyId: scenario.policy.policy_id,
      envelope: scenario.signAttestation(item.evidence_type),
      actor: 'Leoz',
      assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
    });
  }
  const assessment = await scenario.service.assess({
    policyId: scenario.policy.policy_id,
    assessmentKey: 'phase6:complete-matrix:assessment:0001',
    actor: 'Leoz',
    assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
  });
  assert.equal(assessment.status, 'complete_unreleased');
  assert.equal(assessment.release_status, 'blocked_external_activation');
  const matrix = JSON.parse(assessment.matrix_json) as Array<{ status: string }>;
  assert.equal(matrix.every((item) => item.status === 'satisfied'), true);
  assert.equal((await scenario.service.status(scenario.policy.policy_id)).activation_possible, false);
});

test('attestation replay is idempotent only for identical evidence; nonce reuse conflicts', async () => {
  const scenario = await createExternalEvidenceScenario(db, 'anti-replay');
  const envelope = scenario.signAttestation('external_g5_release', { nonce: 'nonce:phase6:anti-replay:0001' });
  const input = {
    policyId: scenario.policy.policy_id,
    envelope,
    actor: 'Leoz',
    assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
  };
  const first = await scenario.service.admit(input);
  assert.equal((await scenario.service.admit(input)).id, first.id);
  const conflict = scenario.signAttestation('external_g5_release', {
    attestationId: envelope.attestation.attestation_id,
    nonce: 'nonce:phase6:anti-replay:0002',
  });
  await assert.rejects(scenario.service.admit({ ...input, envelope: conflict }), hasCode('attestation_replay_conflict'));
  const nonceReplay = scenario.signAttestation('external_g5_release', {
    nonce: envelope.attestation.nonce,
    issuedAt: '2026-08-17T14:05:30.000Z',
  });
  await assert.rejects(scenario.service.admit({ ...input, envelope: nonceReplay }), hasCode('attestation_nonce_replay'));
  assert.equal(Number((await db(PHASE6_TABLES.attestations).where({ policy_record_id: scenario.policyRecord!.id }).count<{ count: number | string }[]>({ count: '*' }))[0].count), 1);
});

test('signed revocation supersedes the latest pass and immediately reopens its blocker', async () => {
  const scenario = await createExternalEvidenceScenario(db, 'revocation');
  const pass = await scenario.service.admit({
    policyId: scenario.policy.policy_id,
    envelope: scenario.signAttestation('production_canary'),
    actor: 'Leoz',
    assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
  });
  scenario.assurance.bounded.supervised.clock.now = new Date('2026-08-17T14:06:00.000Z');
  const revoke = scenario.signAttestation('production_canary', {
    statement: 'revoke',
    supersedesAttestationId: pass.attestation_id,
    issuedAt: '2026-08-17T14:06:00.000Z',
    nonce: 'nonce:phase6:revocation:0002',
  });
  await scenario.service.admit({
    policyId: scenario.policy.policy_id,
    envelope: revoke,
    actor: 'Leoz',
    assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
  });
  const assessment = await scenario.service.assess({
    policyId: scenario.policy.policy_id,
    assessmentKey: 'phase6:revocation:assessment:0001',
    actor: 'Leoz',
    assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
  });
  const matrix = JSON.parse(assessment.matrix_json) as Array<{ evidence_type: string; status: string }>;
  assert.equal(matrix.find((item) => item.evidence_type === 'production_canary')?.status, 'revoked');
  assert.equal(assessment.status, 'incomplete');
  const stalePass = scenario.signAttestation('production_canary', {
    issuedAt: '2026-08-17T14:05:30.000Z',
    nonce: 'nonce:phase6:revocation:0003',
  });
  await assert.rejects(
    scenario.service.admit({
      policyId: scenario.policy.policy_id,
      envelope: stalePass,
      actor: 'Leoz',
      assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
    }),
    hasCode('non_monotonic_attestation'),
  );
});

test('a once-valid pass expires in the derived matrix without mutating old evidence', async () => {
  const scenario = await createExternalEvidenceScenario(db, 'expiry');
  await scenario.service.admit({
    policyId: scenario.policy.policy_id,
    envelope: scenario.signAttestation('external_g5_release', {
      expiresAt: '2026-08-17T14:05:30.000Z',
    }),
    actor: 'Leoz',
    assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
  });
  scenario.assurance.bounded.supervised.clock.now = new Date('2026-08-17T14:06:00.000Z');
  const assessment = await scenario.service.assess({
    policyId: scenario.policy.policy_id,
    assessmentKey: 'phase6:expiry:assessment:0001',
    actor: 'Leoz',
    assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
  });
  const matrix = JSON.parse(assessment.matrix_json) as Array<{ evidence_type: string; status: string }>;
  assert.equal(matrix.find((item) => item.evidence_type === 'external_g5_release')?.status, 'expired');
  assert.equal(assessment.status, 'incomplete');
});

test('a later local G5 revoke blocks further admission even with a valid external signature', async () => {
  const scenario = await createExternalEvidenceScenario(db, 'upstream-revoke');
  const revokeCore = {
    tenant_id: scenario.policy.tenant_id,
    source_connection_id: scenario.policy.source_connection_id,
    authorization_id: 'P2-phase6-upstream-revoke',
    decision: 'revoke' as const,
    decided_by: 'Leoz',
    decided_at: '2026-08-17T14:06:00.000Z',
    evaluation_fingerprint: externalEvidenceFingerprint({ verdict: 'phase6_upstream_revoke' }),
    reason_code: 'phase6_upstream_g5_revoked',
    extend_until_business_date: null,
  };
  await scenario.assurance.bounded.supervised.shadow.recordReleaseDecision({
    ...revokeCore,
    evidence_key: externalEvidenceFingerprint(revokeCore),
  });
  scenario.assurance.bounded.supervised.clock.now = new Date('2026-08-17T14:06:00.000Z');
  await assert.rejects(
    scenario.service.admit({
      policyId: scenario.policy.policy_id,
      envelope: scenario.signAttestation('external_g5_release', { issuedAt: '2026-08-17T14:06:00.000Z' }),
      actor: 'Leoz',
      assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
    }),
    hasCode('g5_not_current_go'),
  );
});

test('later G7 incident state invalidates the bound Phase 5 package before admission', async () => {
  const scenario = await createExternalEvidenceScenario(db, 'upstream-incident');
  await scenario.assurance.bounded.repository.openControlIncident({
    policy: scenario.assurance.bounded.policyRecord!,
    actor: 'Leoz',
    reasonCode: 'phase6_upstream_incident_opened',
    evidenceFingerprint: externalEvidenceFingerprint({ incident: 'phase6-upstream' }),
    occurredAt: scenario.assurance.bounded.supervised.clock.now.toISOString(),
  });
  await assert.rejects(
    scenario.service.admit({
      policyId: scenario.policy.policy_id,
      envelope: scenario.signAttestation('external_g5_release'),
      actor: 'Leoz',
      assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
    }),
    hasCode('phase5_state_changed'),
  );
});

test('Phase 6 rows are immutable and raw credentials/private keys are never persisted', async () => {
  const scenario = await createExternalEvidenceScenario(db, 'immutability');
  const admitted = await scenario.service.admit({
    policyId: scenario.policy.policy_id,
    envelope: scenario.signAttestation('external_g5_release'),
    actor: 'Leoz',
    assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
  });
  const assessment = await scenario.service.assess({
    policyId: scenario.policy.policy_id,
    assessmentKey: 'phase6:immutability:assessment:0001',
    actor: 'Leoz',
    assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
  });
  await assert.rejects(db(PHASE6_TABLES.policies).where({ id: scenario.policyRecord!.id }).delete(), /immutable/);
  await assert.rejects(db(PHASE6_TABLES.attestations).where({ id: admitted.id }).update({ statement: 'revoke' }), /immutable/);
  await assert.rejects(db(PHASE6_TABLES.assessments).where({ id: assessment.id }).update({ status: 'complete_unreleased' }), /immutable/);
  const events = await scenario.repository.listEvents(scenario.policyRecord!.id);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
  await assert.rejects(db(PHASE6_TABLES.events).where({ id: events[0].id }).delete(), /immutable/);

  const dump = [
    ...(await db(PHASE6_TABLES.policies).select('*')),
    ...(await db(PHASE6_TABLES.attestations).select('*')),
    ...(await db(PHASE6_TABLES.assessments).select('*')),
    ...(await db(PHASE6_TABLES.events).select('*')),
  ].map((row) => JSON.stringify(row)).join('\n');
  assert.equal(dump.includes(PHASE6_AUTHORITY_CREDENTIAL), false);
  assert.equal(dump.includes(PHASE6_ASSESSOR_CREDENTIAL), false);
  for (const role of PHASE6_ISSUER_ROLES) {
    const privatePem = scenario.keys[role].privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    assert.equal(dump.includes(privatePem), false);
  }
});

test('Phase 6 implementation contains no network, scheduler, or release execution primitive', () => {
  const files = [
    'src/domain/externalEvidence.ts',
    'src/domain/externalEvidencePolicy.ts',
    'src/repositories/externalEvidenceRepository.ts',
    'src/services/externalEvidenceService.ts',
  ];
  const source = files.map((file) => fs.readFileSync(path.resolve(file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /\b(fetch|axios|request|setInterval|setTimeout|child_process|execFile|spawn)\s*\(/);
  assert.doesNotMatch(source, /register\s*\([^)]*production|activate\s*\(|promote\s*\(|release\s*\(/i);
});

test('directly inserted corrupt Phase 6 evidence fails closed on read', async () => {
  const scenario = await createExternalEvidenceScenario(db, 'corruption');
  const assessment = await scenario.service.assess({
    policyId: scenario.policy.policy_id,
    assessmentKey: 'phase6:corruption:assessment:0001',
    actor: 'Leoz',
    assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
  });
  await db(PHASE6_TABLES.assessments).insert({
    ...assessment,
    id: '51000000-0000-4000-8000-000000000001',
    assessment_key: 'phase6:corruption:assessment:0002',
    matrix_json: '{}',
    matrix_fingerprint: externalEvidenceFingerprint({}),
    assessed_at: '2026-08-17T14:06:00.000Z',
    assessment_fingerprint: externalEvidenceFingerprint({ corrupt: 'phase6-assessment' }),
    created_at: '2026-08-17T14:06:00.000Z',
  });
  await assert.rejects(
    scenario.repository.latestAssessment(scenario.policyRecord!.id),
    /stored evidence matrix is invalid/,
  );
});
