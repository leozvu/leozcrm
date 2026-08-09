import {
  SupervisedActionAdapter,
  SupervisedActionError,
} from '../../domain/supervisedAction';

/**
 * Exact command registry for G6. The production default is deliberately empty:
 * registering an adapter is a command-specific release act, not configuration
 * discovery. Tests and future approved operator composition inject adapters.
 */
export class ActionAdapterRegistry {
  private readonly adapters = new Map<string, SupervisedActionAdapter>();

  constructor(adapters: readonly SupervisedActionAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: SupervisedActionAdapter): void {
    const key = this.key(
      adapter.descriptor.environment,
      adapter.descriptor.command_key,
      adapter.descriptor.command_version,
      adapter.descriptor.adapter_id,
    );
    if (this.adapters.has(key)) {
      throw new SupervisedActionError('duplicate_action_adapter', 'action adapter is already registered');
    }
    this.adapters.set(key, adapter);
  }

  resolve(input: {
    environment: 'test' | 'production';
    commandKey: string;
    commandVersion: string;
    adapterId: string;
  }): SupervisedActionAdapter {
    const adapter = this.adapters.get(this.key(
      input.environment,
      input.commandKey,
      input.commandVersion,
      input.adapterId,
    ));
    if (!adapter) {
      throw new SupervisedActionError(
        'action_adapter_not_registered',
        'the exact command adapter is not registered in this operator',
      );
    }
    return adapter;
  }

  size(): number {
    return this.adapters.size;
  }

  private key(environment: string, commandKey: string, commandVersion: string, adapterId: string): string {
    return `${environment}\u0000${commandKey}\u0000${commandVersion}\u0000${adapterId}`;
  }
}

export const emptyActionAdapterRegistry = new ActionAdapterRegistry();
