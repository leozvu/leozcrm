import fs from 'node:fs';
import path from 'node:path';
import { db } from './db/knex';
import { externalEvidencePolicyIsActive } from './domain/externalEvidence';
import {
  ExternalEvidencePolicyManifest,
  PHASE6_ISSUER_ROLES,
  externalEvidencePolicyFingerprint,
  validateExternalEvidencePolicy,
} from './domain/externalEvidencePolicy';
import { buildActionAdapterRegistry } from './integrations/actions/buildActionAdapterRegistry';
import { ExternalEvidenceRepository } from './repositories/externalEvidenceRepository';

export function phase6RuntimeIdentityIssues(
  policy: ExternalEvidencePolicyManifest,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const expected: Record<string, string> = {
    LEOZOPS_PHASE6_ENVIRONMENT: policy.environment,
    LEOZOPS_PHASE6_POLICY_SHA256: externalEvidencePolicyFingerprint(policy),
    LEOZOPS_PHASE6_PHASE5_POLICY_SHA256: policy.phase5.policy_fingerprint,
    LEOZOPS_PHASE6_PHASE5_PACKAGE_SHA256: policy.phase5.release_package_fingerprint,
    LEOZOPS_PHASE6_AUTHORITY_CREDENTIAL_SHA256: policy.identities.authority_credential_sha256,
    LEOZOPS_PHASE6_ASSESSOR_CREDENTIAL_SHA256: policy.identities.assessor_credential_sha256,
  };
  for (const role of PHASE6_ISSUER_ROLES) {
    expected[`LEOZOPS_PHASE6_${role.toUpperCase()}_PUBLIC_KEY_SHA256`] = policy.issuers[role].public_key_sha256;
  }
  return Object.entries(expected).flatMap(([key, expectedValue]) => {
    const actual = environment[key];
    if (!actual) return [`${key} is required`];
    return actual === expectedValue ? [] : [`${key} does not match the accepted policy`];
  });
}

async function main(): Promise<void> {
  const file = path.resolve(process.argv[2] ?? 'config/phase6.external-evidence-policy.example.json');
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.error(JSON.stringify({ status: 'blocked', issues: ['policy file is unreadable or invalid JSON'] }, null, 2));
    process.exitCode = 2;
    return;
  }
  const initial = validateExternalEvidencePolicy(raw);
  if (!initial.ok || !initial.value || !initial.fingerprint) {
    console.error(JSON.stringify({ status: 'blocked', issues: initial.issues }, null, 2));
    process.exitCode = 2;
    return;
  }
  const repository = new ExternalEvidenceRepository(db);
  const issues: string[] = [];
  let phase5;
  try {
    phase5 = await repository.findPhase5Policy(initial.value.phase5.policy_id);
  } catch {
    issues.push('exact bound Phase 5 policy does not exist');
  }
  if (phase5) {
    issues.push(...validateExternalEvidencePolicy(raw, phase5.manifest, phase5.g7.manifest, phase5.g7.g6.manifest).issues);
    const assessment = await repository.latestPhase5Assessment(phase5.record.id);
    if (!assessment || assessment.local_status !== 'pass' || assessment.assessment_fingerprint !== initial.value.phase5.assessment_fingerprint) {
      issues.push('exact latest passing Phase 5 assessment does not exist');
    }
    const releasePackage = await repository.latestPhase5ReleasePackage(phase5.record.id);
    if (!releasePackage || releasePackage.release_status !== 'blocked_external' || releasePackage.package_fingerprint !== initial.value.phase5.release_package_fingerprint) {
      issues.push('exact immutable blocked-external Phase 5 package does not exist');
    }
  }
  if (!externalEvidencePolicyIsActive(initial.value, new Date().toISOString())) {
    issues.push('Phase 6 policy is not active at the current time');
  }
  issues.push(...phase6RuntimeIdentityIssues(initial.value));
  if (buildActionAdapterRegistry().size() !== 0) issues.push('production action-adapter registry is not empty');
  let stored;
  try {
    stored = await repository.findPolicy(initial.value.policy_id);
    if (stored.record.policy_fingerprint !== initial.fingerprint) issues.push('stored Phase 6 policy fingerprint does not match');
  } catch {
    issues.push('exact accepted Phase 6 policy does not exist');
  }
  const latest = stored ? await repository.latestAssessment(stored.record.id) : null;
  console.error(JSON.stringify({
    status: issues.length ? 'blocked' : 'admission_ready_unreleased',
    policy_id: initial.value.policy_id,
    policy_fingerprint: initial.fingerprint,
    issues: [...new Set(issues)],
    matrix_status: latest?.status ?? 'not_assessed',
    release_status: 'blocked_external_activation',
    release_possible: false,
    activation_possible: false,
  }, null, 2));
  process.exitCode = 2;
}

if (require.main === module) {
  main().catch(() => {
    console.error(JSON.stringify({ status: 'blocked', issues: ['Phase 6 preflight failed safely'] }, null, 2));
    process.exitCode = 2;
  }).finally(() => db.destroy());
}
