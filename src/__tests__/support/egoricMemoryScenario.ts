import type { Knex } from 'knex';
import {
  EGORIC_ACTIVE_STAGES,
  EGORIC_FUNNEL_ID,
  EGORIC_SCHEMA_VERSION,
  EGORIC_TERMINAL_OUTCOMES,
  EgoricSalesLead,
  EgoricSalesV1Snapshot,
  computeEgoricSnapshotId,
} from '../../domain/businessMemory';
import { BusinessMemoryRepository } from '../../repositories/businessMemoryRepository';

let sequence = 0;

export const DEFAULT_EGORIC_LEADS: EgoricSalesLead[] = [
  {
    external_id: 'brief-lead-new',
    stage: 'new',
    source: 'Ads',
    estimated_value: 100,
    created_at: '2026-07-28T20:00:00.000Z',
    expected_close_at: '2026-07-29T12:00:00.000Z',
    owner_assigned: false,
  },
  {
    external_id: 'brief-lead-contacted',
    stage: 'contacted',
    source: 'Referral',
    estimated_value: 200,
    created_at: '2026-07-27T20:00:00.000Z',
    expected_close_at: '2026-07-28T21:00:00.000Z',
    owner_assigned: true,
  },
  {
    external_id: 'brief-lead-proposal',
    stage: 'proposal',
    source: null,
    estimated_value: 300,
    created_at: null,
    expected_close_at: null,
    owner_assigned: false,
  },
  {
    external_id: 'brief-lead-won',
    stage: 'won',
    source: 'Ads',
    estimated_value: 400,
    created_at: '2026-07-20T20:00:00.000Z',
    expected_close_at: null,
    owner_assigned: true,
  },
  {
    external_id: 'brief-lead-lost',
    stage: 'lost',
    source: 'Organic',
    estimated_value: null,
    created_at: '2026-07-18T20:00:00.000Z',
    expected_close_at: null,
    owner_assigned: false,
  },
];

export function buildEgoricSnapshot(input: {
  sourceTenantKey: string;
  leads?: EgoricSalesLead[];
  generatedAt?: string;
}): EgoricSalesV1Snapshot {
  const leads = input.leads ?? DEFAULT_EGORIC_LEADS;
  const facts = {
    schema_version: EGORIC_SCHEMA_VERSION,
    source: { system: 'egoric' as const, tenant_key: input.sourceTenantKey },
    funnel_definition: {
      id: EGORIC_FUNNEL_ID,
      active_stages: [...EGORIC_ACTIVE_STAGES] as [...typeof EGORIC_ACTIVE_STAGES],
      terminal_outcomes: [...EGORIC_TERMINAL_OUTCOMES] as [...typeof EGORIC_TERMINAL_OUTCOMES],
      historical_transitions_available: false as const,
    },
    leads,
    quality: {
      records: leads.length,
      missing_source: leads.filter((lead) => !lead.source).length,
      missing_created_at: leads.filter((lead) => !lead.created_at).length,
      client_attribution: 'unavailable' as const,
    },
  };
  return {
    ...facts,
    snapshot_id: computeEgoricSnapshotId(facts),
    generated_at: input.generatedAt ?? '2026-07-28T22:45:00.000Z',
  };
}

export async function seedEgoricMemory(db: Knex, input: {
  tenantKey?: string;
  displayName?: string;
  sourceTenantKey?: string;
  leads?: EgoricSalesLead[];
  generatedAt?: string;
  asOf?: string;
  receivedAt?: string;
  engineVersion?: string;
} = {}) {
  sequence += 1;
  const tenantKey = input.tenantKey ?? `brief-tenant-${sequence}`;
  const sourceTenantKey = input.sourceTenantKey ?? `brief-source-${sequence}`;
  const receivedAt = input.receivedAt ?? '2026-07-28T23:00:00.000Z';
  const repository = new BusinessMemoryRepository(db, () => new Date(receivedAt));
  const tenant = await repository.ensureTenant({
    tenantKey,
    displayName: input.displayName ?? `Brief Tenant ${sequence}`,
  });
  const connection = await repository.ensureSourceConnection({
    tenantId: tenant.id,
    sourceSystem: 'egoric',
    sourceTenantKey,
    schemaVersion: EGORIC_SCHEMA_VERSION,
    endpointUrl: `https://brief-${sequence}.example/api/integrations/leozops/v1/lead-snapshot`,
  });
  const snapshot = buildEgoricSnapshot({
    sourceTenantKey,
    leads: input.leads,
    generatedAt: input.generatedAt,
  });
  const accepted = await repository.acceptSnapshot({
    tenantId: tenant.id,
    sourceConnectionId: connection.id,
    payload: snapshot,
    engineVersion: input.engineVersion ?? 'egoric_ingestion_v1',
    asOf: input.asOf ?? '2026-07-28T23:00:00.000Z',
  });
  return { repository, tenant, connection, snapshot, accepted };
}
