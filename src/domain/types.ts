/**
 * Row shapes for the four core CRM tables. These mirror the migration in
 * src/db/migrations and act as the typed "model" layer over Knex.
 *
 * Money is always stored as integer cents to avoid floating-point drift.
 * Timestamps are ISO-8601 strings as returned by the driver.
 */

export type ClientStatus = 'active' | 'paused' | 'churned';
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed';
export type LeadStatus = 'open' | 'won' | 'lost';

/**
 * Placeholder channel labels only — there are NO real integrations in this
 * foundation. These are plain strings used for grouping/reporting today and
 * the seam where real Facebook/TikTok/Instagram/email adapters plug in later.
 */
export type CampaignChannel = 'facebook' | 'tiktok' | 'instagram' | 'email' | 'other';

export interface FunnelStage {
  id: string;
  key: string;
  name: string;
  position: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  name: string;
  email: string;
  company: string | null;
  status: ClientStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  client_id: string;
  name: string;
  channel: CampaignChannel;
  status: CampaignStatus;
  budget_cents: number | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  client_id: string;
  /** Nullable: a lead may exist before it is attributed to a campaign. */
  campaign_id: string | null;
  /** Current position in the funnel (FK -> funnel_stages.id). */
  funnel_stage_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Free-text origin label, e.g. "fb-ad-spring", "referral". */
  source: string | null;
  /** Qualification score, 0–100. */
  score: number;
  status: LeadStatus;
  /** When the lead last entered its current funnel stage. */
  entered_stage_at: string;
  created_at: string;
  updated_at: string;
}

/** Table name constants — single source of truth for query builders. */
export const TABLES = {
  funnelStages: 'funnel_stages',
  clients: 'clients',
  campaigns: 'campaigns',
  leads: 'leads',
} as const;
