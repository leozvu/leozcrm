import fs from 'node:fs';
import path from 'node:path';
import {
  evidenceFingerprint,
  validateCheckpointBEvidence,
  validateP2Decision,
} from './domain/phase2Proof';

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function blocked(reason: string, issues: string[] = []): never {
  console.error('Phase 2 preflight: BLOCKED');
  console.error(reason);
  for (const issue of issues) console.error(`- ${issue}`);
  console.error('No deployment, credential, feature flag, scheduler, or production action was performed.');
  process.exit(2);
}

function main(): void {
  const [command, ...files] = process.argv.slice(2);
  try {
    if (command === 'checkpoint-b') {
      if (files.length !== 2) blocked('Usage: phase2:preflight checkpoint-b <p1.json> <checkpoint-b.json>');
      const p1 = readJson(files[0]);
      const result = validateCheckpointBEvidence(readJson(files[1]), p1);
      if (!result.ok || !result.value) blocked('Checkpoint B evidence is incomplete or unsafe.', result.issues);
      console.log('Phase 2 Checkpoint B preflight: PASS');
      console.log(JSON.stringify({
        evidence_id: result.value.evidence_id,
        fingerprint: evidenceFingerprint(result.value),
        verdict: result.value.verdict,
      }, null, 2));
      return;
    }
    if (command === 'p2') {
      if (files.length !== 3) blocked('Usage: phase2:preflight p2 <p1.json> <checkpoint-b.json> <p2.json>');
      const p1 = readJson(files[0]);
      const checkpoint = readJson(files[1]);
      const result = validateP2Decision(readJson(files[2]), p1, checkpoint);
      if (!result.ok || !result.value) blocked('P2 decision is incomplete or unsafe.', result.issues);
      console.log('Phase 2 P2 preflight: PASS');
      console.log(JSON.stringify({
        decision_id: result.value.decision_id,
        fingerprint: evidenceFingerprint(result.value),
        scope: result.value.scope,
        verdict: result.value.verdict,
      }, null, 2));
      return;
    }
  } catch {
    blocked('One or more manifests could not be read as JSON.');
  }
  blocked('Command must be checkpoint-b or p2.');
}

main();
