export interface SourcePullRequest {
  endpointUrl: string;
  bearerToken: string;
  sourceTenantKey: string;
  previousEtag?: string | null;
  correlationId?: string;
  signal?: AbortSignal;
}

export type SourcePullResult<TSnapshot> =
  | {
      kind: 'not_modified';
      etag: string | null;
      correlation_id: string;
    }
  | {
      kind: 'snapshot';
      etag: string;
      correlation_id: string;
      snapshot: TSnapshot;
    };

/** Source-neutral, read-only connector contract. */
export interface SourceAdapter<TSnapshot> {
  readonly sourceSystem: string;
  readonly schemaVersion: string;
  pull(request: SourcePullRequest): Promise<SourcePullResult<TSnapshot>>;
}

export class SourceAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number | null = null,
    public readonly disableConnection = false,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'SourceAdapterError';
  }
}
