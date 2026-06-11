/**
 * Pure date helpers shared across the agent/service layers. No I/O.
 */

/**
 * True only for a real `YYYY-MM-DD` calendar date (UTC).
 *
 * The shape regex alone is not enough: values like `2026-99-99` or `2026-02-30`
 * match `\d{4}-\d{2}-\d{2}` but are not real dates. We confirm validity by
 * round-tripping through `Date` — if the parsed date does not serialize back to
 * the same `YYYY-MM-DD`, it was invalid (or silently rolled over) and is
 * rejected. This keeps invalid-but-date-shaped input from reaching downstream
 * date math (see M3 Codex review on `asOf`).
 */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
