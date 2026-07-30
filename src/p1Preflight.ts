import fs from 'node:fs';
import path from 'node:path';
import { p1DecisionSummary, validateP1Decision } from './domain/p1Decision';
import { p1DecisionFingerprint } from './domain/phase2Proof';

function blocked(reason: string, issues: string[] = []): never {
  console.error('P1 preflight: BLOCKED');
  console.error(reason);
  for (const issue of issues) console.error(`- ${issue}`);
  console.error('No deployment, provisioning, credential, flag, or scheduler action is authorized.');
  process.exit(2);
}

function main(): void {
  const input = process.argv[2];
  if (!input) {
    blocked('Usage: npm run p1:preflight -- <decision-manifest.json>');
  }

  const manifestPath = path.resolve(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    blocked('The decision manifest could not be read as JSON.');
  }

  const result = validateP1Decision(parsed);
  if (!result.ok || !result.manifest) {
    blocked('The decision manifest is incomplete or unsafe.', result.issues);
  }

  console.log('P1 preflight: PASS');
  console.log(JSON.stringify({
    ...p1DecisionSummary(result.manifest),
    decision_fingerprint: p1DecisionFingerprint(result.manifest),
  }, null, 2));
  console.log('This validates the recorded decision only; it does not perform or authorize external actions.');
}

main();
