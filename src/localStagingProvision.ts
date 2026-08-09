import fs from 'node:fs';
import path from 'node:path';
import type { Knex } from 'knex';
import { db } from './db/knex';
import { EGORIC_SCHEMA_VERSION, validateEgoricSnapshotEndpoint } from './domain/businessMemory';
import { validateLiveObserverDeployment } from './domain/liveObserver';
import { inspectLiveObserverPreflight } from './liveObserverPreflight';

const ACKNOWLEDGEMENT = 'PROVISION_ISOLATED_LOCAL_STAGING_ONLY';

export interface LocalStagingProvisionResult {
  status: 'ok';
  environment: 'staging';
  tenant_id: string;
  source_connection_id: string;
  deployment_fingerprint: string;
  replayed: boolean;
}

export async function provisionLocalStaging(
  knex: Knex,
  raw: unknown,
  env: NodeJS.ProcessEnv,
): Promise<LocalStagingProvisionResult> {
  if (env.LEOZOPS_DEPLOY_ENV !== 'local-staging' || env.LEOZOPS_LOCAL_STAGING_ACK !== ACKNOWLEDGEMENT) {
    throw new Error('local_staging_acknowledgement_missing');
  }
  const validation = validateLiveObserverDeployment(raw);
  const preflight = inspectLiveObserverPreflight(raw, env, 'server');
  if (!validation.ok || !validation.value || !validation.fingerprint || !preflight.ok) {
    throw new Error('local_staging_preflight_blocked');
  }
  const deployment = validation.value;
  if (
    deployment.environment !== 'staging'
    || deployment.target.provider !== 'docker-local'
    || deployment.target.project_id !== 'leozops-local-staging'
    || deployment.target.database_id !== 'leozops-local-staging-postgres-16'
    || deployment.source.egoric_project_id !== 'repositoryrealms-local-staging-stub'
  ) throw new Error('local_staging_target_mismatch');

  const endpointUrl = validateEgoricSnapshotEndpoint(deployment.source.endpoint_url);
  const now = new Date().toISOString();
  let replayed = false;
  await knex.transaction(async (trx) => {
    const tenantById = await trx('tenants').where({ id: deployment.source.tenant_id }).first();
    const tenantByKey = await trx('tenants').where({ tenant_key: deployment.source.tenant_key }).first();
    if (tenantById || tenantByKey) {
      const tenant = tenantById ?? tenantByKey;
      if (
        tenant.id !== deployment.source.tenant_id
        || tenant.tenant_key !== deployment.source.tenant_key
        || tenant.display_name !== 'Egoric Local Staging'
      ) throw new Error('local_staging_tenant_conflict');
      replayed = true;
    } else {
      await trx('tenants').insert({
        id: deployment.source.tenant_id,
        tenant_key: deployment.source.tenant_key,
        display_name: 'Egoric Local Staging',
        created_at: now,
        updated_at: now,
      });
    }

    const connectionById = await trx('source_connections').where({ id: deployment.source.connection_id }).first();
    const connectionByIdentity = await trx('source_connections').where({
      tenant_id: deployment.source.tenant_id,
      source_system: 'egoric',
      source_tenant_key: deployment.source.tenant_key,
    }).first();
    if (connectionById || connectionByIdentity) {
      const connection = connectionById ?? connectionByIdentity;
      if (
        connection.id !== deployment.source.connection_id
        || connection.tenant_id !== deployment.source.tenant_id
        || connection.schema_version !== EGORIC_SCHEMA_VERSION
        || connection.endpoint_url !== endpointUrl
      ) throw new Error('local_staging_source_connection_conflict');
      replayed = true;
    } else {
      await trx('source_connections').insert({
        id: deployment.source.connection_id,
        tenant_id: deployment.source.tenant_id,
        source_system: 'egoric',
        source_tenant_key: deployment.source.tenant_key,
        schema_version: EGORIC_SCHEMA_VERSION,
        endpoint_url: endpointUrl,
        status: 'active',
        last_etag: null,
        last_success_at: null,
        created_at: now,
        updated_at: now,
      });
    }
  });
  return {
    status: 'ok',
    environment: 'staging',
    tenant_id: deployment.source.tenant_id,
    source_connection_id: deployment.source.connection_id,
    deployment_fingerprint: validation.fingerprint,
    replayed,
  };
}

async function main(): Promise<void> {
  const manifestPath = process.env.LEOZOPS_LIVE_DEPLOYMENT_MANIFEST;
  if (!manifestPath) throw new Error('local_staging_manifest_missing');
  const raw = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8')) as unknown;
  console.log(JSON.stringify(await provisionLocalStaging(db, raw, process.env), null, 2));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({
      status: 'blocked',
      code: error instanceof Error ? error.message : 'local_staging_provision_failed',
    }));
    process.exitCode = 2;
  }).finally(() => db.destroy());
}
