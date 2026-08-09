import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { db } from './db/knex';
import { secretEnvironmentName, validateLiveObserverDeployment } from './domain/liveObserver';
import { LiveObserverRepository } from './repositories/liveObserverRepository';

dotenv.config();

const RESTORE_ACK = 'RESTORE_TO_DISPOSABLE_DATABASE_ONLY';
const SAFE_SERVICE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,62}$/;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;

export interface RecoveryCommandPlan {
  program: 'pg_dump' | 'pg_restore' | 'psql';
  args: string[];
}

function service(value: string | undefined, code: string): string {
  if (!value || !SAFE_SERVICE.test(value)) throw new Error(code);
  return value;
}

function databaseName(value: string | undefined, code: string): string {
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9_.-]{1,62}$/.test(value)) throw new Error(code);
  return value;
}

export function backupCommand(serviceName: string, outputFile: string): RecoveryCommandPlan {
  return {
    program: 'pg_dump',
    args: ['--dbname', `service=${service(serviceName, 'invalid_production_pg_service')}`, '--format=custom', '--no-owner', '--no-privileges', '--file', outputFile],
  };
}

export function restoreCommands(productionService: string, restoreService: string, artifact: string, acknowledgement: string | undefined): RecoveryCommandPlan[] {
  const source = service(productionService, 'invalid_production_pg_service');
  const target = service(restoreService, 'invalid_restore_pg_service');
  if (source === target) throw new Error('restore_target_must_differ_from_production');
  if (acknowledgement !== RESTORE_ACK) throw new Error('restore_drill_acknowledgement_required');
  return [
    {
      program: 'pg_restore',
      args: ['--dbname', `service=${target}`, '--clean', '--if-exists', '--exit-on-error', '--no-owner', '--no-privileges', artifact],
    },
    {
      program: 'psql',
      args: ['--dbname', `service=${target}`, '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--command', "SELECT count(*) FROM knex_migrations WHERE name LIKE '20260801210000%';"],
    },
  ];
}

function postgresClientEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of [
    'DATABASE_URL', 'PGPASSWORD', 'AUTH_SECRET', 'ADMIN_API_KEY', 'OPENAI_API_KEY',
    'RESEND_API_KEY', 'LEOZOPS_OUTPUT_AUTH_SECRET', 'LEOZOPS_OUTPUT_ADMIN_KEY',
    'LEOZOPS_SOURCE_BEARER_TOKEN', 'LEOZOPS_OPERATOR_TOKEN',
    'LEOZOPS_PROACTIVE_OPERATOR_TOKEN', 'LEOZOPS_LIVE_OBSERVER_TOKEN',
  ]) delete env[name];
  return env;
}

async function run(plan: RecoveryCommandPlan): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(plan.program, plan.args, {
      env: postgresClientEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    let stdout = '';
    let bytes = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= 16 * 1024) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024) child.kill('SIGTERM');
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${plan.program}_failed`)));
  });
}

async function hashFile(file: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk: string | Buffer) => {
      const value = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      bytes += value.length;
      hash.update(value);
    });
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return { sha256: `sha256:${hash.digest('hex')}`, bytes };
}

async function toolVersion(program: 'pg_dump' | 'pg_restore'): Promise<string> {
  const output = await run({ program, args: ['--version'] });
  const match = output.match(/\b(\d+(?:\.\d+){0,2})\b/);
  return match ? `postgresql-${match[1]}` : 'postgresql-client';
}

async function main(): Promise<void> {
  const [command, drillKey, targetPath] = process.argv.slice(2);
  if ((command !== 'backup' && command !== 'restore') || !drillKey || !SAFE_KEY.test(drillKey) || !targetPath) {
    throw new Error('usage_recovery_operator');
  }
  const manifestPath = process.env.LEOZOPS_LIVE_DEPLOYMENT_MANIFEST;
  if (!manifestPath) throw new Error('missing_live_deployment_manifest');
  const raw = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8')) as unknown;
  const validation = validateLiveObserverDeployment(raw);
  if (!validation.ok || !validation.value || !validation.fingerprint) throw new Error('live_observer_preflight_blocked');
  const databaseBinding = secretEnvironmentName(validation.value.secret_bindings.database_url);
  if (
    process.env.NODE_ENV !== 'production'
    || process.env.LEOZOPS_DATABASE_ID !== validation.value.target.database_id
    || !databaseBinding
    || !process.env[databaseBinding]
  ) throw new Error('recovery_database_identity_blocked');

  const repository = new LiveObserverRepository(db);
  const startedAt = new Date().toISOString();
  let artifact: { sha256: string; bytes: number } | undefined;
  const productionService = service(process.env.LEOZOPS_PG_SERVICE, 'missing_production_pg_service');
  const resolved = path.resolve(targetPath);
  const version = await toolVersion(command === 'backup' ? 'pg_dump' : 'pg_restore');
  try {
    if (command === 'backup') {
      const directory = path.dirname(resolved);
      const stat = fs.statSync(directory);
      if (!stat.isDirectory()) throw new Error('backup_directory_invalid');
      if (fs.existsSync(resolved)) throw new Error('backup_artifact_already_exists');
      await run(backupCommand(productionService, resolved));
      artifact = await hashFile(resolved);
    } else {
      if (!fs.statSync(resolved).isFile()) throw new Error('restore_artifact_invalid');
      artifact = await hashFile(resolved);
      const productionDatabase = databaseName(
        process.env.LEOZOPS_PRODUCTION_DATABASE_NAME,
        'missing_production_database_name',
      );
      const restoreDatabase = databaseName(
        process.env.LEOZOPS_RESTORE_DRILL_DATABASE_NAME,
        'missing_restore_database_name',
      );
      if (productionDatabase === restoreDatabase) throw new Error('restore_database_name_must_differ');
      const restoreService = process.env.LEOZOPS_RESTORE_DRILL_PG_SERVICE ?? '';
      const identity = await run({
        program: 'psql',
        args: ['--dbname', `service=${service(restoreService, 'invalid_restore_pg_service')}`, '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--command', 'SELECT current_database();'],
      });
      if (identity !== restoreDatabase) throw new Error('restore_target_identity_mismatch');
      const plans = restoreCommands(
        productionService,
        restoreService,
        resolved,
        process.env.LEOZOPS_RESTORE_DRILL_ACK,
      );
      for (const plan of plans) {
        const output = await run(plan);
        if (plan.program === 'psql' && output !== '1') throw new Error('restore_schema_verification_failed');
      }
    }
    const completedAt = new Date().toISOString();
    const record = await repository.recordRecoveryDrill({
      drill_key: drillKey,
      kind: command,
      target_class: command === 'backup' ? 'production_source' : 'disposable_restore_target',
      status: 'succeeded',
      artifact_sha256: artifact.sha256,
      artifact_bytes: artifact.bytes,
      tool_version: version,
      reason_code: command === 'backup' ? 'backup_verified' : 'disposable_restore_verified',
      deployment_fingerprint: validation.fingerprint,
      started_at: startedAt,
      completed_at: completedAt,
    });
    console.log(JSON.stringify({ status: 'ok', drill_id: record.id, evidence_fingerprint: record.evidence_fingerprint }));
  } catch (error) {
    const completedAt = new Date().toISOString();
    const reason = error instanceof Error && SAFE_KEY.test(error.message) ? error.message : 'recovery_drill_failed';
    try {
      await repository.recordRecoveryDrill({
        drill_key: drillKey,
        kind: command,
        target_class: command === 'backup' ? 'production_source' : 'disposable_restore_target',
        status: 'failed',
        artifact_sha256: artifact?.sha256 ?? null,
        artifact_bytes: artifact?.bytes ?? null,
        tool_version: version,
        reason_code: reason,
        deployment_fingerprint: validation.fingerprint,
        started_at: startedAt,
        completed_at: completedAt,
      });
    } catch { /* external scheduler still receives the failure */ }
    throw error;
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error(JSON.stringify({ status: 'blocked', code: 'recovery_operator_failed' }));
    process.exitCode = 2;
  }).finally(() => db.destroy());
}
