import { EGORIC_SCHEMA_VERSION } from '../domain/businessMemory';
import { EgoricSalesV1Adapter } from '../integrations/sources/egoricSalesV1Adapter';
import { SourceAdapter, SourceAdapterError } from '../integrations/sources/sourceAdapter';
import {
  AcceptedSnapshot,
  BusinessMemoryError,
  BusinessMemoryRepository,
} from '../repositories/businessMemoryRepository';
import type { EgoricSalesV1Snapshot } from '../domain/businessMemory';

export type PullOnceResult =
  | {
      kind: 'not_modified';
      etag: string | null;
      correlation_id: string;
    }
  | ({
      kind: 'accepted';
      etag: string;
      correlation_id: string;
    } & AcceptedSnapshot);

/**
 * One explicit local/test pull. Scheduling, retry, and circuit breaking belong
 * to S2.A. This service only proves the G2 path: GET-only source adapter ->
 * fail-closed validation -> atomic, idempotent Business Memory acceptance.
 */
export class SnapshotIngestionService {
  constructor(
    private readonly repository: BusinessMemoryRepository,
    private readonly egoricAdapter: SourceAdapter<EgoricSalesV1Snapshot> = new EgoricSalesV1Adapter(),
  ) {}

  async pullOnce(input: {
    tenantId: string;
    sourceConnectionId: string;
    bearerToken: string;
    engineVersion: string;
    asOf: string;
    correlationId?: string;
    signal?: AbortSignal;
  }): Promise<PullOnceResult> {
    const connection = await this.repository.findSourceConnectionForTenant(
      input.tenantId,
      input.sourceConnectionId,
    );
    if (!connection) {
      throw new BusinessMemoryError(
        'unknown_source_connection',
        'source connection does not exist for tenant',
      );
    }
    if (connection.status !== 'active') {
      throw new BusinessMemoryError('source_connection_disabled', 'source connection is disabled');
    }
    if (
      connection.source_system !== this.egoricAdapter.sourceSystem
      || connection.schema_version !== EGORIC_SCHEMA_VERSION
      || this.egoricAdapter.schemaVersion !== EGORIC_SCHEMA_VERSION
    ) {
      throw new BusinessMemoryError('unsupported_source_contract', 'source contract is not supported');
    }

    let result;
    try {
      result = await this.egoricAdapter.pull({
        endpointUrl: connection.endpoint_url,
        bearerToken: input.bearerToken,
        sourceTenantKey: connection.source_tenant_key,
        previousEtag: connection.last_etag,
        correlationId: input.correlationId,
        signal: input.signal,
      });
    } catch (error) {
      if (error instanceof SourceAdapterError && error.disableConnection) {
        await this.repository.disableSourceConnection(input.tenantId, connection.id);
      }
      throw error;
    }

    if (result.kind === 'not_modified') {
      await this.repository.recordPullSuccess(input.tenantId, connection.id, result.etag);
      return result;
    }

    const accepted = await this.repository.acceptSnapshot({
      tenantId: input.tenantId,
      sourceConnectionId: connection.id,
      payload: result.snapshot,
      engineVersion: input.engineVersion,
      asOf: input.asOf,
    });
    await this.repository.recordPullSuccess(input.tenantId, connection.id, result.etag);
    return {
      kind: 'accepted',
      etag: result.etag,
      correlation_id: result.correlation_id,
      ...accepted,
    };
  }
}
