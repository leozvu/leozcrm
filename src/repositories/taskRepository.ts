import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './baseRepository';
import { Task, TaskStatus, TaskStatusEvent, TABLES } from '../domain/types';
import { ValidationError } from '../errors';
import {
  isOneOf,
  isUuid,
  TASK_PRIORITIES,
} from '../domain/validate';
import { TASK_INITIAL_STATUSES } from '../domain/task';
import type { Knex } from '../db/knex';

type TaskWrite = Omit<Partial<Task>, 'id' | 'created_at' | 'updated_at'>;

const TITLE_MAX = 200;
const ASSIGNEE_MAX = 200;
const CODE_MAX = 100;
const NOTE_MAX = 1000;

/** Metadata recorded on an audited status change. */
export interface StatusChangeMeta {
  /** Who made the change ('admin' or the tenant/client id). */
  actor?: string | null;
  note?: string | null;
}

/**
 * Data-access for tasks and their status-change audit trail (Milestone #9).
 *
 * Follows the repository conventions: extends `BaseRepository`, constructor-
 * injectable `Knex` with a singleton default, app-owned UUIDs/timestamps, clean
 * field validation (bad input → 400, never a 500), and FK front-door checks.
 * Workflow rules (which status transitions are legal) are NOT here — they live
 * in `TaskService`. This repository only records facts, and keeps a task's
 * status change atomic with its audit event via a transaction.
 */
export class TaskRepository extends BaseRepository<Task> {
  constructor(knex?: Knex) {
    super(TABLES.tasks, knex);
  }

  async listByClient(clientId: string): Promise<Task[]> {
    return this.query().where({ client_id: clientId }).orderBy('created_at', 'desc');
  }

  /** Reject malformed field values cleanly (400) before they reach the DB. */
  private validateFields(data: TaskWrite): void {
    if (data.title !== undefined) {
      if (typeof data.title !== 'string' || data.title.trim() === '' || data.title.length > TITLE_MAX) {
        throw new ValidationError(400, `title must be a non-empty string up to ${TITLE_MAX} chars`, 'invalid_title');
      }
    }
    if (data.priority !== undefined && !isOneOf(TASK_PRIORITIES, data.priority)) {
      throw new ValidationError(400, `priority must be one of: ${TASK_PRIORITIES.join(', ')}`, 'invalid_priority');
    }
    if (data.assignee !== undefined && data.assignee !== null) {
      if (typeof data.assignee !== 'string' || data.assignee.length > ASSIGNEE_MAX) {
        throw new ValidationError(400, `assignee must be a string up to ${ASSIGNEE_MAX} chars`, 'invalid_assignee');
      }
    }
    if (data.source_recommendation_code !== undefined && data.source_recommendation_code !== null) {
      if (typeof data.source_recommendation_code !== 'string' || data.source_recommendation_code.length > CODE_MAX) {
        throw new ValidationError(400, `source_recommendation_code must be a string up to ${CODE_MAX} chars`, 'invalid_source_code');
      }
    }
    if (data.description !== undefined && data.description !== null && typeof data.description !== 'string') {
      throw new ValidationError(400, 'description must be a string', 'invalid_description');
    }
    if (data.due_at !== undefined && data.due_at !== null) {
      if (typeof data.due_at !== 'string' || Number.isNaN(Date.parse(data.due_at))) {
        throw new ValidationError(400, 'due_at must be a valid ISO-8601 date-time', 'invalid_due_at');
      }
    }
  }

  /**
   * Create a task and record its initial status as the first audit event,
   * atomically. The owning client must exist (front-door 400, not a DB 500).
   */
  async create(data: TaskWrite, actor?: string | null): Promise<Task> {
    this.validateFields(data);

    // Validate the client id SHAPE before it touches a DB query — a missing or
    // malformed (non-string / non-UUID) client_id is a clean 400, not a DB error.
    if (!isUuid(data.client_id)) {
      throw new ValidationError(400, 'client_id must be a valid id', 'invalid_client');
    }
    const client = await this.getRow(TABLES.clients, data.client_id);
    if (!client) {
      throw new ValidationError(400, `client_id "${data.client_id}" does not exist`, 'unknown_client');
    }

    // Tasks are never created already-terminal.
    const status: TaskStatus = (data.status as TaskStatus) ?? 'open';
    if (!isOneOf(TASK_INITIAL_STATUSES, status)) {
      throw new ValidationError(400, `a task may only be created with status: ${TASK_INITIAL_STATUSES.join(', ')}`, 'invalid_status');
    }

    const id = uuidv4();
    const now = this.now();
    const row = {
      ...this.clean({
        title: data.title,
        description: data.description ?? null,
        priority: data.priority ?? 'medium',
        assignee: data.assignee ?? null,
        source_recommendation_code: data.source_recommendation_code ?? null,
        due_at: data.due_at ?? null,
      }),
      id,
      client_id: data.client_id,
      status,
      created_at: now,
      updated_at: now,
    };

    await this.knex.transaction(async (trx) => {
      await trx(TABLES.tasks).insert(row);
      await trx(TABLES.taskStatusEvents).insert({
        id: uuidv4(),
        task_id: id,
        client_id: data.client_id,
        seq: 1, // first event in the trail
        from_status: null,
        to_status: status,
        changed_by: actor ?? null,
        note: null,
        created_at: now,
      });
    });

    const created = await this.findById(id);
    if (!created) throw new Error('Failed to create task');
    return created;
  }

  /**
   * Update non-status fields. Status changes must go through `changeStatus`
   * (so they are transition-validated and audited), and a task can never be
   * re-parented to another client.
   */
  async update(id: string, data: TaskWrite): Promise<Task | undefined> {
    if (data.client_id !== undefined) {
      throw new ValidationError(409, 'task client ownership cannot be reassigned', 'ownership_reassignment');
    }
    if (data.status !== undefined) {
      throw new ValidationError(400, 'use the status-transition endpoint to change status', 'status_change_not_allowed');
    }
    this.validateFields(data);
    return super.update(id, data);
  }

  /**
   * Persist a status change and append its audit event atomically. The caller
   * (TaskService) has already validated that `from → to` is a legal transition.
   */
  async changeStatus(
    id: string,
    clientId: string,
    fromStatus: TaskStatus,
    toStatus: TaskStatus,
    meta: StatusChangeMeta = {},
  ): Promise<Task | undefined> {
    // Validate the caller-supplied audit note before the DB write.
    if (meta.note !== undefined && meta.note !== null) {
      if (typeof meta.note !== 'string' || meta.note.length > NOTE_MAX) {
        throw new ValidationError(400, `note must be a string up to ${NOTE_MAX} chars`, 'invalid_note');
      }
    }
    const now = this.now();
    await this.knex.transaction(async (trx) => {
      await trx(TABLES.tasks).where({ id }).update({ status: toStatus, updated_at: now });
      // Append at the next monotonic position for this task. Computed inside the
      // transaction; the unique (task_id, seq) index is the backstop against a
      // racing writer (a single task is not transitioned concurrently in practice).
      const [{ maxSeq } = { maxSeq: null }] = await trx(TABLES.taskStatusEvents)
        .where({ task_id: id })
        .max({ maxSeq: 'seq' });
      const nextSeq = Number(maxSeq ?? 0) + 1;
      await trx(TABLES.taskStatusEvents).insert({
        id: uuidv4(),
        task_id: id,
        client_id: clientId,
        seq: nextSeq,
        from_status: fromStatus,
        to_status: toStatus,
        changed_by: meta.actor ?? null,
        note: meta.note ?? null,
        created_at: now,
      });
    });
    return this.findById(id);
  }

  /**
   * The status-change audit trail for one task, oldest first. Order is the
   * per-task monotonic `seq`, not `created_at`: rapid events can share a
   * millisecond, so a timestamp cannot order them and could even place a
   * transition before the create event. `seq` is the authoritative, explicit
   * order-of-record — independent of DB tie-breaking.
   */
  async listStatusEvents(taskId: string): Promise<TaskStatusEvent[]> {
    return this.knex(TABLES.taskStatusEvents)
      .where({ task_id: taskId })
      .orderBy('seq', 'asc');
  }
}

export const taskRepository = new TaskRepository();
