import {
  IntegrationAdapter,
  IntegrationAdapterInfo,
  IntegrationChannel,
} from '../domain/integration';
import { createDefaultAdapters } from './channels';

/**
 * In-memory registry of the placeholder integration adapters (Milestone #6).
 *
 * This is the single place the rest of the system discovers which channels
 * exist. It is a pure read model — it holds adapter instances and looks them up
 * by channel; it performs no I/O and mutates nothing. The `/integrations` route
 * reads from it the same way a CRUD route reads from a repository.
 *
 * Like the repositories/services, it is constructable for tests and exported as
 * a process-wide singleton (`integrationRegistry`) for app use.
 */
export class IntegrationRegistry {
  private readonly byChannel: Map<IntegrationChannel, IntegrationAdapter>;

  constructor(adapters: IntegrationAdapter[] = createDefaultAdapters()) {
    this.byChannel = new Map(adapters.map((a) => [a.channel, a]));
  }

  /** All registered adapters, in registration order. */
  list(): IntegrationAdapter[] {
    return [...this.byChannel.values()];
  }

  /** Serialisable info for every adapter — what the read-only route returns. */
  listInfo(): IntegrationAdapterInfo[] {
    return this.list().map((a) => a.info());
  }

  /** Look up one adapter by channel, or `undefined` if not registered. */
  get(channel: string): IntegrationAdapter | undefined {
    return this.byChannel.get(channel as IntegrationChannel);
  }

  /** Whether a channel is registered. */
  has(channel: string): boolean {
    return this.byChannel.has(channel as IntegrationChannel);
  }
}

/** Default registry with all placeholder channel adapters, for app use. */
export const integrationRegistry = new IntegrationRegistry();
