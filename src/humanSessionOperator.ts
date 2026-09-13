import { db } from './db/knex';
import { HumanSessionRepository } from './repositories/humanSessionRepository';

async function main(): Promise<void> {
  const [tenantKey, userId, ...rest] = process.argv.slice(2);
  if (rest.length || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(tenantKey || '') || !/^[A-Za-z0-9:_-]{1,128}$/.test(userId || '')) throw new Error('Usage: human:revoke <exact-tenant-key> <exact-human-user-id>');
  const count = await new HumanSessionRepository(db).revokeSubject(tenantKey, userId);
  console.log(JSON.stringify({ action: 'human_sessions_revoked', count }));
}

if (require.main === module) main().catch(() => { console.error('Human session revocation failed; inspect configuration and retry.'); process.exitCode = 1; }).finally(() => db.destroy());
