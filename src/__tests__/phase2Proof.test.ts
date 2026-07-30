import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evidenceFingerprint,
  validateCheckpointBEvidence,
  validateP2Decision,
  validatePhase2Authorization,
} from '../domain/phase2Proof';
import {
  validCheckpointB,
  validP1Decision,
  validP2Decision,
} from './support/phase2Scenario';

test('Checkpoint B and P2 form a fingerprint-bound, fail-closed authorization chain', () => {
  const p1 = validP1Decision();
  const checkpoint = validCheckpointB(p1);
  const p2 = validP2Decision(p1, checkpoint);

  assert.equal(validateCheckpointBEvidence(checkpoint, p1).ok, true);
  assert.equal(validateP2Decision(p2, p1, checkpoint).ok, true);
  assert.deepEqual(validatePhase2Authorization({ environment: 'test', p1 }).value, {
    environment: 'test',
    authorization_id: p1.decision_id,
  });
  assert.deepEqual(validatePhase2Authorization({
    environment: 'production',
    p1,
    checkpointB: checkpoint,
    p2,
  }).value, {
    environment: 'production',
    authorization_id: p2.decision_id,
  });
});

test('production remains blocked without both external checkpoints', () => {
  const result = validatePhase2Authorization({
    environment: 'production',
    p1: validP1Decision(),
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.join(' '), /Checkpoint B.*P2/);
});

test('tampering with a P1 identity or Checkpoint B proof invalidates P2', () => {
  const p1 = validP1Decision();
  const checkpoint = validCheckpointB(p1);
  const p2 = validP2Decision(p1, checkpoint);
  const changedP1 = structuredClone(p1);
  changedP1.runtime.production.project_id = 'different-production-runtime';
  const badP1 = validateP2Decision(p2, changedP1, checkpoint);
  assert.equal(badP1.ok, false);
  assert.match(badP1.issues.join(' '), /fingerprint|runtime/);

  const changedCheckpoint = structuredClone(checkpoint);
  changedCheckpoint.deployment.revision = 'git-fedcba9';
  const badCheckpoint = validateP2Decision(p2, p1, changedCheckpoint);
  assert.equal(badCheckpoint.ok, false);
  assert.match(badCheckpoint.issues.join(' '), /fingerprint/);
  assert.notEqual(evidenceFingerprint(changedCheckpoint), evidenceFingerprint(checkpoint));
});

test('Checkpoint B rejects any non-GET/body/mutation/PII/secret claim', () => {
  const p1 = validP1Decision();
  const checkpoint: any = validCheckpointB(p1);
  checkpoint.source_request_methods = ['POST'];
  checkpoint.source_request_bodies = 1;
  checkpoint.source_mutation_count = 1;
  checkpoint.pii_findings = 1;
  checkpoint.secret_findings = 1;
  const result = validateCheckpointBEvidence(checkpoint, p1);
  assert.equal(result.ok, false);
  assert.match(result.issues.join(' '), /GET|zero/);
});
