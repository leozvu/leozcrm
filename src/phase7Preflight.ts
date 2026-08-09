import fs from 'node:fs';
import path from 'node:path';
import { db } from './db/knex';
import { activationCeremonyPolicyIsActive } from './domain/activationCeremony';
import {
  ActivationCeremonyPolicyManifest,
  activationCeremonyPolicyFingerprint,
  validateActivationCeremonyPolicy,
} from './domain/activationCeremonyPolicy';
import { buildActionAdapterRegistry } from './integrations/actions/buildActionAdapterRegistry';
import { ActivationCeremonyRepository } from './repositories/activationCeremonyRepository';
import { ExternalEvidenceRepository } from './repositories/externalEvidenceRepository';
import { ActivationCeremonyService } from './services/activationCeremonyService';
import { ExternalEvidenceService } from './services/externalEvidenceService';

export function phase7RuntimeIdentityIssues(
  policy: ActivationCeremonyPolicyManifest,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const expected: Record<string, string> = {
    LEOZOPS_PHASE7_ENVIRONMENT: policy.environment,
    LEOZOPS_PHASE7_POLICY_SHA256: activationCeremonyPolicyFingerprint(policy),
    LEOZOPS_PHASE7_PHASE6_POLICY_SHA256: policy.phase6.policy_fingerprint,
    LEOZOPS_PHASE7_PHASE6_ASSESSMENT_SHA256: policy.phase6.assessment_fingerprint,
    LEOZOPS_PHASE7_TARGET_SHA256: policy.target.target_fingerprint,
    LEOZOPS_PHASE7_ADAPTER_ARTIFACT_SHA256: policy.target.adapter_artifact_digest,
    LEOZOPS_PHASE7_CONFIGURATION_SHA256: policy.target.configuration_digest,
    LEOZOPS_PHASE7_CREDENTIAL_REFERENCE_SHA256: policy.target.credential_reference_sha256,
    LEOZOPS_PHASE7_ROLLBACK_ARTIFACT_SHA256: policy.rollback.rollback_artifact_digest,
    LEOZOPS_PHASE7_ROLLBACK_PROCEDURE_SHA256: policy.rollback.procedure_digest,
    LEOZOPS_PHASE7_AUTHORITY_CREDENTIAL_SHA256: policy.identities.authority_credential_sha256,
    LEOZOPS_PHASE7_VERIFIER_CREDENTIAL_SHA256: policy.identities.verifier_credential_sha256,
    LEOZOPS_PHASE7_OPERATOR_CREDENTIAL_SHA256: policy.identities.operator_credential_sha256,
  };
  return Object.entries(expected).flatMap(([key, expectedValue]) => {
    const actual = environment[key];
    if (!actual) return [`${key} is required`];
    return actual === expectedValue ? [] : [`${key} does not match the accepted policy`];
  });
}

async function main(): Promise<void> {
  const file = path.resolve(process.argv[2] ?? 'config/phase7.activation-ceremony-policy.example.json');
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.error(JSON.stringify({ status: 'blocked', issues: ['policy file is unreadable or invalid JSON'] }, null, 2));
    process.exitCode = 2;
    return;
  }
  const initial = validateActivationCeremonyPolicy(raw);
  const issues = [...initial.issues];
  let stored: Awaited<ReturnType<ActivationCeremonyRepository['findPolicy']>> | undefined;
  let readiness: Awaited<ReturnType<ActivationCeremonyService['readiness']>> | undefined;
  if (initial.value && initial.fingerprint) {
    const repository = new ActivationCeremonyRepository(db);
    const externalRepository = new ExternalEvidenceRepository(db);
    const registry = buildActionAdapterRegistry();
    try {
      const phase6 = await repository.findPhase6Policy(initial.value.phase6.policy_id);
      issues.push(...validateActivationCeremonyPolicy(
        raw,
        phase6.manifest,
        phase6.phase5.manifest,
        phase6.phase5.g7.manifest,
        phase6.phase5.g7.g6.manifest,
      ).issues);
    } catch {
      issues.push('exact bound Phase 6 policy does not exist');
    }
    if (!activationCeremonyPolicyIsActive(initial.value, new Date().toISOString())) {
      issues.push('Phase 7 policy is not active at the current time');
    }
    issues.push(...phase7RuntimeIdentityIssues(initial.value));
    if (registry.size() !== 0) issues.push('production action-adapter registry is not empty');
    try {
      stored = await repository.findPolicy(initial.value.policy_id);
      if (stored.record.policy_fingerprint !== initial.fingerprint) issues.push('stored Phase 7 policy fingerprint does not match');
      const phase6Service = new ExternalEvidenceService(externalRepository, registry);
      readiness = await new ActivationCeremonyService(repository, phase6Service, registry).readiness(initial.value.policy_id);
    } catch {
      issues.push('exact accepted and currently ready Phase 7 policy does not exist');
    }
  }
  console.error(JSON.stringify({
    status: issues.length ? 'blocked' : 'ceremony_ready_unexecuted',
    policy_id: initial.value?.policy_id ?? null,
    policy_fingerprint: initial.fingerprint ?? null,
    issues: [...new Set(issues)],
    evidence_count: readiness?.evidence_count ?? 0,
    handoff_only: true,
    activation_status: 'not_executed',
    external_execution_required: true,
    execution_implemented: false,
    activation_possible: false,
  }, null, 2));
  process.exitCode = 2;
}

if (require.main === module) {
  main().catch(() => {
    console.error(JSON.stringify({ status: 'blocked', issues: ['Phase 7 preflight failed safely'] }, null, 2));
    process.exitCode = 2;
  }).finally(() => db.destroy());
}
