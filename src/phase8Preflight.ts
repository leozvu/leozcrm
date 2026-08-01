import fs from 'node:fs';
import path from 'node:path';
import { db } from './db/knex';
import { activationExecutionPolicyIsActive } from './domain/activationExecution';
import {
  ActivationExecutionPolicyManifest,
  activationExecutionPolicyFingerprint,
  validateActivationExecutionPolicy,
} from './domain/activationExecutionPolicy';
import { buildActionAdapterRegistry } from './integrations/actions/buildActionAdapterRegistry';
import { buildActivationExecutionAdapterRegistry } from './integrations/actions/activationExecutionAdapterRegistry';
import { ActivationCeremonyRepository } from './repositories/activationCeremonyRepository';
import { ActivationExecutionRepository } from './repositories/activationExecutionRepository';
import { ExternalEvidenceRepository } from './repositories/externalEvidenceRepository';
import { ActivationCeremonyService } from './services/activationCeremonyService';
import { ActivationExecutionService } from './services/activationExecutionService';
import { ExternalEvidenceService } from './services/externalEvidenceService';

export function phase8RuntimeIdentityIssues(
  policy: ActivationExecutionPolicyManifest,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const expected: Record<string, string> = {
    LEOZOPS_PHASE8_ENVIRONMENT: policy.environment,
    LEOZOPS_PHASE8_POLICY_SHA256: activationExecutionPolicyFingerprint(policy),
    LEOZOPS_PHASE8_PHASE7_POLICY_SHA256: policy.phase7.policy_fingerprint,
    LEOZOPS_PHASE8_PHASE7_HANDOFF_SHA256: policy.phase7.handoff_fingerprint,
    LEOZOPS_PHASE8_TARGET_SHA256: policy.target.target_fingerprint,
    LEOZOPS_PHASE8_ADAPTER_ARTIFACT_SHA256: policy.target.adapter_artifact_digest,
    LEOZOPS_PHASE8_CONFIGURATION_SHA256: policy.target.configuration_digest,
    LEOZOPS_PHASE8_CREDENTIAL_REFERENCE_SHA256: policy.target.credential_reference_sha256,
    LEOZOPS_PHASE8_ROLLBACK_ARTIFACT_SHA256: policy.rollback.rollback_artifact_digest,
    LEOZOPS_PHASE8_ROLLBACK_PROCEDURE_SHA256: policy.rollback.procedure_digest,
    LEOZOPS_PHASE8_RELEASE_CREDENTIAL_SHA256: policy.identities.release_credential_sha256,
    LEOZOPS_PHASE8_EXECUTOR_CREDENTIAL_SHA256: policy.identities.executor_credential_sha256,
    LEOZOPS_PHASE8_OBSERVER_CREDENTIAL_SHA256: policy.identities.observer_credential_sha256,
    LEOZOPS_PHASE8_ROLLBACK_CREDENTIAL_SHA256: policy.identities.rollback_credential_sha256,
  };
  return Object.entries(expected).flatMap(([key, expectedValue]) => {
    const actual = environment[key];
    if (!actual) return [`${key} is required`];
    return actual === expectedValue ? [] : [`${key} does not match the accepted policy`];
  });
}

async function main(): Promise<void> {
  const file = path.resolve(process.argv[2] ?? 'config/phase8.activation-execution-policy.example.json');
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.error(JSON.stringify({ status: 'blocked', issues: ['policy file is unreadable or invalid JSON'] }, null, 2));
    process.exitCode = 2;
    return;
  }
  const initial = validateActivationExecutionPolicy(raw);
  const issues = [...initial.issues];
  let stored: Awaited<ReturnType<ActivationExecutionRepository['findPolicy']>> | undefined;
  let readiness: Awaited<ReturnType<ActivationExecutionService['readiness']>> | undefined;
  if (initial.value && initial.fingerprint) {
    const repository = new ActivationExecutionRepository(db);
    const ceremonyRepository = new ActivationCeremonyRepository(db);
    const externalRepository = new ExternalEvidenceRepository(db);
    const actionRegistry = buildActionAdapterRegistry();
    const activationRegistry = buildActivationExecutionAdapterRegistry();
    try {
      const phase7 = await repository.findPhase7State(initial.value.phase7.policy_id);
      issues.push(...validateActivationExecutionPolicy(raw, {
        phase7: phase7.found.manifest,
        handoff: phase7.handoff,
        phase6: phase7.found.phase6.manifest,
        phase5: phase7.found.phase6.phase5.manifest,
        g7: phase7.found.phase6.phase5.g7.manifest,
        g6: phase7.found.phase6.phase5.g7.g6.manifest,
      }).issues);
      if (phase7.recall) issues.push('exact Phase 7 handoff has been recalled');
    } catch {
      issues.push('exact sealed Phase 7 handoff does not exist');
    }
    if (!activationExecutionPolicyIsActive(initial.value, new Date().toISOString())) {
      issues.push('Phase 8 policy is not active at the current time');
    }
    issues.push(...phase8RuntimeIdentityIssues(initial.value));
    try {
      activationRegistry.resolve(initial.value);
    } catch {
      issues.push('exact production activation adapter is not registered');
    }
    try {
      stored = await repository.findPolicy(initial.value.policy_id);
      if (stored.record.policy_fingerprint !== initial.fingerprint) issues.push('stored Phase 8 policy fingerprint does not match');
      const phase6Service = new ExternalEvidenceService(externalRepository, actionRegistry);
      const phase7Service = new ActivationCeremonyService(ceremonyRepository, phase6Service, actionRegistry);
      readiness = await new ActivationExecutionService(repository, phase7Service, activationRegistry)
        .readiness(initial.value.policy_id);
    } catch {
      issues.push('exact accepted and currently ready Phase 8 policy does not exist');
    }
  }
  console.error(JSON.stringify({
    status: issues.length ? 'blocked' : 'controlled_activation_ready',
    policy_id: initial.value?.policy_id ?? null,
    policy_fingerprint: initial.fingerprint ?? null,
    issues: [...new Set(issues)],
    phase7_handoff_fingerprint: initial.value?.phase7.handoff_fingerprint ?? null,
    production_adapter_count: buildActivationExecutionAdapterRegistry().size(),
    ready_for_controlled_activation: readiness?.ready_for_controlled_activation ?? false,
    activation_executed: readiness?.claim_recorded ?? false,
    automatic_retry: false,
    automatic_rollback: false,
  }, null, 2));
  process.exitCode = issues.length ? 2 : 0;
}

if (require.main === module) {
  main().catch(() => {
    console.error(JSON.stringify({ status: 'blocked', issues: ['Phase 8 preflight failed safely'] }, null, 2));
    process.exitCode = 2;
  }).finally(() => db.destroy());
}
