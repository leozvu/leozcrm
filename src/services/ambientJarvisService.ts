import {
  AmbientJarvisError,
  AmbientJarvisPreferences,
  defaultAmbientJarvisPreferences,
  parseAmbientJarvisPreferenceRecord,
  validateAmbientJarvisPreferences,
} from '../domain/ambientJarvis';
import { AmbientJarvisRepository } from '../repositories/ambientJarvisRepository';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';

export interface AmbientJarvisPreferenceView {
  preferences: AmbientJarvisPreferences;
  revision: { id: string; version: number; fingerprint: string; created_at: string } | null;
  source: 'defaults' | 'founder_revision';
}

export class AmbientJarvisService {
  constructor(
    private readonly preferences: AmbientJarvisRepository,
    private readonly memory: BusinessMemoryRepository,
  ) {}

  private async tenant(tenantKey: string) {
    const tenant = await this.memory.findTenantByKey(tenantKey);
    if (!tenant) throw new AmbientJarvisError('tenant_not_found', 'tenant was not found', 404);
    return tenant;
  }

  async current(tenantKey: string): Promise<AmbientJarvisPreferenceView> {
    const tenant = await this.tenant(tenantKey);
    const record = await this.preferences.current(tenant.id);
    if (!record) return { preferences: defaultAmbientJarvisPreferences(), revision: null, source: 'defaults' };
    return {
      preferences: parseAmbientJarvisPreferenceRecord(record),
      revision: { id: record.id, version: record.version, fingerprint: record.preferences_hash, created_at: record.created_at },
      source: 'founder_revision',
    };
  }

  async update(tenantKey: string, raw: unknown, idempotencyKey: string) {
    const tenant = await this.tenant(tenantKey);
    const preferences = validateAmbientJarvisPreferences(raw);
    const output = await this.preferences.append({ tenantId: tenant.id, preferences, idempotencyKey });
    return {
      view: {
        preferences: parseAmbientJarvisPreferenceRecord(output.record),
        revision: {
          id: output.record.id,
          version: output.record.version,
          fingerprint: output.record.preferences_hash,
          created_at: output.record.created_at,
        },
        source: 'founder_revision' as const,
      },
      replayed: output.replayed,
    };
  }
}
