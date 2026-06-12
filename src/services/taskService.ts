import { Task, TaskStatus, TaskStatusEvent } from '../domain/types';
import { ValidationError } from '../errors';
import { isOneOf } from '../domain/validate';
import { TASK_STATUSES } from '../domain/validate';
import { canTransition } from '../domain/task';
import { TaskRepository, taskRepository, StatusChangeMeta } from '../repositories/taskRepository';

/**
 * Task lifecycle service (Milestone #9).
 *
 * Sits between the task routes and the repository. It owns the business rule the
 * data layer deliberately does not: whether a status transition is legal. Field
 * validation and persistence (including the atomic status + audit write) live in
 * `TaskRepository`; this service validates the requested transition and
 * delegates. Dependency-injected with a singleton default, like the other
 * services.
 */

export interface TaskCreateInput {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string;
  assignee?: string | null;
  source_recommendation_code?: string | null;
  due_at?: string | null;
}

export type TaskUpdateInput = Omit<TaskCreateInput, 'status'>;

export class TaskService {
  constructor(private readonly tasks: TaskRepository = taskRepository) {}

  listByClient(clientId: string): Promise<Task[]> {
    return this.tasks.listByClient(clientId);
  }

  getById(id: string): Promise<Task | undefined> {
    return this.tasks.findById(id);
  }

  /** Create a task scoped to `clientId`, recording the initial audit event. */
  create(clientId: string, input: TaskCreateInput, actor?: string | null): Promise<Task> {
    return this.tasks.create({ ...input, client_id: clientId } as any, actor);
  }

  /** Update non-status fields. */
  updateFields(id: string, input: TaskUpdateInput): Promise<Task | undefined> {
    return this.tasks.update(id, input as any);
  }

  /**
   * Apply a status transition to a known task. Rejects an unknown status (400)
   * or an illegal transition (409) before any write; otherwise persists the
   * change and its audit event.
   */
  async transition(task: Task, toStatus: string, meta: StatusChangeMeta = {}): Promise<Task | undefined> {
    if (!isOneOf(TASK_STATUSES, toStatus)) {
      throw new ValidationError(400, `status must be one of: ${TASK_STATUSES.join(', ')}`, 'invalid_status');
    }
    if (!canTransition(task.status, toStatus as TaskStatus)) {
      throw new ValidationError(
        409,
        `illegal transition: ${task.status} → ${toStatus}`,
        'invalid_transition',
      );
    }
    return this.tasks.changeStatus(task.id, task.client_id, task.status, toStatus as TaskStatus, meta);
  }

  /** The status-change audit trail for one task. */
  statusEvents(taskId: string): Promise<TaskStatusEvent[]> {
    return this.tasks.listStatusEvents(taskId);
  }

  remove(id: string): Promise<boolean> {
    return this.tasks.remove(id);
  }
}

export const taskService = new TaskService();
