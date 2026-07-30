import { randomUUID } from 'node:crypto';
import { BusinessMemoryError, BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import {
  SourcePollPolicy,
  SourcePollState,
  validateSourcePollPolicy,
} from '../domain/pollReliability';
import { SourceAdapterError } from '../integrations/sources/sourceAdapter';
import {
  PollLeaseResult,
  SourcePollStateRepository,
} from '../repositories/sourcePollStateRepository';
import { PullOnceResult, SnapshotIngestionService } from './snapshotIngestionService';

interface PollCoordinatorDependencies {
  clock?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  uuid?: () => string;
}

interface ClassifiedPollError {
  code: string;
  httpStatus: number | null;
  retryAfterMs: number | null;
  retryable: boolean;
  permanent: boolean;
}

export type SourcePollCycleResult =
  | {
      kind: 'skipped';
      reason: Exclude<PollLeaseResult, { acquired: true }>['reason'];
    }
  | {
      kind: 'succeeded';
      outcome: PullOnceResult['kind'];
      attempts: number;
      correlation_id: string;
      state: SourcePollState;
    }
  | {
      kind: 'failed';
      error_code: string;
      http_status: number | null;
      attempts: number;
      correlation_id: string;
      disabled: boolean;
      state: SourcePollState;
    };

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function classify(error: unknown): ClassifiedPollError | null {
  if (error instanceof SourceAdapterError) {
    const retryable = error.code === 'source_unavailable'
      || error.status === 429
      || (error.status !== null && error.status >= 500 && error.status <= 599);
    return {
      code: error.code,
      httpStatus: error.status,
      retryAfterMs: error.retryAfterMs,
      retryable,
      permanent: !retryable,
    };
  }
  if (error instanceof BusinessMemoryError) {
    return {
      code: error.code,
      httpStatus: null,
      retryAfterMs: null,
      retryable: false,
      permanent: true,
    };
  }
  return null;
}

/**
 * One explicitly invoked, bounded source-poll cycle.
 *
 * This is not a scheduler and is not mounted by the HTTP app/server. It owns
 * retries and persistent lease/circuit transitions around the existing
 * GET-only ingestion service.
 */
export class SourcePollCoordinator {
  private readonly policy: SourcePollPolicy;
  private readonly clock: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly uuid: () => string;

  constructor(
    private readonly states: SourcePollStateRepository,
    private readonly ingestion: Pick<SnapshotIngestionService, 'pullOnce'>,
    private readonly businessMemory: Pick<BusinessMemoryRepository, 'disableSourceConnection'>,
    policy: SourcePollPolicy,
    dependencies: PollCoordinatorDependencies = {},
  ) {
    this.policy = validateSourcePollPolicy(policy);
    this.clock = dependencies.clock ?? (() => new Date());
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.random = dependencies.random ?? Math.random;
    this.uuid = dependencies.uuid ?? randomUUID;
  }

  private retryDelay(attempt: number, retryAfterMs: number | null): number {
    if (retryAfterMs !== null && Number.isFinite(retryAfterMs)) {
      return Math.min(this.policy.maxDelayMs, Math.max(0, retryAfterMs));
    }
    const exponential = Math.min(
      this.policy.maxDelayMs,
      this.policy.baseDelayMs * (2 ** Math.max(0, attempt - 1)),
    );
    const sample = Math.min(1, Math.max(0, this.random()));
    const jitter = exponential * this.policy.jitterRatio * ((sample * 2) - 1);
    return Math.min(this.policy.maxDelayMs, Math.max(0, Math.round(exponential + jitter)));
  }

  private async pullWithTimeout(input: {
    tenantId: string;
    sourceConnectionId: string;
    bearerToken: string;
    engineVersion: string;
    asOf: string;
    correlationId: string;
  }): Promise<PullOnceResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.policy.requestTimeoutMs);
    try {
      return await this.ingestion.pullOnce({ ...input, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async runOnce(input: {
    tenantId: string;
    sourceConnectionId: string;
    bearerToken: string;
    engineVersion: string;
  }): Promise<SourcePollCycleResult> {
    const leaseId = this.uuid();
    const correlationId = this.uuid();
    const asOf = this.clock().toISOString();
    const lease = await this.states.acquireLease({
      tenantId: input.tenantId,
      connectionId: input.sourceConnectionId,
      leaseId,
      leaseMs: this.policy.leaseMs,
    });
    if (!lease.acquired) return { kind: 'skipped', reason: lease.reason };

    let attempts = 0;
    while (attempts <= this.policy.maxRetries) {
      attempts += 1;
      try {
        const result = await this.pullWithTimeout({
          ...input,
          asOf,
          correlationId,
        });
        const state = await this.states.recordSuccess({
          tenantId: input.tenantId,
          connectionId: input.sourceConnectionId,
          leaseId,
          cadenceMs: this.policy.cadenceMs,
        });
        return {
          kind: 'succeeded',
          outcome: result.kind,
          attempts,
          correlation_id: result.correlation_id,
          state,
        };
      } catch (error) {
        const classified = classify(error);
        if (!classified) {
          try {
            await this.states.recordFailure({
              tenantId: input.tenantId,
              connectionId: input.sourceConnectionId,
              leaseId,
              errorCode: 'internal_error',
              httpStatus: null,
              permanent: false,
              cadenceMs: this.policy.cadenceMs,
              circuitFailureThreshold: this.policy.circuitFailureThreshold,
              circuitOpenMs: this.policy.circuitOpenMs,
            });
          } catch {
            // Preserve the original programming/infrastructure failure. The
            // bounded lease expiry remains the final concurrency backstop.
          }
          throw error;
        }

        if (classified.retryable && attempts <= this.policy.maxRetries) {
          await this.sleep(this.retryDelay(attempts, classified.retryAfterMs));
          continue;
        }

        if (classified.permanent) {
          await this.businessMemory.disableSourceConnection(
            input.tenantId,
            input.sourceConnectionId,
          );
        }
        const state = await this.states.recordFailure({
          tenantId: input.tenantId,
          connectionId: input.sourceConnectionId,
          leaseId,
          errorCode: classified.code,
          httpStatus: classified.httpStatus,
          permanent: classified.permanent,
          cadenceMs: this.policy.cadenceMs,
          circuitFailureThreshold: this.policy.circuitFailureThreshold,
          circuitOpenMs: this.policy.circuitOpenMs,
        });
        return {
          kind: 'failed',
          error_code: classified.code,
          http_status: classified.httpStatus,
          attempts,
          correlation_id: correlationId,
          disabled: classified.permanent,
          state,
        };
      }
    }
    throw new Error('bounded source poll loop exhausted without a result');
  }
}
