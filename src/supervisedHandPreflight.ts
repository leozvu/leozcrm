import fs from 'node:fs';
import path from 'node:path';
import { SupervisedActionError } from './domain/supervisedAction';
import { validateSupervisedHandQualification } from './domain/supervisedHand';
import { buildActionAdapterRegistry } from './integrations/actions/buildActionAdapterRegistry';

export function evaluateSupervisedHandPreflight(input: unknown, registrySize: number) {
  const qualification = validateSupervisedHandQualification(input);
  const blockers = [
    ...qualification.blockers.filter((item) => item !== 'production_adapter_registry_empty'),
    ...(registrySize === 0 ? ['production_adapter_registry_empty'] : []),
    'live_g5_go_not_verified_by_static_preflight',
    'command_specific_g6_release_not_verified_by_static_preflight',
  ];
  return {
    status: blockers.length === 0 ? 'ready' as const : 'blocked' as const,
    command_key: qualification.value.command_key,
    source_repository: qualification.value.repository,
    source_commit: qualification.value.source_commit,
    source_contract_fingerprint: qualification.fingerprint,
    adapter_registry_size: registrySize,
    blockers,
  };
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as unknown;
}

async function main(): Promise<void> {
  const file = process.argv[2] ?? 'config/phase14.repositoryrealms-task-create.audit.json';
  const result = evaluateSupervisedHandPreflight(readJson(file), buildActionAdapterRegistry().size());
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'ready') process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const code = error instanceof SupervisedActionError ? error.code : 'supervised_hand_preflight_failed';
    console.error(JSON.stringify({ status: 'blocked', code }, null, 2));
    process.exitCode = 2;
  });
}
