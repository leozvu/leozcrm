import * as dotenv from 'dotenv';
import { db } from './db/knex';
import { OnboardingService } from './services/onboardingService';
import { signClientToken } from './http/auth';
import { ValidationError } from './errors';

/**
 * Pilot onboarding CLI (Milestone #10): provision the first live tenant on a
 * deployed database and print its credential + readiness, so an operator can
 * verify the launch surface end to end.
 *
 *   AUTH_SECRET=… npm run onboard -- --name "Pilot Co" --email pilot@acme.com [--company Acme]
 *
 * Flags fall back to ONBOARD_NAME / ONBOARD_EMAIL / ONBOARD_COMPANY env vars.
 * The token is signed with AUTH_SECRET — the same secret the running server
 * verifies — so production must set it (this fails loud if it is missing there),
 * mirroring `server.ts`. Outside production it falls back to an insecure dev
 * secret with a warning.
 */

dotenv.config();

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

function resolveSecret(): string {
  const isProd = (process.env.NODE_ENV || 'development') === 'production';
  let secret = process.env.AUTH_SECRET;
  if (isProd && !secret) {
    throw new Error('AUTH_SECRET must be set in production to onboard a tenant (the token would not verify otherwise).');
  }
  if (!secret) {
    secret = 'dev-insecure-secret';
    console.warn('[onboard] AUTH_SECRET not set — issuing a token with an insecure dev secret. Do NOT use in production.');
  }
  return secret;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const name = args.name ?? process.env.ONBOARD_NAME;
  const email = args.email ?? process.env.ONBOARD_EMAIL;
  const company = args.company ?? process.env.ONBOARD_COMPANY ?? null;

  const secret = resolveSecret();
  const result = await new OnboardingService().onboard({ name, email, company });
  const token = signClientToken(result.client.id, secret);

  console.log('Onboarded pilot tenant:');
  console.log(`  client_id : ${result.client.id}`);
  console.log(`  name      : ${result.client.name}`);
  console.log(`  email     : ${result.client.email}`);
  console.log(`  api_token : ${token}`);
  console.log(`  readiness : funnel_stages=${result.readiness.funnel_stages} funnel_ready=${result.readiness.funnel_ready}`);
  if (!result.readiness.funnel_ready) {
    console.warn('  WARNING: funnel stages are not fully seeded on this database — run `npm run seed`.');
  }
}

main()
  .then(() => db.destroy())
  .catch((err) => {
    if (err instanceof ValidationError) {
      console.error(`Onboarding failed (${err.code}): ${err.message}`);
    } else {
      console.error('Onboarding failed:', err instanceof Error ? err.message : err);
    }
    db.destroy().finally(() => process.exit(1));
  });
