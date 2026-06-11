/**
 * Tiny migration runner so we don't depend on the knex CLI + ts-node wiring.
 * Run via the npm scripts:
 *   npm run migrate            -> apply all pending migrations
 *   npm run migrate:rollback   -> roll back the last batch
 *   npm run migrate:status     -> show applied vs pending
 */
import { db } from './knex';

type Command = 'latest' | 'rollback' | 'status';

async function main() {
  const command = (process.argv[2] || 'latest') as Command;

  switch (command) {
    case 'latest': {
      const [batch, applied] = await db.migrate.latest();
      if (applied.length === 0) {
        console.log('Already up to date. No migrations to run.');
      } else {
        console.log(`Applied batch ${batch}:`);
        applied.forEach((m: string) => console.log(`  + ${m}`));
      }
      break;
    }
    case 'rollback': {
      const [batch, reverted] = await db.migrate.rollback();
      if (reverted.length === 0) {
        console.log('Nothing to roll back.');
      } else {
        console.log(`Rolled back batch ${batch}:`);
        reverted.forEach((m: string) => console.log(`  - ${m}`));
      }
      break;
    }
    case 'status': {
      const completed = await db.migrate.list();
      console.log('Applied migrations:');
      (completed[0] as Array<{ name: string }>).forEach((m) => console.log(`  + ${m.name}`));
      console.log('Pending migrations:');
      (completed[1] as Array<{ file: string }>).forEach((m) => console.log(`  - ${m.file}`));
      break;
    }
    default:
      console.error(`Unknown command "${command}". Use: latest | rollback | status`);
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
