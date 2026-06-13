import { Client } from '../domain/types';
import { ValidationError } from '../errors';
import { FUNNEL_STAGES } from '../domain/funnel';
import { ClientRepository, clientRepository } from '../repositories/clientRepository';
import { FunnelStageRepository, funnelStageRepository } from '../repositories/funnelStageRepository';

/**
 * Client onboarding workflow (Milestone #10).
 *
 * Provisions a new tenant for the MVP launch: it creates the client record and
 * reports whether the platform is ready for that tenant to use the funnel (the
 * canonical funnel stages are global reference data seeded once at deploy via
 * `npm run seed`, not per-tenant). It deliberately does NOT mint the tenant's
 * API token — token signing is an auth/http concern, so the caller at the HTTP
 * boundary (the `/onboarding` route) or the `npm run onboard` CLI issues it.
 * This keeps the service free of any http-layer import.
 *
 * Like the other services it is dependency-injected with singleton defaults, so
 * `createApp({ knex })` and the tests can point it at a seeded in-memory DB.
 */

export interface OnboardingInput {
  name?: string;
  email?: string;
  company?: string | null;
  notes?: string | null;
}

/** Platform-readiness summary returned alongside a freshly onboarded tenant. */
export interface OnboardingReadiness {
  /** How many canonical funnel stages are seeded on this database. */
  funnel_stages: number;
  /** True when all canonical stages are present (the tenant can use the funnel). */
  funnel_ready: boolean;
}

export interface OnboardingResult {
  client: Client;
  readiness: OnboardingReadiness;
}

export class OnboardingService {
  constructor(
    private readonly clients: ClientRepository = clientRepository,
    private readonly stages: FunnelStageRepository = funnelStageRepository,
  ) {}

  /**
   * Onboard a tenant. Required `name`/`email` are guarded here (so a direct/CLI
   * caller gets a clean 400 rather than a DB NOT NULL 500); the email *shape* is
   * validated by `ClientRepository.create`. Re-onboarding an existing email is a
   * 409 rather than silently creating a duplicate tenant.
   */
  async onboard(input: OnboardingInput): Promise<OnboardingResult> {
    if (!input.name || !input.email) {
      throw new ValidationError(400, 'name and email are required to onboard a client', 'invalid_onboarding');
    }
    const existing = await this.clients.findByEmail(input.email);
    if (existing) {
      throw new ValidationError(409, 'a client with this email already exists', 'client_exists');
    }
    const client = await this.clients.create({
      name: input.name,
      email: input.email,
      company: input.company ?? null,
      notes: input.notes ?? null,
    });
    const present = await this.stages.count();
    return {
      client,
      readiness: { funnel_stages: present, funnel_ready: present === FUNNEL_STAGES.length },
    };
  }
}

export const onboardingService = new OnboardingService();
