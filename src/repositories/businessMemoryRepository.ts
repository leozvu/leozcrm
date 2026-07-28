import { v4 as uuidv4 } from 'uuid';
import { db, Knex } from '../db/knex';
import {
  BUSINESS_MEMORY_TABLES,
  EGORIC_SCHEMA_VERSION,
  EgoricSalesV1Snapshot,
  IntelligenceRun,
  SourceConnection,
  SourceSnapshot,
  Tenant,
  canonicalStringify,
  validateEgoricSnapshotEndpoint,
  validateEgoricSalesV1Snapshot,
} from '../domain/businessMemory';

const TENANT_KEY_RE = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const ENGINE_VERSION_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

export class BusinessMemoryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessMemoryError';
  }
}

export interface AcceptedSnapshot {
  snapshot: SourceSnapshot;
  run: IntelligenceRun;
  snapshot_created: boolean;
  run_created: boolean;
}

export interface SnapshotRun {
  snapshot: SourceSnapshot;
  run: IntelligenceRun;
}

/**
 * Data access for the LeozOps-owned analytical read model. Snapshot mutation
 * and deletion methods intentionally do not exist; database triggers provide
 * the backstop against direct UPDATE/DELETE calls.
 */
export class BusinessMemoryRepository {
  constructor(
    private readonly knex: Knex = db,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private now(): string {
    return this.clock().toISOString();
  }

  async ensureTenant(input: { tenantKey: string; displayName: string }): Promise<Tenant> {
    if (!TENANT_KEY_RE.test(input.tenantKey)) {
      throw new BusinessMemoryError('invalid_tenant_key', 'tenant key has an invalid format');
    }
    if (
      typeof input.displayName !== 'string'
      || input.displayName.trim() === ''
      || input.displayName.length > 200
    ) {
      throw new BusinessMemoryError('invalid_display_name', 'tenant display name is invalid');
    }

    const existing = await this.knex<Tenant>(BUSINESS_MEMORY_TABLES.tenants)
      .where({ tenant_key: input.tenantKey })
      .first();
    if (existing) {
      if (existing.display_name !== input.displayName) {
        throw new BusinessMemoryError('tenant_conflict', 'tenant key already has a different identity');
      }
      return existing;
    }

    const now = this.now();
    const id = uuidv4();
    await this.knex(BUSINESS_MEMORY_TABLES.tenants).insert({
      id,
      tenant_key: input.tenantKey,
      display_name: input.displayName,
      created_at: now,
      updated_at: now,
    }).onConflict('tenant_key').ignore();
    const stored = await this.knex<Tenant>(BUSINESS_MEMORY_TABLES.tenants)
      .where({ tenant_key: input.tenantKey })
      .first();
    if (!stored) throw new Error('failed to create tenant');
    if (stored.display_name !== input.displayName) {
      throw new BusinessMemoryError('tenant_conflict', 'tenant key already has a different identity');
    }
    return stored;
  }

  async ensureSourceConnection(input: {
    tenantId: string;
    sourceSystem: string;
    sourceTenantKey: string;
    schemaVersion: string;
    endpointUrl: string;
  }): Promise<SourceConnection> {
    const tenant = await this.knex<Tenant>(BUSINESS_MEMORY_TABLES.tenants)
      .where({ id: input.tenantId })
      .first();
    if (!tenant) throw new BusinessMemoryError('unknown_tenant', 'tenant does not exist');
    if (input.sourceSystem !== 'egoric' || input.schemaVersion !== EGORIC_SCHEMA_VERSION) {
      throw new BusinessMemoryError('unsupported_source_contract', 'source contract is not supported');
    }
    if (!TENANT_KEY_RE.test(input.sourceTenantKey)) {
      throw new BusinessMemoryError('invalid_source_tenant', 'source tenant key is invalid');
    }
    let endpointUrl: string;
    try {
      endpointUrl = validateEgoricSnapshotEndpoint(input.endpointUrl);
    } catch {
      throw new BusinessMemoryError('invalid_endpoint', 'source endpoint is invalid');
    }

    const identity = {
      tenant_id: input.tenantId,
      source_system: input.sourceSystem,
      source_tenant_key: input.sourceTenantKey,
    };
    const existing = await this.knex<SourceConnection>(BUSINESS_MEMORY_TABLES.sourceConnections)
      .where(identity)
      .first();
    if (existing) {
      if (existing.schema_version !== input.schemaVersion || existing.endpoint_url !== endpointUrl) {
        throw new BusinessMemoryError(
          'source_connection_conflict',
          'source connection identity has different contract settings',
        );
      }
      return existing;
    }

    const now = this.now();
    const id = uuidv4();
    await this.knex(BUSINESS_MEMORY_TABLES.sourceConnections).insert({
      id,
      ...identity,
      schema_version: input.schemaVersion,
      endpoint_url: endpointUrl,
      status: 'active',
      last_etag: null,
      last_success_at: null,
      created_at: now,
      updated_at: now,
    }).onConflict(['tenant_id', 'source_system', 'source_tenant_key']).ignore();
    const stored = await this.knex<SourceConnection>(BUSINESS_MEMORY_TABLES.sourceConnections)
      .where(identity)
      .first();
    if (!stored) throw new Error('failed to create source connection');
    if (stored.schema_version !== input.schemaVersion || stored.endpoint_url !== endpointUrl) {
      throw new BusinessMemoryError(
        'source_connection_conflict',
        'source connection identity has different contract settings',
      );
    }
    return stored;
  }

  async findSourceConnectionForTenant(
    tenantId: string,
    connectionId: string,
  ): Promise<SourceConnection | undefined> {
    return this.knex<SourceConnection>(BUSINESS_MEMORY_TABLES.sourceConnections)
      .where({ id: connectionId, tenant_id: tenantId })
      .first();
  }

  async findTenantByKey(tenantKey: string): Promise<Tenant | undefined> {
    return this.knex<Tenant>(BUSINESS_MEMORY_TABLES.tenants)
      .where({ tenant_key: tenantKey })
      .first();
  }

  async findLatestSnapshotRunForTenant(
    tenantId: string,
    asOfCutoff?: string,
  ): Promise<SnapshotRun | undefined> {
    const query = this.knex<IntelligenceRun>(BUSINESS_MEMORY_TABLES.intelligenceRuns)
      .where({ tenant_id: tenantId, status: 'accepted' });
    if (asOfCutoff !== undefined) query.andWhere('as_of', '<=', asOfCutoff);
    const run = await query
      .orderBy('as_of', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'asc')
      .first();
    if (!run) return undefined;
    const snapshot = await this.knex<SourceSnapshot>(BUSINESS_MEMORY_TABLES.sourceSnapshots)
      .where({ id: run.source_snapshot_id, tenant_id: tenantId })
      .first();
    if (!snapshot) {
      throw new BusinessMemoryError(
        'missing_source_snapshot',
        'accepted intelligence run has no tenant-scoped source snapshot',
      );
    }
    return { snapshot, run };
  }

  async recordPullSuccess(
    tenantId: string,
    connectionId: string,
    etag: string | null,
  ): Promise<void> {
    const affected = await this.knex(BUSINESS_MEMORY_TABLES.sourceConnections)
      .where({ id: connectionId, tenant_id: tenantId })
      .update({
        last_etag: etag,
        last_success_at: this.now(),
        updated_at: this.now(),
      });
    if (affected !== 1) {
      throw new BusinessMemoryError('unknown_source_connection', 'source connection does not exist');
    }
  }

  async disableSourceConnection(tenantId: string, connectionId: string): Promise<void> {
    const affected = await this.knex(BUSINESS_MEMORY_TABLES.sourceConnections)
      .where({ id: connectionId, tenant_id: tenantId })
      .update({ status: 'disabled', updated_at: this.now() });
    if (affected !== 1) {
      throw new BusinessMemoryError('unknown_source_connection', 'source connection does not exist');
    }
  }

  async acceptSnapshot(input: {
    tenantId: string;
    sourceConnectionId: string;
    payload: EgoricSalesV1Snapshot;
    engineVersion: string;
    asOf: string;
  }): Promise<AcceptedSnapshot> {
    if (!ENGINE_VERSION_RE.test(input.engineVersion)) {
      throw new BusinessMemoryError('invalid_engine_version', 'engine version is invalid');
    }
    if (typeof input.asOf !== 'string' || Number.isNaN(Date.parse(input.asOf))) {
      throw new BusinessMemoryError('invalid_as_of', 'asOf must be a valid date-time');
    }

    return this.knex.transaction(async (trx) => {
      const connection = await trx<SourceConnection>(BUSINESS_MEMORY_TABLES.sourceConnections)
        .where({ id: input.sourceConnectionId, tenant_id: input.tenantId })
        .first();
      if (!connection) {
        throw new BusinessMemoryError('unknown_source_connection', 'source connection does not exist for tenant');
      }
      if (connection.status !== 'active') {
        throw new BusinessMemoryError('source_connection_disabled', 'source connection is disabled');
      }
      if (
        connection.source_system !== 'egoric'
        || connection.schema_version !== EGORIC_SCHEMA_VERSION
      ) {
        throw new BusinessMemoryError('unsupported_source_contract', 'source contract is not supported');
      }

      // Defense in depth: repository callers cannot bypass schema/hash/tenant
      // validation even if they do not use the HTTP adapter.
      const payload = validateEgoricSalesV1Snapshot(
        input.payload,
        connection.source_tenant_key,
      );
      const snapshotIdentity = {
        source_system: connection.source_system,
        source_tenant_key: connection.source_tenant_key,
        snapshot_id: payload.snapshot_id,
      };
      const snapshotInsertId = uuidv4();
      const now = this.now();
      await trx(BUSINESS_MEMORY_TABLES.sourceSnapshots).insert({
        id: snapshotInsertId,
        tenant_id: input.tenantId,
        source_connection_id: connection.id,
        ...snapshotIdentity,
        schema_version: payload.schema_version,
        generated_at: payload.generated_at,
        received_at: now,
        payload_json: canonicalStringify(payload),
        record_count: payload.leads.length,
        created_at: now,
      }).onConflict(['source_system', 'source_tenant_key', 'snapshot_id']).ignore();

      const snapshot = await trx<SourceSnapshot>(BUSINESS_MEMORY_TABLES.sourceSnapshots)
        .where(snapshotIdentity)
        .first();
      if (!snapshot) throw new Error('failed to persist source snapshot');
      if (snapshot.tenant_id !== input.tenantId || snapshot.source_connection_id !== connection.id) {
        throw new BusinessMemoryError('snapshot_identity_conflict', 'snapshot identity belongs to another tenant');
      }

      const runIdentity = {
        tenant_id: input.tenantId,
        snapshot_id: payload.snapshot_id,
        engine_version: input.engineVersion,
        as_of: input.asOf,
      };
      const runInsertId = uuidv4();
      await trx(BUSINESS_MEMORY_TABLES.intelligenceRuns).insert({
        id: runInsertId,
        ...runIdentity,
        source_snapshot_id: snapshot.id,
        status: 'accepted',
        created_at: now,
      }).onConflict(['tenant_id', 'snapshot_id', 'engine_version', 'as_of']).ignore();
      const run = await trx<IntelligenceRun>(BUSINESS_MEMORY_TABLES.intelligenceRuns)
        .where(runIdentity)
        .first();
      if (!run) throw new Error('failed to persist intelligence run');
      if (run.source_snapshot_id !== snapshot.id) {
        throw new BusinessMemoryError('run_identity_conflict', 'run identity points to another snapshot');
      }

      return {
        snapshot,
        run,
        snapshot_created: snapshot.id === snapshotInsertId,
        run_created: run.id === runInsertId,
      };
    });
  }

  async listSnapshotsForTenant(tenantId: string): Promise<SourceSnapshot[]> {
    return this.knex<SourceSnapshot>(BUSINESS_MEMORY_TABLES.sourceSnapshots)
      .where({ tenant_id: tenantId })
      .orderBy('received_at', 'asc');
  }

  async listRunsForTenant(tenantId: string): Promise<IntelligenceRun[]> {
    return this.knex<IntelligenceRun>(BUSINESS_MEMORY_TABLES.intelligenceRuns)
      .where({ tenant_id: tenantId })
      .orderBy('created_at', 'asc');
  }
}
