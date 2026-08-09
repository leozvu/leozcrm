import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { validateLiveObserverDeployment } from '../src/domain/liveObserver';

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env.local-staging.local');
const composePath = path.join(root, 'deploy', 'local-staging', 'docker-compose.yml');
const manifestPath = path.join(root, 'deploy', 'local-staging', 'deployment.local.json');
const drillDatabase = 'leozops_local_staging_restore_drill';

function main(): void {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
  const validation = validateLiveObserverDeployment(manifest);
  if (
    !validation.ok
    || validation.value?.environment !== 'staging'
    || validation.value.target.provider !== 'docker-local'
    || validation.value.target.database_id !== 'leozops-local-staging-postgres-16'
  ) throw new Error('local_staging_restore_target_unverified');

  const script = [
    `drill_db=${drillDatabase}`,
    'dump=/tmp/leozops-local-staging.dump',
    'cleanup() { dropdb --if-exists -U "$POSTGRES_USER" "$drill_db" >/dev/null 2>&1 || true; rm -f "$dump"; }',
    'trap cleanup EXIT',
    'cleanup',
    'test "$POSTGRES_DB" = "leozops_local_staging"',
    'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges --file="$dump"',
    'createdb -U "$POSTGRES_USER" "$drill_db"',
    'pg_restore -U "$POSTGRES_USER" -d "$drill_db" --no-owner --no-privileges "$dump"',
    'test "$(psql -U "$POSTGRES_USER" -d "$drill_db" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = \'public\' AND table_name IN (\'tenants\', \'jarvis_preference_revisions\')")" = "2"',
    'echo RESTORE_DRILL=PASS',
  ].join('; ');
  const result = spawnSync('docker', [
    'compose', '--env-file', envPath, '--file', composePath,
    'exec', '-T', 'postgres', 'sh', '-ceu', script,
  ], { cwd: root, encoding: 'utf8', shell: false });
  if (result.error || result.status !== 0 || String(result.stdout).trim() !== 'RESTORE_DRILL=PASS') {
    throw new Error('local_staging_restore_drill_failed');
  }
  console.log(JSON.stringify({
    status: 'ok',
    source_database: 'leozops_local_staging',
    disposable_database: drillDatabase,
    result: 'RESTORE_DRILL=PASS',
    disposable_database_removed: true,
    live_gate_claimed: false,
  }, null, 2));
}

try { main(); }
catch (error) {
  console.error(JSON.stringify({
    status: 'blocked',
    code: error instanceof Error ? error.message : 'local_staging_restore_drill_failed',
  }));
  process.exitCode = 2;
}
