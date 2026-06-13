/**
 * PostgreSQL lifecycle smoke (Milestone #7, Phase C).
 *
 * Proves the dialect-portable migrations/queries run cleanly on PostgreSQL:
 *   migrate latest  ->  seed reference data + verify  ->  rollback + verify drop
 *
 * It is **env-gated**: it only runs when a PostgreSQL target is configured
 * (`DATABASE_URL` or `PGHOST`), and otherwise skips with a clear message and a
 * zero exit so it is safe to call in any environment. When it does run, any
 * failure (a SQLite-only assumption, a non-reversible migration) is loud and
 * non-zero.
 *
 * Run: npm run db:smoke:pg     (with DATABASE_URL or PG* env set)
 * See: docs/POSTGRES_SMOKE.md
 */
import knexFactory from 'knex';
import config from '../../knexfile';
import { seedFunnelStages } from './fixtures';
import { ClientRepository } from '../repositories/clientRepository';
import { TaskRepository } from '../repositories/taskRepository';
import { TaskService } from '../services/taskService';

function postgresConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.PGHOST);
}

async function tableExists(db: ReturnType<typeof knexFactory>, name: string): Promise<boolean> {
  const row = await db('information_schema.tables')
    .where({ table_schema: 'public', table_name: name })
    .first();
  return Boolean(row);
}

async function main(): Promise<void> {
  if (!postgresConfigured()) {
    console.log(
      'Postgres smoke skipped: set DATABASE_URL (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE) to run it.',
    );
    return;
  }

  const db = knexFactory(config.production);
  try {
    console.log('Postgres smoke: applying migrations…');
    await db.migrate.latest();
    for (const t of ['funnel_stages', 'clients', 'campaigns', 'leads', 'tasks', 'task_status_events']) {
      if (!(await tableExists(db, t))) {
        throw new Error(`expected table "${t}" to exist after migrate:latest`);
      }
    }

    console.log('Postgres smoke: seeding reference data…');
    const seeded = await seedFunnelStages(db);
    const stageCount = Number((await db('funnel_stages').count<{ c: string }[]>({ c: '*' }))[0].c);
    if (stageCount !== 9) {
      throw new Error(`expected 9 funnel stages after seed, got ${stageCount}`);
    }
    console.log(`  seeded ${seeded} funnel stages, ${stageCount} present.`);

    console.log('Postgres smoke: exercising the task lifecycle…');
    const client = await new ClientRepository(db).create({ name: 'PG Smoke', email: 'pg-smoke@example.com' });
    const taskService = new TaskService(new TaskRepository(db));
    const task = await taskService.create(client.id, { title: 'PG smoke task' }, 'admin');
    const moved = await taskService.transition(task, 'in_progress', { actor: 'admin', note: 'go' });
    if (!moved || moved.status !== 'in_progress') {
      throw new Error('expected task to transition open → in_progress');
    }
    const events = await taskService.statusEvents(task.id);
    const order = events.map((e) => e.to_status).join(',');
    const seqs = events.map((e) => e.seq).join(',');
    if (order !== 'open,in_progress') {
      throw new Error(`unexpected audit order: ${order}`);
    }
    if (seqs !== '1,2') {
      throw new Error(`expected monotonic audit seq "1,2", got "${seqs}"`);
    }
    console.log('  task lifecycle + monotonic audit seq verified.');

    console.log('Postgres smoke: rolling back…');
    await db.migrate.rollback();
    for (const t of ['task_status_events', 'tasks', 'leads', 'campaigns', 'clients', 'funnel_stages']) {
      if (await tableExists(db, t)) {
        throw new Error(`expected table "${t}" to be dropped after migrate:rollback`);
      }
    }

    console.log('Postgres migrate/seed/rollback smoke PASSED.');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error('Postgres smoke FAILED:', err);
  process.exitCode = 1;
});
