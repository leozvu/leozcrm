import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import knexFactory from 'knex';
import config from '../../knexfile';
import {
  OperationalAssuranceError,
  PHASE5_EXTERNAL_BLOCKERS,
  PHASE5_TABLES,
  assuranceFingerprint,
} from '../domain/operationalAssurance';
import { validateOperationalAssurancePolicy } from '../domain/operationalAssurancePolicy';
import { actionFingerprint } from '../domain/supervisedAction';
import { buildActionAdapterRegistry } from '../integrations/actions/buildActionAdapterRegistry';
import {
  PHASE5_ASSESSOR_CREDENTIAL,
  PHASE5_AUTHORITY_CREDENTIAL,
  PHASE5_REVIEWER_CREDENTIAL,
  createOperationalAssuranceScenario,
  preparePassingAssuranceEvidence,
} from './support/operationalAssuranceScenario';

const db = knexFactory(config.test);

before(async () => {
  await db.migrate.latest();
});

after(async () => {
  await db.destroy();
});

function hasCode(code: string) {
  return (error: unknown) => error instanceof OperationalAssuranceError && error.code === code;
}

test('Phase 5 policy is exact, credential-separated, local-only, and production composition remains empty', async () => {
  assert.equal(buildActionAdapterRegistry().size(), 0);
  const scenario = await createOperationalAssuranceScenario(db, 'policy-contract', { acceptPolicy: false });
  const valid = validateOperationalAssurancePolicy(
    scenario.policy,
    scenario.bounded.policy,
    scenario.bounded.supervised.policy,
  );
  assert.equal(valid.ok, true);
  assert.match(valid.fingerprint!, /^sha256:[0-9a-f]{64}$/);

  const extra = structuredClone(scenario.policy) as any;
  extra.release = true;
  assert.match(validateOperationalAssurancePolicy(extra).issues.join('\n'), /release is not allowed/);

  const waiver = structuredClone(scenario.policy) as any;
  waiver.safety.waivers_allowed = true;
  assert.match(validateOperationalAssurancePolicy(waiver).issues.join('\n'), /waivers_allowed must equal false/);

  const shared = structuredClone(scenario.policy);
  shared.identities.assessor_credential_sha256 = shared.identities.authority_credential_sha256;
  assert.match(validateOperationalAssurancePolicy(shared).issues.join('\n'), /credentials must be different/);

  const upstream = structuredClone(scenario.policy);
  upstream.identities.reviewer_credential_sha256 = scenario.bounded.policy.identities.release_credential_sha256;
  assert.match(
    validateOperationalAssurancePolicy(upstream, scenario.bounded.policy, scenario.bounded.supervised.policy).issues.join('\n'),
    /differ from every G7 credential/,
  );
});

test('acceptance requires the exact G7 binding, current upstream authority, and authority credential', async () => {
  const scenario = await createOperationalAssuranceScenario(db, 'acceptance', { acceptPolicy: false });
  await assert.rejects(scenario.service.acceptPolicy(scenario.policy, 'wrong-credential'), hasCode('assurance_authority_credential_rejected'));
  const drifted = structuredClone(scenario.policy);
  drifted.g7_policy.policy_fingerprint = actionFingerprint('different-g7');
  await assert.rejects(scenario.service.acceptPolicy(drifted, PHASE5_AUTHORITY_CREDENTIAL), hasCode('invalid_assurance_policy'));
  const accepted = await scenario.service.acceptPolicy(scenario.policy, PHASE5_AUTHORITY_CREDENTIAL);
  assert.equal(accepted.g7_policy_record_id, scenario.bounded.policyRecord!.id);
  assert.equal(accepted.g7_policy_fingerprint, scenario.bounded.policyRecord!.policy_fingerprint);
});

test('assessment derives missing local evidence from the database and fails closed', async () => {
  const scenario = await createOperationalAssuranceScenario(db, 'missing-evidence');
  const result = await scenario.service.assess({
    policyId: scenario.policy.policy_id,
    assessmentKey: 'phase5:missing-evidence:0001',
    actor: 'Leoz',
    assessorCredential: PHASE5_ASSESSOR_CREDENTIAL,
  });
  assert.equal(result.local_status, 'fail');
  assert.equal(result.external_status, 'blocked_external');
  const checks = JSON.parse(result.checks_json) as Array<{ code: string; passed: boolean }>;
  assert.equal(checks.find((check) => check.code === 'successful_execution_threshold')?.passed, false);
  assert.equal(checks.find((check) => check.code === 'successful_human_recovery')?.passed, false);
  assert.equal(checks.find((check) => check.code === 'resolved_incident_halt_drill')?.passed, false);
  await assert.rejects(
    scenario.service.createReleasePackage({
      policyId: scenario.policy.policy_id,
      assessmentKey: result.assessment_key,
      packageKey: 'phase5:package:missing:0001',
      actor: 'Leoz',
      reviewerCredential: PHASE5_REVIEWER_CREDENTIAL,
    }),
    hasCode('local_assurance_not_passed'),
  );
});

test('passing local evidence produces an immutable package that remains externally blocked', async () => {
  const scenario = await createOperationalAssuranceScenario(db, 'local-pass');
  await preparePassingAssuranceEvidence(scenario);
  const assessment = await scenario.service.assess({
    policyId: scenario.policy.policy_id,
    assessmentKey: 'phase5:local-pass:assessment:0001',
    actor: 'Leoz',
    assessorCredential: PHASE5_ASSESSOR_CREDENTIAL,
  });
  assert.equal(assessment.local_status, 'pass');
  assert.deepEqual(JSON.parse(assessment.external_blockers_json), PHASE5_EXTERNAL_BLOCKERS);
  await assert.rejects(
    scenario.service.createReleasePackage({
      policyId: scenario.policy.policy_id,
      assessmentKey: assessment.assessment_key,
      packageKey: 'phase5:local-pass:wrong-reviewer:0001',
      actor: 'Leoz',
      reviewerCredential: 'wrong-reviewer-credential',
    }),
    hasCode('release_reviewer_credential_rejected'),
  );
  const release = await scenario.service.createReleasePackage({
    policyId: scenario.policy.policy_id,
    assessmentKey: assessment.assessment_key,
    packageKey: 'phase5:local-pass:package:0001',
    actor: 'Leoz',
    reviewerCredential: PHASE5_REVIEWER_CREDENTIAL,
  });
  assert.equal(release.local_status, 'pass');
  assert.equal(release.release_status, 'blocked_external');
  assert.deepEqual(JSON.parse(release.external_blockers_json), PHASE5_EXTERNAL_BLOCKERS);
  assert.equal((await scenario.service.status(scenario.policy.policy_id)).external_release_possible, false);
});

test('assessment and release packaging replay immutable evidence without duplicate events', async () => {
  const scenario = await createOperationalAssuranceScenario(db, 'idempotency');
  await preparePassingAssuranceEvidence(scenario);
  const input = {
    policyId: scenario.policy.policy_id,
    assessmentKey: 'phase5:idempotent:assessment:0001',
    actor: 'Leoz',
    assessorCredential: PHASE5_ASSESSOR_CREDENTIAL,
  };
  const first = await scenario.service.assess(input);
  const replay = await scenario.service.assess(input);
  assert.equal(replay.id, first.id);
  const packageInput = {
    policyId: scenario.policy.policy_id,
    assessmentKey: first.assessment_key,
    packageKey: 'phase5:idempotent:package:0001',
    actor: 'Leoz',
    reviewerCredential: PHASE5_REVIEWER_CREDENTIAL,
  };
  const packaged = await scenario.service.createReleasePackage(packageInput);
  assert.equal((await scenario.service.createReleasePackage(packageInput)).id, packaged.id);
  scenario.bounded.supervised.clock.now = new Date('2026-08-17T14:06:00.000Z');
  assert.equal((await scenario.service.assess(input)).id, first.id);
  assert.equal(Number((await db(PHASE5_TABLES.assessments).where({ policy_record_id: scenario.policyRecord!.id }).count<{ count: number | string }[]>({ count: '*' }))[0].count), 1);
  assert.equal(Number((await db(PHASE5_TABLES.releasePackages).where({ policy_record_id: scenario.policyRecord!.id }).count<{ count: number | string }[]>({ count: '*' }))[0].count), 1);
  assert.equal((await scenario.repository.listEvents(scenario.policyRecord!.id)).length, 3);
});

test('a later G5 revoke is reflected as a failed local assessment', async () => {
  const scenario = await createOperationalAssuranceScenario(db, 'g5-revoke');
  await preparePassingAssuranceEvidence(scenario);
  const revokeCore = {
    tenant_id: scenario.bounded.supervised.seeded.tenant.id,
    source_connection_id: scenario.bounded.supervised.seeded.connection.id,
    authorization_id: 'P2-phase5-g5-revoke',
    decision: 'revoke' as const,
    decided_by: 'Leoz',
    decided_at: '2026-08-17T14:06:00.000Z',
    evaluation_fingerprint: actionFingerprint({ verdict: 'phase5_revoke' }),
    reason_code: 'phase5_g5_revoked',
    extend_until_business_date: null,
  };
  await scenario.bounded.supervised.shadow.recordReleaseDecision({ ...revokeCore, evidence_key: actionFingerprint(revokeCore) });
  scenario.bounded.supervised.clock.now = new Date('2026-08-17T14:07:00.000Z');
  const result = await scenario.service.assess({
    policyId: scenario.policy.policy_id,
    assessmentKey: 'phase5:g5-revoke:assessment:0001',
    actor: 'Leoz',
    assessorCredential: PHASE5_ASSESSOR_CREDENTIAL,
  });
  assert.equal(result.local_status, 'fail');
  assert.equal((JSON.parse(result.facts_json) as any).g5_current_go, false);
});

test('release packaging rechecks current G5 and rejects a previously passing assessment after revoke', async () => {
  const scenario = await createOperationalAssuranceScenario(db, 'package-revoke');
  await preparePassingAssuranceEvidence(scenario);
  const assessment = await scenario.service.assess({
    policyId: scenario.policy.policy_id,
    assessmentKey: 'phase5:package-revoke:assessment:0001',
    actor: 'Leoz',
    assessorCredential: PHASE5_ASSESSOR_CREDENTIAL,
  });
  const revokeCore = {
    tenant_id: scenario.bounded.supervised.seeded.tenant.id,
    source_connection_id: scenario.bounded.supervised.seeded.connection.id,
    authorization_id: 'P2-phase5-package-revoke',
    decision: 'revoke' as const,
    decided_by: 'Leoz',
    decided_at: '2026-08-17T14:06:00.000Z',
    evaluation_fingerprint: actionFingerprint({ verdict: 'phase5_package_revoke' }),
    reason_code: 'phase5_package_g5_revoked',
    extend_until_business_date: null,
  };
  await scenario.bounded.supervised.shadow.recordReleaseDecision({ ...revokeCore, evidence_key: actionFingerprint(revokeCore) });
  scenario.bounded.supervised.clock.now = new Date('2026-08-17T14:07:00.000Z');
  await assert.rejects(
    scenario.service.createReleasePackage({
      policyId: scenario.policy.policy_id,
      assessmentKey: assessment.assessment_key,
      packageKey: 'phase5:package-revoke:package:0001',
      actor: 'Leoz',
      reviewerCredential: PHASE5_REVIEWER_CREDENTIAL,
    }),
    hasCode('assurance_state_changed'),
  );
});

test('release packaging rejects an assessment outside the configured freshness window', async () => {
  const scenario = await createOperationalAssuranceScenario(db, 'package-stale');
  await preparePassingAssuranceEvidence(scenario);
  const assessment = await scenario.service.assess({
    policyId: scenario.policy.policy_id,
    assessmentKey: 'phase5:package-stale:assessment:0001',
    actor: 'Leoz',
    assessorCredential: PHASE5_ASSESSOR_CREDENTIAL,
  });
  scenario.bounded.supervised.clock.now = new Date('2026-08-17T14:21:00.000Z');
  await assert.rejects(
    scenario.service.createReleasePackage({
      policyId: scenario.policy.policy_id,
      assessmentKey: assessment.assessment_key,
      packageKey: 'phase5:package-stale:package:0001',
      actor: 'Leoz',
      reviewerCredential: PHASE5_REVIEWER_CREDENTIAL,
    }),
    hasCode('assessment_stale'),
  );
});

test('an open incident and released kill switch are database-derived failures', async () => {
  const scenario = await createOperationalAssuranceScenario(db, 'safety-state');
  const opened = await scenario.bounded.repository.openControlIncident({
    policy: scenario.bounded.policyRecord!,
    actor: 'Leoz',
    reasonCode: 'phase5_open_incident_test',
    evidenceFingerprint: assuranceFingerprint('phase5-open-incident'),
    occurredAt: scenario.bounded.supervised.clock.now.toISOString(),
  });
  assert.equal(opened.killSwitch.state, 'engaged');
  const result = await scenario.service.assess({
    policyId: scenario.policy.policy_id,
    assessmentKey: 'phase5:safety-state:assessment:0001',
    actor: 'Leoz',
    assessorCredential: PHASE5_ASSESSOR_CREDENTIAL,
  });
  const checks = JSON.parse(result.checks_json) as Array<{ code: string; passed: boolean }>;
  assert.equal(checks.find((check) => check.code === 'no_open_incident')?.passed, false);
  assert.equal(result.local_status, 'fail');
});

test('all Phase 5 facts are database-immutable and event order is monotonic', async () => {
  const scenario = await createOperationalAssuranceScenario(db, 'immutability');
  const assessment = await scenario.service.assess({
    policyId: scenario.policy.policy_id,
    assessmentKey: 'phase5:immutability:assessment:0001',
    actor: 'Leoz',
    assessorCredential: PHASE5_ASSESSOR_CREDENTIAL,
  });
  await assert.rejects(db(PHASE5_TABLES.policies).where({ id: scenario.policyRecord!.id }).delete(), /immutable/);
  await assert.rejects(db(PHASE5_TABLES.assessments).where({ id: assessment.id }).update({ local_status: 'pass' }), /immutable/);
  const events = await scenario.repository.listEvents(scenario.policyRecord!.id);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2]);
  await assert.rejects(db(PHASE5_TABLES.events).where({ id: events[0].id }).update({ reason_code: 'rewritten' }), /immutable/);
});

test('raw Phase 5 credentials are never persisted', async () => {
  const scenario = await createOperationalAssuranceScenario(db, 'secret-absence');
  await scenario.service.assess({
    policyId: scenario.policy.policy_id,
    assessmentKey: 'phase5:secret-absence:assessment:0001',
    actor: 'Leoz',
    assessorCredential: PHASE5_ASSESSOR_CREDENTIAL,
  });
  const dump = [
    ...(await db(PHASE5_TABLES.policies).select('*')),
    ...(await db(PHASE5_TABLES.assessments).select('*')),
    ...(await db(PHASE5_TABLES.events).select('*')),
  ].map((row) => JSON.stringify(row)).join('\n');
  for (const secret of [PHASE5_AUTHORITY_CREDENTIAL, PHASE5_ASSESSOR_CREDENTIAL, PHASE5_REVIEWER_CREDENTIAL]) {
    assert.equal(dump.includes(secret), false);
  }
});

test('inserted corrupt assessment evidence fails closed on read', async () => {
  const scenario = await createOperationalAssuranceScenario(db, 'corruption');
  await db(PHASE5_TABLES.assessments).insert({
    id: '7e39d9bd-0d4e-4b25-b3a7-a7856d6b11d1',
    tenant_id: scenario.policyRecord!.tenant_id,
    policy_record_id: scenario.policyRecord!.id,
    assessment_key: 'phase5:corrupt:assessment:0001',
    policy_fingerprint: scenario.policyRecord!.policy_fingerprint,
    g7_policy_fingerprint: scenario.policyRecord!.g7_policy_fingerprint,
    facts_json: '{}',
    facts_fingerprint: assuranceFingerprint({}),
    checks_json: '[]',
    local_status: 'pass',
    external_status: 'blocked_external',
    external_blockers_json: JSON.stringify(PHASE5_EXTERNAL_BLOCKERS),
    assessed_by: 'Leoz',
    assessed_at: '2026-08-17T14:00:00.000Z',
    assessment_fingerprint: assuranceFingerprint('corrupt-assessment'),
    created_at: '2026-08-17T14:00:00.000Z',
  });
  await assert.rejects(scenario.repository.latestAssessment(scenario.policyRecord!.id), /stored object keys are invalid/);
});
