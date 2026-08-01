import {
  ADVISOR_EVIDENCE_VERSION,
  AdvisorEvidenceItem,
  AdvisorEvidencePack,
  AdvisorEvidenceSource,
  AdvisorEvidenceValue,
  advisorHash,
} from '../domain/advisorConversation';
import { EgoricCeoBrief } from '../domain/egoricBrief';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { AdvisorConversationRepository } from '../repositories/advisorConversationRepository';
import { EgoricBriefService } from './egoricBriefService';

export class AdvisorEvidenceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdvisorEvidenceError';
  }
}

function safeKey(value: string): string {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!key || key.length > 80) throw new AdvisorEvidenceError('invalid_evidence_key', 'evidence key is invalid');
  return key;
}

function item(input: {
  key: string;
  sourceType: AdvisorEvidenceSource;
  sourceId: string;
  sourcePath: string;
  label: string;
  value: AdvisorEvidenceValue;
}): AdvisorEvidenceItem {
  return {
    key: input.key,
    source_type: input.sourceType,
    source_id: input.sourceId,
    source_path: input.sourcePath,
    label: input.label,
    value: input.value,
    value_hash: advisorHash(input.value),
  };
}

function briefItems(brief: EgoricCeoBrief): AdvisorEvidenceItem[] {
  const rows: AdvisorEvidenceItem[] = [];
  const add = (key: string, sourcePath: string, label: string, value: AdvisorEvidenceValue) => {
    rows.push(item({
      key,
      sourceType: 'ceo_brief',
      sourceId: brief.source_snapshot_id,
      sourcePath,
      label,
      value,
    }));
  };

  add('brief.headline.total_leads', 'headline.total_leads', 'Total leads', brief.headline.total_leads);
  add('brief.headline.active_pipeline', 'headline.active_pipeline', 'Active pipeline', brief.headline.active_pipeline);
  add('brief.headline.won', 'headline.won', 'Won leads', brief.headline.won);
  add('brief.headline.lost', 'headline.lost', 'Lost leads', brief.headline.lost);
  add('brief.headline.closed', 'headline.closed', 'Closed leads', brief.headline.closed);
  add('brief.headline.win_rate', 'headline.win_rate', 'Current-state win rate', brief.headline.win_rate);
  add(
    'brief.headline.active_estimated_value',
    'headline.active_estimated_value',
    'Active estimated value (currency unavailable)',
    brief.headline.active_estimated_value,
  );
  add(
    'brief.headline.active_owner_coverage',
    'headline.active_owner_coverage',
    'Active owner coverage',
    brief.headline.active_owner_coverage,
  );
  add(
    'brief.headline.overdue_expected_close',
    'headline.overdue_expected_close',
    'Overdue expected close count',
    brief.headline.overdue_expected_close,
  );
  add('brief.freshness.status', 'data_freshness.status', 'Data freshness status', brief.data_freshness.status);
  add('brief.freshness.age_seconds', 'data_freshness.age_seconds', 'Source age in seconds', brief.data_freshness.age_seconds);
  add(
    'brief.freshness.source_generated_at',
    'data_freshness.source_generated_at',
    'Source generated at',
    brief.data_freshness.source_generated_at,
  );
  add('brief.quality.records', 'quality.records', 'Source record count', brief.quality.records);
  add('brief.quality.missing_source', 'quality.missing_source', 'Records missing source', brief.quality.missing_source);
  add(
    'brief.quality.missing_created_at',
    'quality.missing_created_at',
    'Records missing created time',
    brief.quality.missing_created_at,
  );
  add(
    'brief.quality.client_attribution',
    'quality.client_attribution',
    'Client attribution availability',
    brief.quality.client_attribution,
  );

  brief.stages.forEach((stage) => {
    const prefix = `brief.stage.${safeKey(stage.stage)}`;
    add(`${prefix}.count`, `stages.${stage.stage}.count`, `${stage.stage} lead count`, stage.count);
    add(
      `${prefix}.estimated_value`,
      `stages.${stage.stage}.estimated_value`,
      `${stage.stage} estimated value (currency unavailable)`,
      stage.estimated_value,
    );
    add(
      `${prefix}.owner_assigned`,
      `stages.${stage.stage}.owner_assigned`,
      `${stage.stage} owner-assigned count`,
      stage.owner_assigned,
    );
    add(
      `${prefix}.overdue_expected_close`,
      `stages.${stage.stage}.overdue_expected_close`,
      `${stage.stage} overdue expected-close count`,
      stage.overdue_expected_close,
    );
  });

  brief.sources.forEach((source, index) => {
    const sourceKey = source.source === null ? 'unavailable' : safeKey(source.source);
    add(
      `brief.source.${sourceKey}.count`,
      `sources.${index}.count`,
      `${source.source ?? 'Unavailable'} source count`,
      source.count,
    );
  });

  brief.known_limitations.forEach((limitation) => {
    add(
      `brief.limitation.${safeKey(limitation.code)}`,
      `known_limitations.${limitation.code}`,
      `Limitation: ${limitation.code}`,
      limitation.message,
    );
  });
  return rows;
}

export class AdvisorEvidenceService {
  constructor(
    private readonly memory: BusinessMemoryRepository,
    private readonly brief: EgoricBriefService,
    private readonly conversations: AdvisorConversationRepository,
  ) {}

  async build(tenantKey: string, requestedAsOf?: string): Promise<AdvisorEvidencePack> {
    const tenant = await this.memory.findTenantByKey(tenantKey);
    if (!tenant) throw new AdvisorEvidenceError('tenant_not_found', 'tenant was not found');
    const brief = await this.brief.generate(tenantKey, requestedAsOf);
    const rows = briefItems(brief);
    const contexts = await this.conversations.listActiveContext(tenant.id);
    contexts.forEach((context) => {
      rows.push(item({
        key: `context.${context.kind}.${safeKey(context.context_key)}`,
        sourceType: 'business_context',
        sourceId: context.id,
        sourcePath: `${context.kind}.${context.context_key}`,
        label: `${context.kind}: ${context.context_key}`,
        value: context.content,
      }));
    });
    rows.sort((left, right) => left.key.localeCompare(right.key));
    if (new Set(rows.map((row) => row.key)).size !== rows.length) {
      throw new AdvisorEvidenceError('duplicate_evidence_key', 'evidence pack contains duplicate keys');
    }

    const base = {
      version: ADVISOR_EVIDENCE_VERSION,
      tenant_key: tenantKey,
      as_of: brief.as_of,
      generated_at: brief.generated_at,
      freshness_status: brief.data_freshness.status,
      source_snapshot_id: brief.source_snapshot_id,
      intelligence_run_id: brief.intelligence_run_id,
      formula_version: brief.formula_version,
      items: rows,
    };
    return { ...base, hash: advisorHash(base) };
  }
}
