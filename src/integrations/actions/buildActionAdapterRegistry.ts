import { ActionAdapterRegistry } from './actionAdapterRegistry';

/**
 * Production composition point for G6 command adapters.
 *
 * Intentionally empty in Phase 3. A real adapter may be registered here only
 * after its RepositoryRealms command contract, policy, network proof, rollback
 * drill, command-specific QA, and Product Owner release decision are recorded.
 */
export function buildActionAdapterRegistry(): ActionAdapterRegistry {
  return new ActionAdapterRegistry();
}
