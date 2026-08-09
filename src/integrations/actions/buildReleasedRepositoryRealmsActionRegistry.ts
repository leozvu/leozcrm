import type { G6ActionPolicyManifest } from '../../domain/g6Policy';
import {
  RepositoryRealmsActionReleaseManifest,
  validateRepositoryRealmsActionRelease,
  verifyRepositoryRealmsReleaseCredentials,
} from '../../domain/repositoryRealmsActionRelease';
import type { RepositoryRealmsTaskCommandCredentialSet, RepositoryRealmsTaskCommandTransport } from './repositoryRealmsTaskCommandAdapter';
import { RepositoryRealmsTaskCommandAdapter } from './repositoryRealmsTaskCommandAdapter';
import { ActionAdapterRegistry } from './actionAdapterRegistry';

export function buildReleasedRepositoryRealmsActionRegistry(input: {
  release: unknown;
  qualification: unknown;
  g6Policy: G6ActionPolicyManifest;
  credentials: RepositoryRealmsTaskCommandCredentialSet;
  transport?: RepositoryRealmsTaskCommandTransport;
}): {
  registry: ActionAdapterRegistry;
  release: RepositoryRealmsActionReleaseManifest;
  releaseFingerprint: string;
} {
  const validation = validateRepositoryRealmsActionRelease(input.release, {
    qualification: input.qualification,
    g6Policy: input.g6Policy,
  });
  verifyRepositoryRealmsReleaseCredentials(validation.value, input.credentials);
  const adapter = new RepositoryRealmsTaskCommandAdapter({
    environment: validation.value.environment,
    endpointUrl: validation.value.target.endpoint_url,
    targetEntityId: validation.value.target.entity_id,
    expectedProjectId: validation.value.target.project_id,
    expectedTenantKey: validation.value.target.tenant_key,
    credentials: input.credentials,
    subjects: validation.value.subjects,
    transport: input.transport,
    currency: 'VND',
  });
  return {
    registry: new ActionAdapterRegistry([adapter]),
    release: validation.value,
    releaseFingerprint: validation.fingerprint,
  };
}
