import { randomUUID } from 'node:crypto';
import type { Knex } from '../db/knex';
import {
  AMBIENT_JARVIS_TABLES,
  AmbientJarvisError,
  AmbientJarvisPreferenceRecord,
  AmbientJarvisPreferences,
  ambientJarvisHash,
  parseAmbientJarvisPreferenceRecord,
} from '../domain/ambientJarvis';
import { canonicalStringify } from '../domain/businessMemory';

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function postgres(knex: Knex): boolean {
  return String(knex.client.config.client).includes('pg');
}

function normalize(row: AmbientJarvisPreferenceRecord): AmbientJarvisPreferenceRecord {
  const record = { ...row, version: Number(row.version) };
  parseAmbientJarvisPreferenceRecord(record);
  return record;
}

export class AmbientJarvisRepository {
  constructor(
    private readonly knex: Knex,
    private readonly clock: () => Date = () => new Date(),
    private readonly uuid: () => string = randomUUID,
  ) {}

  async current(tenantId: string): Promise<AmbientJarvisPreferenceRecord | undefined> {
    const row = await this.knex<AmbientJarvisPreferenceRecord>(AMBIENT_JARVIS_TABLES.preferences)
      .where({ tenant_id: tenantId }).orderBy('version', 'desc').first();
    return row ? normalize(row) : undefined;
  }

  async append(input: {
    tenantId: string;
    preferences: AmbientJarvisPreferences;
    idempotencyKey: string;
  }): Promise<{ record: AmbientJarvisPreferenceRecord; replayed: boolean }> {
    if (!SAFE_KEY.test(input.idempotencyKey)) {
      throw new AmbientJarvisError('invalid_idempotency_key', 'Idempotency-Key is invalid');
    }
    const requestHash = ambientJarvisHash({ preferences: input.preferences });
    const preferencesHash = ambientJarvisHash(input.preferences);
    const preferencesJson = canonicalStringify(input.preferences);
    return this.knex.transaction(async (trx) => {
      if (postgres(this.knex)) await trx('tenants').where({ id: input.tenantId }).forUpdate().first();
      const replay = await trx<AmbientJarvisPreferenceRecord>(AMBIENT_JARVIS_TABLES.preferences)
        .where({ tenant_id: input.tenantId, idempotency_key: input.idempotencyKey }).first();
      if (replay) {
        const record = normalize(replay);
        if (record.request_hash !== requestHash) {
          throw new AmbientJarvisError('preference_idempotency_conflict', 'Idempotency-Key binds different preferences', 409);
        }
        return { record, replayed: true };
      }
      const previousRaw = await trx<AmbientJarvisPreferenceRecord>(AMBIENT_JARVIS_TABLES.preferences)
        .where({ tenant_id: input.tenantId }).orderBy('version', 'desc').first();
      const previous = previousRaw ? normalize(previousRaw) : undefined;
      if (previous && previous.preferences_hash === preferencesHash) {
        return { record: previous, replayed: true };
      }
      const record: AmbientJarvisPreferenceRecord = {
        id: this.uuid(),
        tenant_id: input.tenantId,
        version: (previous?.version ?? 0) + 1,
        previous_revision_id: previous?.id ?? null,
        idempotency_key: input.idempotencyKey,
        request_hash: requestHash,
        preferences_json: preferencesJson,
        preferences_hash: preferencesHash,
        created_by: 'founder',
        created_at: this.clock().toISOString(),
      };
      await trx(AMBIENT_JARVIS_TABLES.preferences).insert(record);
      return { record, replayed: false };
    });
  }
}
