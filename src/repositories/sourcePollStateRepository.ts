import { db, Knex } from '../db/knex';
import { BUSINESS_MEMORY_TABLES, SourceConnection } from '../domain/businessMemory';
import {
  PollCircuitState,
  SOURCE_POLL_STATE_TABLE,
  SourcePollState,
  safePollErrorCode,
} from '../domain/pollReliability';

export class PollStateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PollStateError';
  }
}

export type PollLeaseResult =
  | { acquired: true; state: SourcePollState }
  | {
      acquired: false;
      reason: 'unknown_connection' | 'disabled' | 'lease_held' | 'not_due' | 'circuit_open';
      state?: SourcePollState;
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const millis = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(millis) ? millis : null;
}

function validCircuit(value: unknown): value is PollCircuitState {
  return value === 'closed' || value === 'open' || value === 'half_open';
}

function addMs(iso: string, milliseconds: number): string {
  return new Date(Date.parse(iso) + milliseconds).toISOString();
}

function iso(value: unknown): string | null {
  const millis = asMillis(value);
  return millis === null ? null : new Date(millis).toISOString();
}

/** Persistent, tenant-scoped coordination state. No source credential enters this repository. */
export class SourcePollStateRepository {
  constructor(
    private readonly knex: Knex = db,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private now(): string {
    return this.clock().toISOString();
  }

  private validate(row: SourcePollState | undefined): SourcePollState {
    if (!row) throw new PollStateError('missing_poll_state', 'source poll state does not exist');
    const normalized: SourcePollState = {
      ...row,
      last_attempt_at: iso(row.last_attempt_at),
      next_attempt_at: iso(row.next_attempt_at),
      circuit_opened_at: iso(row.circuit_opened_at),
      lease_expires_at: iso(row.lease_expires_at),
      created_at: iso(row.created_at) ?? '',
      updated_at: iso(row.updated_at) ?? '',
    };
    if (
      !validCircuit(normalized.circuit_state)
      || !Number.isInteger(normalized.consecutive_failures)
      || normalized.consecutive_failures < 0
      || !Number.isInteger(normalized.revision)
      || normalized.revision < 0
      || normalized.created_at === ''
      || normalized.updated_at === ''
      || (normalized.last_error_code !== null && safePollErrorCode(normalized.last_error_code) !== normalized.last_error_code)
      || (
        normalized.last_http_status !== null
        && (!Number.isInteger(normalized.last_http_status) || normalized.last_http_status < 100 || normalized.last_http_status > 599)
      )
      || (normalized.lease_id === null) !== (normalized.lease_expires_at === null)
      || (normalized.lease_id !== null && !UUID_RE.test(normalized.lease_id))
      || (row.last_attempt_at !== null && normalized.last_attempt_at === null)
      || (row.next_attempt_at !== null && normalized.next_attempt_at === null)
      || (row.circuit_opened_at !== null && normalized.circuit_opened_at === null)
      || (row.lease_expires_at !== null && normalized.lease_expires_at === null)
    ) {
      throw new PollStateError('corrupt_poll_state', 'source poll state failed validation');
    }
    return normalized;
  }

  async ensureState(tenantId: string, connectionId: string): Promise<SourcePollState> {
    const connection = await this.knex<SourceConnection>(BUSINESS_MEMORY_TABLES.sourceConnections)
      .where({ id: connectionId, tenant_id: tenantId })
      .first();
    if (!connection) {
      throw new PollStateError('unknown_source_connection', 'source connection does not exist for tenant');
    }

    const now = this.now();
    await this.knex(SOURCE_POLL_STATE_TABLE).insert({
      source_connection_id: connectionId,
      tenant_id: tenantId,
      circuit_state: 'closed',
      consecutive_failures: 0,
      last_attempt_at: null,
      next_attempt_at: null,
      circuit_opened_at: null,
      last_error_code: null,
      last_http_status: null,
      lease_id: null,
      lease_expires_at: null,
      revision: 0,
      created_at: now,
      updated_at: now,
    }).onConflict('source_connection_id').ignore();

    return this.getState(tenantId, connectionId);
  }

  async getState(tenantId: string, connectionId: string): Promise<SourcePollState> {
    const row = await this.knex<SourcePollState>(SOURCE_POLL_STATE_TABLE)
      .where({ source_connection_id: connectionId, tenant_id: tenantId })
      .first();
    return this.validate(row);
  }

  async findState(tenantId: string, connectionId: string): Promise<SourcePollState | undefined> {
    const row = await this.knex<SourcePollState>(SOURCE_POLL_STATE_TABLE)
      .where({ source_connection_id: connectionId, tenant_id: tenantId })
      .first();
    return row ? this.validate(row) : undefined;
  }

  /** Make an active, closed connection due without bypassing its lease/circuit guards. */
  async makeDueForOperator(tenantId: string, connectionId: string): Promise<SourcePollState> {
    const connection = await this.knex<SourceConnection>(BUSINESS_MEMORY_TABLES.sourceConnections)
      .where({ id: connectionId, tenant_id: tenantId })
      .first();
    if (!connection) {
      throw new PollStateError('unknown_source_connection', 'source connection does not exist for tenant');
    }
    if (connection.status !== 'active') {
      throw new PollStateError('source_connection_disabled', 'source connection is disabled');
    }
    const state = await this.ensureState(tenantId, connectionId);
    const now = this.now();
    const activeLease = state.lease_id !== null
      && (asMillis(state.lease_expires_at) ?? 0) > Date.parse(now);
    if (activeLease) throw new PollStateError('lease_held', 'source poll lease is active');
    if (state.circuit_state !== 'closed') {
      throw new PollStateError('circuit_open', 'source circuit must be recovered before polling');
    }
    const affected = await this.knex(SOURCE_POLL_STATE_TABLE)
      .where({
        source_connection_id: connectionId,
        tenant_id: tenantId,
        revision: state.revision,
      })
      .update({
        next_attempt_at: null,
        lease_id: null,
        lease_expires_at: null,
        revision: this.knex.raw('revision + 1'),
        updated_at: now,
      });
    if (affected !== 1) throw new PollStateError('operation_conflict', 'poll state changed concurrently');
    return this.getState(tenantId, connectionId);
  }

  async acquireLease(input: {
    tenantId: string;
    connectionId: string;
    leaseId: string;
    leaseMs: number;
  }): Promise<PollLeaseResult> {
    if (!UUID_RE.test(input.leaseId) || !Number.isInteger(input.leaseMs) || input.leaseMs < 1_000) {
      throw new PollStateError('invalid_lease', 'poll lease input is invalid');
    }
    const connection = await this.knex<SourceConnection>(BUSINESS_MEMORY_TABLES.sourceConnections)
      .where({ id: input.connectionId, tenant_id: input.tenantId })
      .first();
    if (!connection) return { acquired: false, reason: 'unknown_connection' };
    if (connection.status !== 'active') return { acquired: false, reason: 'disabled' };

    let state = await this.ensureState(input.tenantId, input.connectionId);
    const now = this.now();
    const nowMs = Date.parse(now);
    const leaseExpiresMs = asMillis(state.lease_expires_at);
    if (state.lease_id !== null && leaseExpiresMs !== null && leaseExpiresMs > nowMs) {
      return { acquired: false, reason: 'lease_held', state };
    }
    const nextAttemptMs = asMillis(state.next_attempt_at);
    if (nextAttemptMs !== null && nextAttemptMs > nowMs) {
      return {
        acquired: false,
        reason: state.circuit_state === 'open' ? 'circuit_open' : 'not_due',
        state,
      };
    }

    const nextCircuit: PollCircuitState = state.circuit_state === 'open'
      ? 'half_open'
      : state.circuit_state;
    const affected = await this.knex(SOURCE_POLL_STATE_TABLE)
      .where({
        source_connection_id: input.connectionId,
        tenant_id: input.tenantId,
        revision: state.revision,
      })
      .andWhere((query) => query.whereNull('lease_id').orWhere('lease_expires_at', '<=', now))
      .update({
        lease_id: input.leaseId,
        lease_expires_at: addMs(now, input.leaseMs),
        last_attempt_at: now,
        circuit_state: nextCircuit,
        revision: this.knex.raw('revision + 1'),
        updated_at: now,
      });

    if (affected !== 1) {
      state = await this.getState(input.tenantId, input.connectionId);
      const currentLeaseMs = asMillis(state.lease_expires_at);
      const currentNextMs = asMillis(state.next_attempt_at);
      return {
        acquired: false,
        reason: state.lease_id !== null && currentLeaseMs !== null && currentLeaseMs > nowMs
          ? 'lease_held'
          : state.circuit_state === 'open' && currentNextMs !== null && currentNextMs > nowMs
            ? 'circuit_open'
            : currentNextMs !== null && currentNextMs > nowMs
              ? 'not_due'
              : 'lease_held',
        state,
      };
    }
    return { acquired: true, state: await this.getState(input.tenantId, input.connectionId) };
  }

  async recordSuccess(input: {
    tenantId: string;
    connectionId: string;
    leaseId: string;
    cadenceMs: number;
  }): Promise<SourcePollState> {
    const now = this.now();
    const affected = await this.knex(SOURCE_POLL_STATE_TABLE)
      .where({
        source_connection_id: input.connectionId,
        tenant_id: input.tenantId,
        lease_id: input.leaseId,
      })
      .update({
        circuit_state: 'closed',
        consecutive_failures: 0,
        next_attempt_at: addMs(now, input.cadenceMs),
        circuit_opened_at: null,
        last_error_code: null,
        last_http_status: null,
        lease_id: null,
        lease_expires_at: null,
        revision: this.knex.raw('revision + 1'),
        updated_at: now,
      });
    if (affected !== 1) throw new PollStateError('lease_lost', 'poll lease is no longer owned');
    return this.getState(input.tenantId, input.connectionId);
  }

  async recordFailure(input: {
    tenantId: string;
    connectionId: string;
    leaseId: string;
    errorCode: string;
    httpStatus: number | null;
    permanent: boolean;
    cadenceMs: number;
    circuitFailureThreshold: number;
    circuitOpenMs: number;
  }): Promise<SourcePollState> {
    if (
      input.httpStatus !== null
      && (!Number.isInteger(input.httpStatus) || input.httpStatus < 100 || input.httpStatus > 599)
    ) {
      throw new PollStateError('invalid_failure_state', 'poll failure status is invalid');
    }
    const state = await this.getState(input.tenantId, input.connectionId);
    if (state.lease_id !== input.leaseId) {
      throw new PollStateError('lease_lost', 'poll lease is no longer owned');
    }
    const failures = state.consecutive_failures + 1;
    const open = input.permanent
      || state.circuit_state === 'half_open'
      || failures >= input.circuitFailureThreshold;
    const now = this.now();
    const nextAttemptAt = input.permanent
      ? null
      : addMs(now, open ? input.circuitOpenMs : input.cadenceMs);
    const affected = await this.knex(SOURCE_POLL_STATE_TABLE)
      .where({
        source_connection_id: input.connectionId,
        tenant_id: input.tenantId,
        lease_id: input.leaseId,
        revision: state.revision,
      })
      .update({
        circuit_state: open ? 'open' : 'closed',
        consecutive_failures: failures,
        next_attempt_at: nextAttemptAt,
        circuit_opened_at: open ? now : null,
        last_error_code: safePollErrorCode(input.errorCode),
        last_http_status: input.httpStatus,
        lease_id: null,
        lease_expires_at: null,
        revision: this.knex.raw('revision + 1'),
        updated_at: now,
      });
    if (affected !== 1) throw new PollStateError('lease_lost', 'poll lease is no longer owned');
    return this.getState(input.tenantId, input.connectionId);
  }

  /** Disable immediately and invalidate any in-flight owner at the state boundary. */
  async disableForOperator(tenantId: string, connectionId: string): Promise<SourcePollState> {
    const connection = await this.knex<SourceConnection>(BUSINESS_MEMORY_TABLES.sourceConnections)
      .where({ id: connectionId, tenant_id: tenantId })
      .first();
    if (!connection) {
      throw new PollStateError('unknown_source_connection', 'source connection does not exist for tenant');
    }
    const state = await this.ensureState(tenantId, connectionId);
    const now = this.now();
    await this.knex.transaction(async (trx) => {
      const connectionAffected = await trx(BUSINESS_MEMORY_TABLES.sourceConnections)
        .where({ id: connectionId, tenant_id: tenantId })
        .update({ status: 'disabled', updated_at: now });
      const stateAffected = await trx(SOURCE_POLL_STATE_TABLE)
        .where({
          source_connection_id: connectionId,
          tenant_id: tenantId,
          revision: state.revision,
        })
        .update({
          circuit_state: 'open',
          next_attempt_at: null,
          circuit_opened_at: now,
          last_error_code: 'operator_disabled',
          last_http_status: null,
          lease_id: null,
          lease_expires_at: null,
          revision: trx.raw('revision + 1'),
          updated_at: now,
        });
      if (connectionAffected !== 1 || stateAffected !== 1) {
        throw new PollStateError('operation_conflict', 'source state changed concurrently');
      }
    });
    return this.getState(tenantId, connectionId);
  }

  /** Explicit recovery re-enables the connection and resets its persisted circuit. */
  async recoverForOperator(tenantId: string, connectionId: string): Promise<SourcePollState> {
    const connection = await this.knex<SourceConnection>(BUSINESS_MEMORY_TABLES.sourceConnections)
      .where({ id: connectionId, tenant_id: tenantId })
      .first();
    if (!connection) {
      throw new PollStateError('unknown_source_connection', 'source connection does not exist for tenant');
    }
    const state = await this.ensureState(tenantId, connectionId);
    const now = this.now();
    if (
      state.lease_id !== null
      && (asMillis(state.lease_expires_at) ?? 0) > Date.parse(now)
    ) {
      throw new PollStateError('lease_held', 'source poll lease is active');
    }
    await this.knex.transaction(async (trx) => {
      const connectionAffected = await trx(BUSINESS_MEMORY_TABLES.sourceConnections)
        .where({ id: connectionId, tenant_id: tenantId })
        .update({ status: 'active', updated_at: now });
      const stateAffected = await trx(SOURCE_POLL_STATE_TABLE)
        .where({
          source_connection_id: connectionId,
          tenant_id: tenantId,
          revision: state.revision,
        })
        .update({
          circuit_state: 'closed',
          consecutive_failures: 0,
          next_attempt_at: null,
          circuit_opened_at: null,
          last_error_code: null,
          last_http_status: null,
          lease_id: null,
          lease_expires_at: null,
          revision: trx.raw('revision + 1'),
          updated_at: now,
        });
      if (connectionAffected !== 1 || stateAffected !== 1) {
        throw new PollStateError('operation_conflict', 'source state changed concurrently');
      }
    });
    return this.getState(tenantId, connectionId);
  }
}
