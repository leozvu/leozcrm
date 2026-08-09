import type { ProactiveDeliveryKind } from '../../domain/proactiveAlerts';

export interface NotificationDeliveryRequest {
  tenantKey: string;
  kind: ProactiveDeliveryKind;
  logicalNotificationKey: string;
  payload: Record<string, unknown>;
}

export type NotificationDeliveryResponse =
  | { status: 'delivered'; receiptId: string }
  | { status: 'failed'; failureCode: string };

export interface NotificationDeliveryAdapter {
  readonly kind: ProactiveDeliveryKind;
  readonly key: string;
  readonly version: string;
  deliver(request: NotificationDeliveryRequest): Promise<NotificationDeliveryResponse>;
}

export class NotificationDeliveryRegistry {
  private readonly adapters = new Map<ProactiveDeliveryKind, NotificationDeliveryAdapter>();

  constructor(adapters: readonly NotificationDeliveryAdapter[] = []) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.kind)) throw new Error(`duplicate notification adapter for ${adapter.kind}`);
      this.adapters.set(adapter.kind, adapter);
    }
  }

  get(kind: ProactiveDeliveryKind): NotificationDeliveryAdapter | undefined {
    return this.adapters.get(kind);
  }

  list(): Array<{ kind: ProactiveDeliveryKind; key: string; version: string }> {
    return [...this.adapters.values()].map(({ kind, key, version }) => ({ kind, key, version }));
  }
}

/** Production composition remains empty until a channel is separately reviewed. */
export function buildNotificationDeliveryRegistry(): NotificationDeliveryRegistry {
  return new NotificationDeliveryRegistry();
}
