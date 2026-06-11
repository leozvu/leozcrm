/**
 * Shared auth fixtures for the HTTP route suites (Milestone #7). A fixed secret
 * + admin key, and helpers to build Authorization headers for an admin caller or
 * a specific client-scoped caller. Not a `*.test.ts` file, so it never auto-runs.
 */
import { AuthConfig, signClientToken } from '../../http/auth';

/** Deterministic auth config the route suites pass to `createApp`. */
export const TEST_AUTH: AuthConfig = { secret: 'test-secret', adminKey: 'test-admin-key' };

/** Authorization header for the admin (cross-tenant) caller. */
export function adminHeaders(): Record<string, string> {
  return { authorization: `Bearer ${TEST_AUTH.adminKey}` };
}

/** Authorization header for a caller scoped to a single client (tenant). */
export function clientHeaders(clientId: string): Record<string, string> {
  return { authorization: `Bearer ${signClientToken(clientId, TEST_AUTH.secret)}` };
}
