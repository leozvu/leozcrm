import { randomUUID } from 'node:crypto';
import {
  EGORIC_SCHEMA_VERSION,
  EgoricSalesV1Snapshot,
  SnapshotContractError,
  validateEgoricSnapshotEndpoint,
  validateEgoricSalesV1Snapshot,
} from '../../domain/businessMemory';
import {
  SourceAdapter,
  SourceAdapterError,
  SourcePullRequest,
  SourcePullResult,
} from './sourceAdapter';

type FetchLike = typeof fetch;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeEtag(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (value.length > 200 || /[\r\n]/.test(value)) {
    throw new SourceAdapterError('invalid_etag', 'previous ETag is malformed');
  }
  return value;
}

/**
 * Read-only adapter for the dedicated Egoric `egoric_sales_v1` endpoint.
 * There is no caller-controlled HTTP method and no request body: every egress
 * call is constructed here as GET.
 */
export class EgoricSalesV1Adapter implements SourceAdapter<EgoricSalesV1Snapshot> {
  readonly sourceSystem = 'egoric';
  readonly schemaVersion = EGORIC_SCHEMA_VERSION;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly uuid: () => string = randomUUID,
  ) {}

  async pull(request: SourcePullRequest): Promise<SourcePullResult<EgoricSalesV1Snapshot>> {
    let endpoint: string;
    try {
      endpoint = validateEgoricSnapshotEndpoint(request.endpointUrl);
    } catch (error) {
      if (error instanceof SnapshotContractError) {
        throw new SourceAdapterError(error.code, 'source endpoint is invalid');
      }
      throw error;
    }
    if (
      typeof request.bearerToken !== 'string'
      || request.bearerToken.length === 0
      || request.bearerToken.length > 500
      || /[\r\n]/.test(request.bearerToken)
    ) {
      throw new SourceAdapterError('missing_credential', 'source credential is required');
    }
    const correlationId = request.correlationId ?? this.uuid();
    if (!UUID_RE.test(correlationId)) {
      throw new SourceAdapterError('invalid_correlation_id', 'correlation id must be a UUID');
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${request.bearerToken}`,
      'X-Correlation-ID': correlationId,
    };
    const previousEtag = safeEtag(request.previousEtag);
    if (previousEtag) headers['If-None-Match'] = previousEtag;

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: 'GET',
        headers,
        body: undefined,
        redirect: 'error',
        signal: request.signal,
      });
    } catch {
      throw new SourceAdapterError('source_unavailable', 'source request failed');
    }

    const presentedCorrelationId = response.headers.get('x-correlation-id');
    const responseCorrelationId = presentedCorrelationId && UUID_RE.test(presentedCorrelationId)
      ? presentedCorrelationId
      : correlationId;
    if (response.status === 304) {
      if (!previousEtag) {
        throw new SourceAdapterError(
          'unexpected_not_modified',
          'source returned 304 without a prior ETag',
          304,
          true,
        );
      }
      const responseEtag = safeEtag(response.headers.get('etag')) ?? previousEtag;
      if (responseEtag !== previousEtag) {
        throw new SourceAdapterError(
          'etag_mismatch',
          'source 304 ETag does not match the requested ETag',
          304,
          true,
        );
      }
      return {
        kind: 'not_modified',
        etag: responseEtag,
        correlation_id: responseCorrelationId,
      };
    }
    if (response.status === 401 || response.status === 403) {
      throw new SourceAdapterError(
        'source_auth_failed',
        'source authentication failed',
        response.status,
        true,
      );
    }
    if (response.status !== 200) {
      throw new SourceAdapterError('source_http_error', 'source returned an unexpected status', response.status);
    }
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
      throw new SourceAdapterError('invalid_content_type', 'source response is not JSON', 200);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SourceAdapterError('invalid_json', 'source returned invalid JSON', 200);
    }

    let snapshot: EgoricSalesV1Snapshot;
    try {
      snapshot = validateEgoricSalesV1Snapshot(body, request.sourceTenantKey);
    } catch (error) {
      if (error instanceof SnapshotContractError) {
        throw new SourceAdapterError(error.code, 'source snapshot failed contract validation', 200, true);
      }
      throw error;
    }

    const etag = response.headers.get('etag');
    const expectedEtag = `"${snapshot.snapshot_id}"`;
    if (etag !== expectedEtag) {
      throw new SourceAdapterError('etag_mismatch', 'source ETag does not match snapshot_id', 200, true);
    }

    return {
      kind: 'snapshot',
      etag,
      correlation_id: responseCorrelationId,
      snapshot,
    };
  }
}
