import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { db } from './db/knex';
import { OperatorAccessGuard } from './domain/sourceOperations';
import { validateLiveObserverDeployment } from './domain/liveObserver';
import { inspectLiveObserverPreflight } from './liveObserverPreflight';
import { LiveObserverRepository } from './repositories/liveObserverRepository';

dotenv.config();

interface ObserverInput {
  invocation_key: string;
  tenant_id: string;
  tenant_key: string;
  source_connection_id: string;
  as_of: string | null;
}

function exactInput(raw: unknown): ObserverInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('invalid_observer_input');
  const value = raw as Record<string, unknown>;
  const keys = ['invocation_key', 'tenant_id', 'tenant_key', 'source_connection_id', 'as_of'];
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) throw new Error('invalid_observer_input');
  if (
    typeof value.invocation_key !== 'string'
    || typeof value.tenant_id !== 'string'
    || typeof value.tenant_key !== 'string'
    || typeof value.source_connection_id !== 'string'
    || (value.as_of !== null && typeof value.as_of !== 'string')
  ) throw new Error('invalid_observer_input');
  return value as unknown as ObserverInput;
}

function childScript(name: string): { command: string; args: string[] } {
  const extension = path.extname(__filename);
  const script = path.resolve(__dirname, `${name}${extension}`);
  return { command: process.execPath, args: [...process.execArgv, script] };
}

function childEnvironment(name: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.LEOZOPS_LIVE_OBSERVER_TOKEN;
  delete env.LEOZOPS_OUTPUT_AUTH_SECRET;
  delete env.LEOZOPS_OUTPUT_ADMIN_KEY;
  if (name === 'shadowOperator') {
    delete env.LEOZOPS_PROACTIVE_OPERATOR_TOKEN;
  } else if (name === 'proactiveOperator') {
    delete env.LEOZOPS_OPERATOR_TOKEN;
    delete env.LEOZOPS_SOURCE_BEARER_TOKEN;
  }
  return env;
}

export async function runBoundedChild(name: string, args: string[], timeoutMs: number): Promise<string> {
  const child = childScript(name);
  return new Promise<string>((resolve, reject) => {
    const processHandle = spawn(child.command, [...child.args, ...args], {
      env: childEnvironment(name),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    let outputBytes = 0;
    let stdout = '';
    processHandle.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes <= 64 * 1024) stdout += chunk.toString('utf8');
      else processHandle.kill('SIGTERM');
    });
    processHandle.stderr.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 64 * 1024) processHandle.kill('SIGTERM');
    });
    const timer = setTimeout(() => processHandle.kill('SIGTERM'), timeoutMs);
    processHandle.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    processHandle.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(stdout) : reject(new Error(`${name}_failed`));
    });
  });
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('missing_observer_input');
  const manifestPath = process.env.LEOZOPS_LIVE_DEPLOYMENT_MANIFEST;
  if (!manifestPath) throw new Error('missing_live_deployment_manifest');
  const manifestRaw = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8')) as unknown;
  const preflight = inspectLiveObserverPreflight(manifestRaw, process.env, 'observer');
  const validation = validateLiveObserverDeployment(manifestRaw);
  if (!preflight.ok || !validation.value || !validation.fingerprint) throw new Error('live_observer_preflight_blocked');

  const token = process.env.LEOZOPS_LIVE_OBSERVER_TOKEN;
  const tokenHash = process.env.LEOZOPS_LIVE_OBSERVER_TOKEN_SHA256;
  if (!token || !tokenHash) throw new Error('missing_live_observer_credential');
  new OperatorAccessGuard(tokenHash).assertAuthorized(token);

  const input = exactInput(JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8')) as unknown);
  if (
    input.tenant_id !== validation.value.source.tenant_id
    || input.tenant_key !== validation.value.source.tenant_key
    || input.source_connection_id !== validation.value.source.connection_id
  ) throw new Error('observer_source_identity_mismatch');

  const repository = new LiveObserverRepository(db);
  const existing = await repository.findInvocation(input.tenant_id, input.invocation_key);
  if (existing.length) {
    const completed = existing.find((event) => event.event_type === 'cycle_completed');
    if (completed) {
      console.log(JSON.stringify({
        status: 'ok',
        replayed: true,
        cycle_id: completed.cycle_id,
        evidence_fingerprint: completed.evidence_fingerprint,
      }));
      return;
    }
    throw new Error(existing.some((event) => event.event_type === 'cycle_failed')
      ? 'live_observer_invocation_failed'
      : 'live_observer_invocation_incomplete');
  }
  const cycleId = randomUUID();
  const correlationId = randomUUID();
  let sequence = 1;
  const common = {
    tenant_id: input.tenant_id,
    source_connection_id: input.source_connection_id,
    cycle_id: cycleId,
    invocation_key: input.invocation_key,
    correlation_id: correlationId,
    deployment_fingerprint: validation.fingerprint,
  };
  await repository.appendEvent({ ...common, sequence: sequence++, event_type: 'cycle_started', outcome: 'started', reason_code: 'scheduler_invoked' });
  try {
    const timeout = validation.value.schedule.observer_timeout_seconds * 1000;
    const pollOutput = await runBoundedChild('shadowOperator', [
      'poll', '--tenant-id', input.tenant_id, '--connection-id', input.source_connection_id,
    ], timeout);
    const pollEvidence = JSON.parse(pollOutput) as { correlation_id?: unknown };
    if (typeof pollEvidence.correlation_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(pollEvidence.correlation_id)) {
      throw new Error('invalid_shadow_operator_output');
    }
    await repository.appendEvent({
      ...common,
      correlation_id: pollEvidence.correlation_id,
      sequence: sequence++,
      event_type: 'source_poll_completed',
      outcome: 'succeeded',
      reason_code: 'read_only_poll_succeeded',
    });

    const proactiveInputPath = path.join(os.tmpdir(), `leozops-proactive-${cycleId}.json`);
    try {
      fs.writeFileSync(proactiveInputPath, JSON.stringify({
        tenant_key: input.tenant_key,
        idempotency_key: `observer:${input.invocation_key}`,
        as_of: input.as_of,
      }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await runBoundedChild('proactiveOperator', ['evaluate', proactiveInputPath], timeout);
    } finally {
      try { fs.rmSync(proactiveInputPath, { force: true }); } catch { /* best-effort secret-free temp cleanup */ }
    }
    await repository.appendEvent({ ...common, sequence: sequence++, event_type: 'proactive_evaluation_completed', outcome: 'succeeded', reason_code: 'rules_evaluated' });
    const completed = await repository.appendEvent({ ...common, sequence, event_type: 'cycle_completed', outcome: 'succeeded', reason_code: 'observer_cycle_succeeded' });
    console.log(JSON.stringify({ status: 'ok', cycle_id: cycleId, evidence_fingerprint: completed.evidence_fingerprint }));
  } catch (error) {
    const reason = error instanceof Error && /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/.test(error.message)
      ? error.message
      : 'live_observer_cycle_failed';
    try {
      await repository.appendEvent({ ...common, sequence, event_type: 'cycle_failed', outcome: 'failed', reason_code: reason });
    } catch { /* scheduler failure remains authoritative if evidence storage is unavailable */ }
    throw error;
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error(JSON.stringify({ status: 'blocked', code: 'live_observer_failed' }));
    process.exitCode = 2;
  }).finally(() => db.destroy());
}
