import assert from 'node:assert/strict';
import test from 'node:test';
import qualificationInput from '../../config/phase14.repositoryrealms-task-create.audit.json';
import { G6ActionPolicyManifest, credentialFingerprint, g6PolicyFingerprint } from '../domain/g6Policy';
import {
  REPOSITORYREALMS_ACTION_RELEASE_SCHEMA,
  repositoryRealmsReleaseConfigurationDigest,
  validateRepositoryRealmsActionRelease,
} from '../domain/repositoryRealmsActionRelease';
import { actionFingerprint } from '../domain/supervisedAction';
import { validateSupervisedHandQualification } from '../domain/supervisedHand';
import { evaluateRepositoryRealmsAdapterPreflight } from '../repositoryRealmsAdapterPreflight';
import { buildActionAdapterRegistry } from '../integrations/actions/buildActionAdapterRegistry';
import { buildReleasedRepositoryRealmsActionRegistry } from '../integrations/actions/buildReleasedRepositoryRealmsActionRegistry';
import {
  REPOSITORYREALMS_TASK_APPROVAL_RECEIPT_CONTRACT,
  REPOSITORYREALMS_TASK_COMMAND_CONTRACT,
  REPOSITORYREALMS_TASK_COMMAND_KEY,
  REPOSITORYREALMS_TASK_COMMAND_PATH,
  REPOSITORYREALMS_TASK_COMMAND_RECEIPT_CONTRACT,
  REPOSITORYREALMS_TASK_COMMAND_ADAPTER_ID,
  REPOSITORYREALMS_TASK_COMMAND_ADAPTER_VERSION,
  RepositoryRealmsTaskCommandAdapter,
  RepositoryRealmsTaskCommandHttpRequest,
  RepositoryRealmsTaskCommandTransport,
} from '../integrations/actions/repositoryRealmsTaskCommandAdapter';

const ENDPOINT = `https://repositoryrealms.test${REPOSITORYREALMS_TASK_COMMAND_PATH}`;
const TARGET_ENTITY = 'egoric';
const TARGET_PROJECT = 'realm-project';
const IDEMPOTENCY = 'leozops-proposal-idempotency-0001';
const CREDENTIALS = {
  preview: 'preview-credential-00000001',
  approve_execute: 'execute-approval-credential-00000002',
  execute: 'execute-operator-credential-00000003',
  preview_rollback: 'rollback-preview-credential-00000004',
  approve_rollback: 'rollback-approval-credential-00000005',
  rollback: 'rollback-operator-credential-00000006',
  receipts_read: 'receipt-observer-credential-00000007',
};
const SUBJECTS = {
  preview: 'leozops_preview_subject',
  approve_execute: 'leozops_execute_approver',
  execute: 'leozops_execute_operator',
  preview_rollback: 'leozops_rollback_preview',
  approve_rollback: 'leozops_rollback_approver',
  rollback: 'leozops_rollback_operator',
};
const PAYLOAD = {
  title: 'Review stalled opportunities',
  note: 'Check the latest accepted operating evidence.',
  due_date: '2026-08-12',
  priority: 'high' as const,
  estimated_hours: 2,
};
const PROVIDER_PAYLOAD = {
  title: PAYLOAD.title,
  note: PAYLOAD.note,
  dueDate: PAYLOAD.due_date,
  priority: PAYLOAD.priority,
  estHours: PAYLOAD.estimated_hours,
};
const NOW = '2026-08-08T12:00:00.000Z';

function repository(receiptId: string, preview: boolean) {
  return {
    name: 'RepositoryRealms',
    receiptId,
    invariants: {
      authorization: 'enforced',
      businessRules: 'enforced',
      receipt: preview ? 'not_persisted_by_design' : 'verified',
      audit: preview ? 'not_written_by_design' : 'atomic',
      previewBusinessMutationCount: 0,
      approvalSeparation: 'credential_and_subject',
    },
  };
}

function providerTargetFingerprint() {
  return actionFingerprint({
    system: 'egoric',
    targetEntityId: TARGET_ENTITY,
    endpointPath: REPOSITORYREALMS_TASK_COMMAND_PATH,
    commandKey: REPOSITORYREALMS_TASK_COMMAND_KEY,
  });
}

function sourcePreview(body: any) {
  const execute = body.operation === 'preview';
  const requestFingerprint = actionFingerprint(execute
    ? { commandKey: REPOSITORYREALMS_TASK_COMMAND_KEY, targetEntityId: TARGET_ENTITY, payload: body.payload }
    : { commandKey: REPOSITORYREALMS_TASK_COMMAND_KEY, targetEntityId: TARGET_ENTITY, commandId: body.commandId, operation: 'rollback' });
  const effectFingerprint = actionFingerprint(execute
    ? { effect: 'create_unassigned_task', payload: body.payload }
    : { effect: 'delete_exact_command_task', commandId: body.commandId, taskStateFingerprint: actionFingerprint('task-state') });
  const preview = {
    kind: execute ? 'execute' : 'rollback',
    requestFingerprint,
    targetFingerprint: providerTargetFingerprint(),
    effectFingerprint,
    previewFingerprint: '',
    summaryCode: execute ? 'create_unassigned_task' : 'delete_exact_unchanged_command_task',
    rollbackStrategyCode: execute ? 'delete_exact_unchanged_command_task' : 'not_applicable',
    estimatedCostMinor: 0,
    currency: 'VND',
    externalMutationCount: 0,
    previewedAt: NOW,
    expiresAt: '2026-08-08T12:10:00.000Z',
  };
  preview.previewFingerprint = actionFingerprint({
    kind: preview.kind,
    requestFingerprint: preview.requestFingerprint,
    targetFingerprint: preview.targetFingerprint,
    effectFingerprint: preview.effectFingerprint,
    rollbackStrategyCode: preview.rollbackStrategyCode,
  });
  return preview;
}

function json(status: number, body: unknown) {
  return { status, body: JSON.stringify(body), contentType: 'application/json' };
}

class SourceHarness {
  readonly calls: Array<{ request: RepositoryRealmsTaskCommandHttpRequest; body: any; operation: string }> = [];
  readonly receipts = new Map<string, unknown>();
  rejectOperation: string | null = null;
  rejectStatus = 403;
  tamperPreview = false;

  readonly transport: RepositoryRealmsTaskCommandTransport = async (request) => {
    if (request.method === 'GET') {
      const correlationId = new URL(request.url).searchParams.get('correlationId')!;
      this.calls.push({ request, body: null, operation: 'receipt' });
      return json(200, this.receipts.get(correlationId));
    }
    const body = JSON.parse(request.body!);
    const operation = body.operation as string;
    this.calls.push({ request, body, operation });
    assert.equal(request.headers['X-LeozOps-Operation'], operation);
    assert.equal(request.headers['X-LeozOps-Actor-Subject'], body.actorSubject);
    assert.equal(request.headers['Idempotency-Key'], body.idempotencyKey);
    assert.equal(request.headers['X-Correlation-ID'], body.correlationId);
    assert.equal(request.headers['X-CEO-Entity-ID'], TARGET_ENTITY);
    if (this.rejectOperation === operation) {
      return json(this.rejectStatus, { error: 'bounded rejection', code: 'leozops_task_write_forbidden' });
    }
    if (operation === 'preview' || operation === 'preview_rollback') {
      const preview = sourcePreview(body);
      if (this.tamperPreview) preview.effectFingerprint = actionFingerprint('tampered');
      return json(200, {
        contract: REPOSITORYREALMS_TASK_COMMAND_CONTRACT,
        version: 1,
        operation,
        commandKey: REPOSITORYREALMS_TASK_COMMAND_KEY,
        preview,
        ...(operation === 'preview_rollback' ? {
          subject: { commandId: body.commandId, executionResultFingerprint: actionFingerprint('execution-result') },
        } : {}),
        repository: repository(body.correlationId, true),
      });
    }
    if (operation === 'approve_execute' || operation === 'approve_rollback') {
      const preview = sourcePreview(operation === 'approve_execute'
        ? { operation: 'preview', payload: body.payload }
        : { operation: 'preview_rollback', commandId: body.commandId });
      return json(201, {
        contract: REPOSITORYREALMS_TASK_APPROVAL_RECEIPT_CONTRACT,
        version: 1,
        approval: {
          id: operation === 'approve_execute' ? 'approval-execute-001' : 'approval-rollback-001',
          kind: operation === 'approve_execute' ? 'execute' : 'rollback',
          targetEntityId: TARGET_ENTITY,
          approvedBySubject: body.actorSubject,
          requestFingerprint: preview.requestFingerprint,
          previewFingerprint: preview.previewFingerprint,
          subjectCommandId: body.commandId ?? null,
          approvedAt: NOW,
          expiresAt: '2026-08-08T12:15:00.000Z',
          consumed: false,
          replayed: false,
        },
        repository: repository(operation === 'approve_execute' ? 'approval-execute-001' : 'approval-rollback-001', false),
      });
    }
    const rollback = operation === 'rollback';
    const commandId = 'command-001';
    const receipt = {
      contract: REPOSITORYREALMS_TASK_COMMAND_RECEIPT_CONTRACT,
      version: 1,
      receipt: {
        id: rollback ? `rollback:${commandId}` : commandId,
        commandId,
        commandKey: REPOSITORYREALMS_TASK_COMMAND_KEY,
        operation,
        targetEntityId: TARGET_ENTITY,
        actorSubject: body.actorSubject,
        correlationId: body.correlationId,
        resource: 'tasks',
        recordId: 'task-001',
        requestFingerprint: sourcePreview(rollback
          ? { operation: 'preview_rollback', commandId }
          : { operation: 'preview', payload: body.payload }).requestFingerprint,
        resultFingerprint: actionFingerprint({ operation, commandId }),
        resultCode: rollback ? 'task_create_rolled_back' : 'task_created',
        externalMutationCount: 1,
        committedAt: NOW,
        replayed: false,
      },
      state: rollback ? 'rolled_back' : 'active',
      repository: repository(rollback ? `rollback:${commandId}` : commandId, false),
    };
    this.receipts.set(body.correlationId, receipt);
    return json(201, receipt);
  };
}

function adapter(harness: SourceHarness) {
  return new RepositoryRealmsTaskCommandAdapter({
    environment: 'test',
    endpointUrl: ENDPOINT,
    targetEntityId: TARGET_ENTITY,
    expectedProjectId: TARGET_PROJECT,
    expectedTenantKey: TARGET_ENTITY,
    credentials: CREDENTIALS,
    subjects: SUBJECTS,
    transport: harness.transport,
  });
}

function target() {
  return {
    targetProjectId: TARGET_PROJECT,
    targetTenantKey: TARGET_ENTITY,
    targetEndpointUrl: ENDPOINT,
    targetCredentialFingerprint: credentialFingerprint(CREDENTIALS.execute),
  };
}

test('exact adapter performs fresh preview, separated approval, execute, observation, and rollback', async () => {
  const source = new SourceHarness();
  const subject = adapter(source);
  const executePreview = await subject.preview({ ...target(), payload: PAYLOAD, idempotencyKey: IDEMPOTENCY });
  const execution = await subject.execute({
    ...target(), payload: PAYLOAD, idempotencyKey: IDEMPOTENCY, preview: executePreview,
  });
  assert.deepEqual({ outcome: execution.outcome, mutations: execution.external_mutation_count }, { outcome: 'succeeded', mutations: 1 });
  assert.equal(execution.external_request_id, 'command-001');
  const observedExecute = await subject.observeReceipt({ operation: 'execute', idempotencyKey: IDEMPOTENCY });
  assert.equal(observedExecute.commandId, execution.external_request_id);

  const proposal = { proposal_fingerprint: actionFingerprint('proposal') } as any;
  const attempt = {
    status: 'succeeded',
    external_request_id: execution.external_request_id,
    result_fingerprint: execution.result_fingerprint,
  } as any;
  const rollbackIdempotency = 'rollback:550e8400-e29b-41d4-a716-446655440000';
  const rollbackPreview = await subject.previewRollback({
    ...target(), proposal, execution: attempt, idempotencyKey: rollbackIdempotency,
  });
  const rolledBack = await subject.rollback({
    ...target(), proposal, execution: attempt, idempotencyKey: rollbackIdempotency,
    preview: rollbackPreview as any,
  });
  assert.deepEqual({ outcome: rolledBack.outcome, mutations: rolledBack.external_mutation_count }, { outcome: 'succeeded', mutations: 1 });
  const observedRollback = await subject.observeReceipt({ operation: 'rollback', idempotencyKey: rollbackIdempotency });
  assert.equal(observedRollback.resultCode, 'task_create_rolled_back');

  assert.deepEqual(source.calls.map((call) => call.operation), [
    'preview',
    'preview', 'approve_execute', 'execute',
    'receipt',
    'preview_rollback',
    'preview_rollback', 'approve_rollback', 'rollback',
    'receipt',
  ]);
  const authorizations = source.calls
    .map((call) => call.request.headers.Authorization)
    .filter((value): value is string => Boolean(value));
  assert.equal(new Set(authorizations).size, 7, 'each source scope uses a distinct credential');
  assert.equal(JSON.stringify(subject.descriptor).includes('credential'), false);
});

test('bounded-autonomy human recovery maps to the same fresh separately approved source rollback', async () => {
  const source = new SourceHarness();
  const subject = adapter(source);
  const recoverySubject = {
    original_request_fingerprint: actionFingerprint('original-request'),
    original_result_fingerprint: actionFingerprint('original-result'),
    original_external_request_id: 'command-001',
    original_idempotency_key: IDEMPOTENCY,
  };
  const recoveryIdempotency = 'recovery:550e8400-e29b-41d4-a716-446655440000';
  const preview = await subject.previewRecovery!({
    ...target(), subject: recoverySubject, idempotencyKey: recoveryIdempotency,
  });
  const recovered = await subject.recover!({
    ...target(), subject: recoverySubject, idempotencyKey: recoveryIdempotency, preview,
  });
  assert.equal(recovered.outcome, 'succeeded');
  assert.equal(recovered.result_code, 'task_create_rolled_back');
  assert.deepEqual(source.calls.map((call) => call.operation), [
    'preview_rollback', 'preview_rollback', 'approve_rollback', 'rollback',
  ]);
});

test('payload, endpoint, tenant, project, credential, and approval separation fail before transport', async () => {
  const source = new SourceHarness();
  const subject = adapter(source);
  assert.throws(() => subject.validatePayload({ ...PAYLOAD, assignee_id: 'person-1' }));
  assert.throws(() => subject.validatePayload({ ...PAYLOAD, note: 'Email ceo@example.test' }));
  await assert.rejects(subject.preview({
    ...target(), targetTenantKey: 'other-tenant', payload: PAYLOAD, idempotencyKey: IDEMPOTENCY,
  }), (error: any) => error.code === 'repositoryrealms_adapter_target_mismatch');
  assert.equal(source.calls.length, 0);
  assert.throws(() => new RepositoryRealmsTaskCommandAdapter({
    environment: 'production',
    endpointUrl: ENDPOINT.replace('https:', 'http:'),
    targetEntityId: TARGET_ENTITY,
    expectedProjectId: TARGET_PROJECT,
    expectedTenantKey: TARGET_ENTITY,
    credentials: CREDENTIALS,
    subjects: { ...SUBJECTS, approve_execute: SUBJECTS.execute },
  }));
});

test('definitive pre-mutation rejection is failed evidence while 5xx remains unknown', async () => {
  const definitive = new SourceHarness();
  definitive.rejectOperation = 'approve_execute';
  definitive.rejectStatus = 403;
  const first = adapter(definitive);
  const preview = await first.preview({ ...target(), payload: PAYLOAD, idempotencyKey: IDEMPOTENCY });
  const failed = await first.execute({ ...target(), payload: PAYLOAD, idempotencyKey: IDEMPOTENCY, preview });
  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.external_mutation_count, 0);

  const unknown = new SourceHarness();
  unknown.rejectOperation = 'execute';
  unknown.rejectStatus = 503;
  const second = adapter(unknown);
  const secondPreview = await second.preview({ ...target(), payload: PAYLOAD, idempotencyKey: IDEMPOTENCY });
  await assert.rejects(
    second.execute({ ...target(), payload: PAYLOAD, idempotencyKey: IDEMPOTENCY, preview: secondPreview }),
    (error: any) => error.code === 'leozops_task_write_forbidden' && error.definitive === false,
  );
});

test('tampered provider preview fails closed and no mutation operation follows', async () => {
  const source = new SourceHarness();
  source.tamperPreview = true;
  const subject = adapter(source);
  await assert.rejects(
    subject.preview({ ...target(), payload: PAYLOAD, idempotencyKey: IDEMPOTENCY }),
    (error: any) => error.code === 'repositoryrealms_response_invalid',
  );
  assert.deepEqual(source.calls.map((call) => call.operation), ['preview']);
  assert.deepEqual(PROVIDER_PAYLOAD, {
    title: PAYLOAD.title,
    note: PAYLOAD.note,
    dueDate: PAYLOAD.due_date,
    priority: PAYLOAD.priority,
    estHours: PAYLOAD.estimated_hours,
  });
});

function qualifiedSource() {
  return structuredClone(qualificationInput) as any;
}

function acceptedG6Policy(): G6ActionPolicyManifest {
  return {
    schema_version: 'leozops_g6_action_policy_v1',
    policy_id: 'G6-repositoryrealms-task-create',
    status: 'accepted',
    environment: 'test',
    approved_by: 'Leoz',
    approved_at: '2026-08-08T11:00:00.000Z',
    valid_from: '2026-08-08T11:30:00.000Z',
    valid_until: '2026-08-09T11:30:00.000Z',
    tenant_id: '550e8400-e29b-41d4-a716-446655440000',
    source_connection_id: '550e8400-e29b-41d4-a716-446655440001',
    g5_release: {
      decision_id: '550e8400-e29b-41d4-a716-446655440002',
      evidence_key: actionFingerprint('g5-evidence'),
      evaluation_fingerprint: actionFingerprint('g5-evaluation'),
      decision: 'go',
    },
    target: {
      system: 'egoric',
      project_id: TARGET_PROJECT,
      tenant_key: TARGET_ENTITY,
      command_endpoint_url: ENDPOINT,
      command_credential_sha256: credentialFingerprint(CREDENTIALS.execute),
    },
    command: {
      key: REPOSITORYREALMS_TASK_COMMAND_KEY,
      version: 'v1',
      adapter_id: REPOSITORYREALMS_TASK_COMMAND_ADAPTER_ID,
      risk_tier: 'low',
      supports_dry_run: true,
      supports_idempotency: true,
      supports_rollback: true,
      mutation_count_max: 1,
    },
    identities: {
      approver: 'Leoz',
      approval_credential_sha256: credentialFingerprint('leozops-g6-approval-credential-0001'),
      operator: 'Leoz',
      operator_credential_sha256: credentialFingerprint('leozops-g6-operator-credential-0002'),
    },
    limits: {
      max_cost_minor: 100,
      currency: 'VND',
      max_executions_per_hour: 2,
      max_executions_per_day: 5,
      approval_ttl_minutes: 15,
      execution_lease_seconds: 60,
    },
    verdict: 'accepted',
  };
}

function acceptedRelease() {
  const qualification = qualifiedSource();
  const qualified = validateSupervisedHandQualification(qualification);
  const g6Policy = acceptedG6Policy();
  const release: any = {
    schema_version: REPOSITORYREALMS_ACTION_RELEASE_SCHEMA,
    release_id: 'J6-repositoryrealms-task-create-release',
    status: 'accepted',
    environment: 'test',
    approved_by: 'Leoz',
    approved_at: '2026-08-08T11:45:00.000Z',
    valid_from: '2026-08-08T12:00:00.000Z',
    valid_until: '2026-08-09T11:00:00.000Z',
    source: {
      repository: 'leozvu/repositoryrealms',
      source_ref: 'main',
      source_commit: qualification.source_commit,
      qualification_fingerprint: qualified.fingerprint,
      source_patch_fingerprint: qualification.source_patch_fingerprint,
      contract: REPOSITORYREALMS_TASK_COMMAND_CONTRACT,
      receipt_contract: REPOSITORYREALMS_TASK_COMMAND_RECEIPT_CONTRACT,
      version: 1,
      command_key: REPOSITORYREALMS_TASK_COMMAND_KEY,
      endpoint_path: REPOSITORYREALMS_TASK_COMMAND_PATH,
      receipt_path: `${REPOSITORYREALMS_TASK_COMMAND_PATH}/receipts`,
    },
    gates: {
      g5_decision_id: g6Policy.g5_release.decision_id,
      g5_evidence_key: g6Policy.g5_release.evidence_key,
      g6_policy_id: g6Policy.policy_id,
      g6_policy_fingerprint: g6PolicyFingerprint(g6Policy),
      registration_decision_id: 'J6-registration-decision-001',
      registration_evidence_fingerprint: actionFingerprint('registration-evidence'),
    },
    target: {
      entity_id: TARGET_ENTITY,
      project_id: TARGET_PROJECT,
      tenant_key: TARGET_ENTITY,
      endpoint_url: ENDPOINT,
    },
    adapter: {
      adapter_id: REPOSITORYREALMS_TASK_COMMAND_ADAPTER_ID,
      adapter_version: REPOSITORYREALMS_TASK_COMMAND_ADAPTER_VERSION,
      artifact_digest: actionFingerprint('adapter-artifact'),
      configuration_digest: '',
    },
    credential_references: Object.fromEntries(
      Object.entries(CREDENTIALS).map(([key, value]) => [key, credentialFingerprint(value)]),
    ),
    subjects: SUBJECTS,
    safety: {
      explicit_invocation_only: true,
      automatic_retry: false,
      automatic_rollback: false,
      generic_tool_access: false,
      production_registry_default_empty: true,
      r4_human_approval_required: true,
    },
    verdict: 'accepted',
  };
  release.adapter.configuration_digest = repositoryRealmsReleaseConfigurationDigest({
    environment: release.environment,
    source: release.source,
    gates: release.gates,
    target: release.target,
    adapter: {
      adapter_id: release.adapter.adapter_id,
      adapter_version: release.adapter.adapter_version,
      artifact_digest: release.adapter.artifact_digest,
    },
    credential_references: release.credential_references,
    subjects: release.subjects,
    safety: release.safety,
  });
  return { qualification, g6Policy, release };
}

test('explicit release binding can compose exactly one adapter while default production composition stays empty', () => {
  const fixture = acceptedRelease();
  const validation = validateRepositoryRealmsActionRelease(fixture.release, fixture);
  assert.match(validation.fingerprint, /^sha256:[0-9a-f]{64}$/);
  const built = buildReleasedRepositoryRealmsActionRegistry({
    ...fixture,
    credentials: CREDENTIALS,
  });
  assert.equal(buildActionAdapterRegistry().size(), 0);
  assert.equal(built.registry.size(), 1);
  assert.equal(built.registry.resolve({
    environment: fixture.g6Policy.environment,
    commandKey: fixture.g6Policy.command.key,
    commandVersion: fixture.g6Policy.command.version,
    adapterId: fixture.g6Policy.command.adapter_id,
  }).descriptor.adapter_version, REPOSITORYREALMS_TASK_COMMAND_ADAPTER_VERSION);
  const preflight = evaluateRepositoryRealmsAdapterPreflight(fixture);
  assert.equal(preflight.status, 'blocked');
  assert.equal(preflight.default_registry_size, 0);
  assert.deepEqual(preflight.blockers, [
    'live_g5_database_state_not_verified_by_static_preflight',
    'runtime_credentials_not_verified_by_static_preflight',
    'source_feature_flag_not_verified_by_static_preflight',
    'explicit_operator_registration_not_executed',
  ]);
});

test('release binding rejects working-tree source, G6 drift, configuration drift, and credential mismatch', () => {
  const fixture = acceptedRelease();
  const workingTree = structuredClone(qualificationInput) as any;
  workingTree.source_ref = 'codex/leozops-phase14-command-contract';
  workingTree.source_state = 'working_tree';
  workingTree.capabilities.immutable_revision = false;
  workingTree.capabilities.canonical_main_release = false;
  workingTree.verdict = 'blocked';
  assert.throws(() => validateRepositoryRealmsActionRelease(fixture.release, {
    qualification: workingTree,
    g6Policy: fixture.g6Policy,
  }));
  assert.throws(() => validateRepositoryRealmsActionRelease({
    ...fixture.release,
    adapter: { ...fixture.release.adapter, artifact_digest: actionFingerprint('changed-artifact') },
  }, fixture));
  const changedG6 = structuredClone(fixture.g6Policy);
  changedG6.limits.max_executions_per_day = 6;
  assert.throws(() => validateRepositoryRealmsActionRelease(fixture.release, {
    qualification: fixture.qualification,
    g6Policy: changedG6,
  }));
  assert.throws(() => buildReleasedRepositoryRealmsActionRegistry({
    ...fixture,
    credentials: { ...CREDENTIALS, receipts_read: 'different-receipt-credential-0099' },
  }));
});
