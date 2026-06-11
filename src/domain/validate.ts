/**
 * Pure, I/O-free input validators (Milestone #7, Phase B).
 *
 * These tighten the boundary so malformed input is rejected cleanly (a 400/409
 * `ValidationError`) instead of slipping into the DB and surfacing as a 500.
 * They are used by the repositories — the single choke point both HTTP routes
 * and programmatic callers pass through — and return simple booleans so callers
 * own the error message/code.
 *
 * Like `domain/date.ts`, this module imports nothing and touches no I/O.
 */

import { ClientStatus, CampaignStatus, CampaignChannel, LeadStatus } from './types';

/** Canonical allowed values, mirroring the row-type unions in `types.ts`. */
export const CLIENT_STATUSES: readonly ClientStatus[] = ['active', 'paused', 'churned'];
export const CAMPAIGN_STATUSES: readonly CampaignStatus[] = ['draft', 'active', 'paused', 'completed'];
export const CAMPAIGN_CHANNELS: readonly CampaignChannel[] = [
  'facebook',
  'tiktok',
  'instagram',
  'email',
  'other',
];
export const LEAD_STATUSES: readonly LeadStatus[] = ['open', 'won', 'lost'];

/** Lead qualification score bounds (matches the schema comment "0..100"). */
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A canonical (v1–v5) UUID string. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Deliberately conservative: one local part, one domain with a dot, no spaces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A plausibly-valid email address (shape + length only — no delivery check). */
export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);
}

/** Membership in a fixed set of allowed string values (enum guard). */
export function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** An integer within an inclusive range. Rejects floats, NaN, and out-of-range. */
export function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
