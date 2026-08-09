import { createHash } from 'node:crypto';
import { canonicalStringify } from './businessMemory';

export const AMBIENT_JARVIS_PREFERENCE_SCHEMA = 'leozops_ambient_jarvis_preferences_v1' as const;
export const AMBIENT_JARVIS_TABLES = {
  preferences: 'jarvis_preference_revisions',
} as const;

export type JarvisLocale = 'en' | 'vi';
export type JarvisBriefingCadence = 'manual' | 'daily' | 'weekdays';
export type JarvisVoiceOutput = 'off' | 'on_demand';

export interface AmbientJarvisPreferences {
  schema_version: typeof AMBIENT_JARVIS_PREFERENCE_SCHEMA;
  locale: JarvisLocale;
  briefing_cadence: JarvisBriefingCadence;
  timezone: string;
  quiet_hours: { start: string; end: string };
  voice_output: JarvisVoiceOutput;
}

export interface AmbientJarvisPreferenceRecord {
  id: string;
  tenant_id: string;
  version: number;
  previous_revision_id: string | null;
  idempotency_key: string;
  request_hash: string;
  preferences_json: string;
  preferences_hash: string;
  created_by: 'founder';
  created_at: string;
}

export class AmbientJarvisError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 404 | 409 | 500 = 400,
  ) {
    super(message);
    this.name = 'AmbientJarvisError';
  }
}

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const CONTROL = /[\u0000-\u001F\u007F]/;

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AmbientJarvisError('invalid_preferences', `${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, fields: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new AmbientJarvisError('invalid_preferences', `${path} has missing or unsupported fields`);
  }
}

function timezone(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 64 || CONTROL.test(value)) {
    throw new AmbientJarvisError('invalid_preferences', 'preferences.timezone is invalid');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
  } catch {
    throw new AmbientJarvisError('invalid_preferences', 'preferences.timezone must be an IANA timezone');
  }
  return value;
}

export function ambientJarvisHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

export function defaultAmbientJarvisPreferences(): AmbientJarvisPreferences {
  return {
    schema_version: AMBIENT_JARVIS_PREFERENCE_SCHEMA,
    locale: 'en',
    briefing_cadence: 'manual',
    timezone: 'UTC',
    quiet_hours: { start: '22:00', end: '07:00' },
    voice_output: 'off',
  };
}

export function validateAmbientJarvisPreferences(raw: unknown): AmbientJarvisPreferences {
  const root = object(raw, 'preferences');
  exact(root, ['schema_version', 'locale', 'briefing_cadence', 'timezone', 'quiet_hours', 'voice_output'], 'preferences');
  if (root.schema_version !== AMBIENT_JARVIS_PREFERENCE_SCHEMA) {
    throw new AmbientJarvisError('invalid_preferences', `schema_version must equal ${AMBIENT_JARVIS_PREFERENCE_SCHEMA}`);
  }
  if (root.locale !== 'en' && root.locale !== 'vi') {
    throw new AmbientJarvisError('invalid_preferences', 'preferences.locale is unsupported');
  }
  if (!['manual', 'daily', 'weekdays'].includes(String(root.briefing_cadence))) {
    throw new AmbientJarvisError('invalid_preferences', 'preferences.briefing_cadence is unsupported');
  }
  if (root.voice_output !== 'off' && root.voice_output !== 'on_demand') {
    throw new AmbientJarvisError('invalid_preferences', 'preferences.voice_output is unsupported');
  }
  const quiet = object(root.quiet_hours, 'preferences.quiet_hours');
  exact(quiet, ['start', 'end'], 'preferences.quiet_hours');
  if (typeof quiet.start !== 'string' || typeof quiet.end !== 'string'
    || !TIME.test(quiet.start) || !TIME.test(quiet.end) || quiet.start === quiet.end) {
    throw new AmbientJarvisError('invalid_preferences', 'quiet hours must be distinct HH:MM values');
  }
  return {
    schema_version: AMBIENT_JARVIS_PREFERENCE_SCHEMA,
    locale: root.locale,
    briefing_cadence: root.briefing_cadence as JarvisBriefingCadence,
    timezone: timezone(root.timezone),
    quiet_hours: { start: quiet.start, end: quiet.end },
    voice_output: root.voice_output,
  };
}

export function parseAmbientJarvisPreferenceRecord(record: AmbientJarvisPreferenceRecord): AmbientJarvisPreferences {
  let raw: unknown;
  try { raw = JSON.parse(record.preferences_json); } catch {
    throw new AmbientJarvisError('corrupt_preferences', 'stored preference JSON is invalid', 500);
  }
  const preferences = validateAmbientJarvisPreferences(raw);
  if (ambientJarvisHash(preferences) !== record.preferences_hash
    || !Number.isInteger(record.version) || record.version < 1
    || record.created_by !== 'founder') {
    throw new AmbientJarvisError('corrupt_preferences', 'stored preference fingerprint is invalid', 500);
  }
  return preferences;
}
