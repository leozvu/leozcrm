export const SOURCE_POLL_STATE_TABLE = 'source_poll_states' as const;
export const SOURCE_POLL_CADENCE_MS = 15 * 60 * 1_000;

export type PollCircuitState = 'closed' | 'open' | 'half_open';

export interface SourcePollState {
  source_connection_id: string;
  tenant_id: string;
  circuit_state: PollCircuitState;
  consecutive_failures: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  circuit_opened_at: string | null;
  last_error_code: string | null;
  last_http_status: number | null;
  lease_id: string | null;
  lease_expires_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface SourcePollPolicy {
  cadenceMs: typeof SOURCE_POLL_CADENCE_MS;
  requestTimeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  circuitFailureThreshold: number;
  circuitOpenMs: number;
  leaseMs: number;
}

export class PollPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PollPolicyError';
  }
}

function integerInRange(value: number, min: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new PollPolicyError(`${name} is outside the supported range`);
  }
}

/**
 * Policies are explicit constructor inputs. This validator provides safety
 * ceilings but deliberately does not choose production retry/circuit values.
 */
export function validateSourcePollPolicy(policy: SourcePollPolicy): SourcePollPolicy {
  if (policy.cadenceMs !== SOURCE_POLL_CADENCE_MS) {
    throw new PollPolicyError('cadenceMs must preserve the approved 15-minute target');
  }
  integerInRange(policy.requestTimeoutMs, 1, 120_000, 'requestTimeoutMs');
  integerInRange(policy.maxRetries, 0, 10, 'maxRetries');
  integerInRange(policy.baseDelayMs, 0, SOURCE_POLL_CADENCE_MS, 'baseDelayMs');
  integerInRange(policy.maxDelayMs, policy.baseDelayMs, SOURCE_POLL_CADENCE_MS, 'maxDelayMs');
  if (!Number.isFinite(policy.jitterRatio) || policy.jitterRatio < 0 || policy.jitterRatio > 1) {
    throw new PollPolicyError('jitterRatio must be between zero and one');
  }
  integerInRange(policy.circuitFailureThreshold, 1, 100, 'circuitFailureThreshold');
  integerInRange(policy.circuitOpenMs, 1, 24 * 60 * 60 * 1_000, 'circuitOpenMs');
  integerInRange(policy.leaseMs, 1_000, 24 * 60 * 60 * 1_000, 'leaseMs');

  const maximumAttemptRuntime = (
    policy.requestTimeoutMs * (policy.maxRetries + 1)
    + policy.maxDelayMs * policy.maxRetries
    + 1_000
  );
  if (policy.leaseMs < maximumAttemptRuntime) {
    throw new PollPolicyError('leaseMs cannot expire before the bounded poll cycle');
  }
  return Object.freeze({ ...policy });
}

export function safePollErrorCode(value: string): string {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : 'unclassified_error';
}
