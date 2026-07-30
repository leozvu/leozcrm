import fs from 'node:fs';
import path from 'node:path';
import { db } from './db/knex';
import {
  PHASE5_EXTERNAL_BLOCKERS,
  operationalAssurancePolicyIsActive,
} from './domain/operationalAssurance';
import {
  OperationalAssurancePolicyManifest,
  operationalAssurancePolicyFingerprint,
  validateOperationalAssurancePolicy,
} from './domain/operationalAssurancePolicy';
import { buildActionAdapterRegistry } from './integrations/actions/buildActionAdapterRegistry';
import { OperationalAssuranceRepository } from './repositories/operationalAssuranceRepository';

export function phase5RuntimeIdentityIssues(
  policy: OperationalAssurancePolicyManifest,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const expected = {
    LEOZOPS_PHASE5_ENVIRONMENT: policy.environment,
    LEOZOPS_PHASE5_POLICY_SHA256: operationalAssurancePolicyFingerprint(policy),
    LEOZOPS_PHASE5_G7_POLICY_SHA256: policy.g7_policy.policy_fingerprint,
    LEOZOPS_PHASE5_AUTHORITY_CREDENTIAL_SHA256: policy.identities.authority_credential_sha256,
    LEOZOPS_PHASE5_ASSESSOR_CREDENTIAL_SHA256: policy.identities.assessor_credential_sha256,
    LEOZOPS_PHASE5_REVIEWER_CREDENTIAL_SHA256: policy.identities.reviewer_credential_sha256,
  };
  return Object.entries(expected).flatMap(([key, expectedValue]) => {
    const actual = environment[key];
    if (!actual) return [`${key} is required`];
    return actual === expectedValue ? [] : [`${key} does not match the accepted policy`];
  });
}

async function main(): Promise<void> {
  const file = path.resolve(process.argv[2] ?? 'config/phase5.operational-assurance-policy.example.json');
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.error(JSON.stringify({ status: 'blocked', issues: ['policy file is unreadable or invalid JSON'] }, null, 2));
    process.exitCode = 2;
    return;
  }
  const initial = validateOperationalAssurancePolicy(raw);
  if (!initial.ok || !initial.value || !initial.fingerprint) {
    console.error(JSON.stringify({ status: 'blocked', issues: initial.issues }, null, 2));
    process.exitCode = 2;
    return;
  }
  const repository = new OperationalAssuranceRepository(db);
  const issues: string[] = [];
  let g7;
  try {
    g7 = await repository.findG7Policy(initial.value.g7_policy.policy_id);
  } catch {
    issues.push('exact bound G7 policy does not exist');
  }
  if (g7) issues.push(...validateOperationalAssurancePolicy(raw, g7.manifest, g7.g6.manifest).issues);
  if (!operationalAssurancePolicyIsActive(initial.value, new Date().toISOString())) {
    issues.push('Phase 5 policy is not active at the current time');
  }
  issues.push(...phase5RuntimeIdentityIssues(initial.value));
  if (buildActionAdapterRegistry().size() !== 0) issues.push('production action-adapter registry is not empty');
  let stored;
  try {
    stored = await repository.findPolicy(initial.value.policy_id);
    if (stored.record.policy_fingerprint !== initial.fingerprint) issues.push('stored Phase 5 policy fingerprint does not match');
  } catch {
    issues.push('exact accepted Phase 5 policy does not exist');
  }
  const assessment = stored ? await repository.latestAssessment(stored.record.id) : null;
  if (!assessment || assessment.local_status !== 'pass') issues.push('latest local assurance assessment is not passing');
  const releasePackage = stored ? await repository.latestReleasePackage(stored.record.id) : null;
  if (!releasePackage || releasePackage.release_status !== 'blocked_external') {
    issues.push('immutable blocked-external release package does not exist');
  }
  console.error(JSON.stringify({
    status: 'blocked_external',
    policy_id: initial.value.policy_id,
    policy_fingerprint: initial.fingerprint,
    local_issues: [...new Set(issues)],
    external_blockers: PHASE5_EXTERNAL_BLOCKERS,
    release_possible: false,
  }, null, 2));
  process.exitCode = 2;
}

if (require.main === module) {
  main().catch(() => {
    console.error(JSON.stringify({ status: 'blocked', issues: ['Phase 5 preflight failed safely'] }, null, 2));
    process.exitCode = 2;
  }).finally(() => db.destroy());
}
