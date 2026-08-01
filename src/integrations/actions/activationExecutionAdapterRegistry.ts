import {
  ActivationExecutionAdapter,
  ActivationExecutionError,
} from '../../domain/activationExecution';
import type { ActivationExecutionPolicyManifest } from '../../domain/activationExecutionPolicy';

export class ActivationExecutionAdapterRegistry {
  private readonly adapters = new Map<string, ActivationExecutionAdapter>();

  constructor(adapters: readonly ActivationExecutionAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: ActivationExecutionAdapter): void {
    const key = this.key(
      adapter.descriptor.environment,
      adapter.descriptor.adapter_id,
      adapter.descriptor.adapter_version,
      adapter.descriptor.target_fingerprint,
    );
    if (this.adapters.has(key)) throw new ActivationExecutionError('duplicate_activation_adapter', 'activation adapter is already registered');
    this.adapters.set(key, adapter);
  }

  resolve(policy: ActivationExecutionPolicyManifest): ActivationExecutionAdapter {
    const adapter = this.adapters.get(this.key(
      policy.environment,
      policy.target.adapter_id,
      policy.target.adapter_version,
      policy.target.target_fingerprint,
    ));
    if (!adapter) throw new ActivationExecutionError('activation_adapter_not_registered', 'exact activation adapter is not registered', 503);
    return adapter;
  }

  size(): number {
    return this.adapters.size;
  }

  private key(environment: string, adapterId: string, adapterVersion: string, targetFingerprint: string): string {
    return `${environment}\0${adapterId}\0${adapterVersion}\0${targetFingerprint}`;
  }
}

export function buildActivationExecutionAdapterRegistry(): ActivationExecutionAdapterRegistry {
  return new ActivationExecutionAdapterRegistry();
}
