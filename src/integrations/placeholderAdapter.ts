import {
  IntegrationAdapter,
  IntegrationActionRequest,
  IntegrationActionResult,
  IntegrationAdapterInfo,
  IntegrationCapability,
  IntegrationChannel,
  IntegrationMode,
} from '../domain/integration';
import { ValidationError } from '../errors';

/**
 * Shared base for every placeholder channel adapter (Milestone #6).
 *
 * A subclass only declares its identity (channel, display name, capabilities);
 * all behaviour lives here and is a deliberate no-op:
 *
 *   - `execute` performs NO network I/O, NO publishing, NO writes. It validates
 *     that the requested capability is one this adapter declares, then returns a
 *     `no_op: true` / `performed: false` acknowledgement.
 *   - The payload is never transmitted or stored; only its key names are echoed
 *     back so we never retain credential/secret values.
 *
 * This class intentionally imports nothing that can reach the outside world (no
 * `http`/`https`/`fetch`, no `knex`/repository). The absence of those imports is
 * the structural guarantee behind the "no external calls / no side effects"
 * tests.
 */
export abstract class PlaceholderAdapter implements IntegrationAdapter {
  abstract readonly channel: IntegrationChannel;
  abstract readonly displayName: string;
  abstract readonly capabilities: readonly IntegrationCapability[];

  /** Pinned: every adapter in this milestone is a placeholder. */
  readonly mode: IntegrationMode = 'placeholder';

  info(): IntegrationAdapterInfo {
    return {
      channel: this.channel,
      display_name: this.displayName,
      capabilities: [...this.capabilities],
      mode: this.mode,
      advisory_only: true,
    };
  }

  supports(capability: IntegrationCapability): boolean {
    return this.capabilities.includes(capability);
  }

  execute(request: IntegrationActionRequest): IntegrationActionResult {
    if (!this.supports(request.capability)) {
      throw new ValidationError(
        400,
        `${this.displayName} adapter does not support capability "${request.capability}"`,
        'unsupported_capability',
      );
    }

    // No-op by construction: acknowledge, but execute nothing. We record only
    // the payload's KEY NAMES — never its values — so secrets are never echoed.
    const payload_keys = Object.keys(request.payload ?? {});
    return {
      channel: this.channel,
      capability: request.capability,
      mode: this.mode,
      performed: false,
      no_op: true,
      detail: `${this.displayName} is a placeholder integration: the "${request.capability}" request was acknowledged but not executed (no external action in this milestone).`,
      request: { capability: request.capability, payload_keys },
    };
  }
}
