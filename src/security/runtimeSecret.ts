const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const PLACEHOLDER_SECRET = /^(?:<[^>]+>|change[-_ ]?me|dummy(?:[-_ ].*)?|example(?:[-_ ].*)?|password|placeholder(?:[-_ ].*)?|replace[-_ ]?me|secret|test(?:[-_ ].*)?|todo|tbd)$/i;

export interface RuntimeSecretConstraints {
  minLength?: number;
  maxLength?: number;
}

/**
 * Checks only whether a runtime binding is structurally usable. It deliberately
 * never returns, fingerprints, or embeds the supplied value in an error.
 */
export function runtimeSecretIsUsable(
  value: string | undefined,
  constraints: RuntimeSecretConstraints = {},
): boolean {
  const minLength = constraints.minLength ?? 16;
  const maxLength = constraints.maxLength ?? 4_096;
  if (typeof value !== 'string'
    || !Number.isInteger(minLength) || !Number.isInteger(maxLength)
    || minLength < 1 || maxLength < minLength
    || value.length < minLength || value.length > maxLength
    || value !== value.trim()
    || CONTROL_CHARACTERS.test(value)
    || PLACEHOLDER_SECRET.test(value)) {
    return false;
  }
  return true;
}
