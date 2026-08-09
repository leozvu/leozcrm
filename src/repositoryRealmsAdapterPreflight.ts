import fs from 'node:fs';
import path from 'node:path';
import {
  RepositoryRealmsActionReleaseError,
  validateRepositoryRealmsActionRelease,
} from './domain/repositoryRealmsActionRelease';
import { buildActionAdapterRegistry } from './integrations/actions/buildActionAdapterRegistry';

export function evaluateRepositoryRealmsAdapterPreflight(input: {
  release: unknown;
  qualification: unknown;
  g6Policy: unknown;
}) {
  const validation = validateRepositoryRealmsActionRelease(input.release, {
    qualification: input.qualification,
    g6Policy: input.g6Policy,
  });
  const defaultRegistrySize = buildActionAdapterRegistry().size();
  return {
    status: 'blocked' as const,
    release_id: validation.value.release_id,
    release_fingerprint: validation.fingerprint,
    source_commit: validation.value.source.source_commit,
    g6_policy_id: validation.value.gates.g6_policy_id,
    default_registry_size: defaultRegistrySize,
    blockers: [
      'live_g5_database_state_not_verified_by_static_preflight',
      'runtime_credentials_not_verified_by_static_preflight',
      'source_feature_flag_not_verified_by_static_preflight',
      'explicit_operator_registration_not_executed',
    ],
  };
}

function json(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as unknown;
}

async function main(): Promise<void> {
  if (process.argv.length !== 5) {
    throw new RepositoryRealmsActionReleaseError(
      'repositoryrealms_adapter_preflight_usage',
      'usage: adapter:preflight <release.json> <qualification.json> <g6-policy.json>',
    );
  }
  const result = evaluateRepositoryRealmsAdapterPreflight({
    release: json(process.argv[2]),
    qualification: json(process.argv[3]),
    g6Policy: json(process.argv[4]),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const code = error instanceof RepositoryRealmsActionReleaseError
      ? error.code
      : 'repositoryrealms_adapter_preflight_failed';
    console.error(JSON.stringify({ status: 'blocked', code }, null, 2));
    process.exitCode = 2;
  });
}
