/**
 * Task lifecycle contract (Milestone #9).
 *
 * Pure, I/O-free definitions of the task state machine: which status transitions
 * are legal. The repository persists facts; the *legality* of a move is a
 * business rule and lives here (consumed by `TaskService`), per the architecture
 * convention that workflow rules stay out of the data layer.
 *
 * The machine is intentionally small and explicit:
 *
 *     open ⇄ in_progress
 *     open → cancelled
 *     in_progress → done | cancelled
 *
 * `done` and `cancelled` are terminal (no outgoing transitions).
 */

import { TaskStatus } from './types';

/** Legal next states for each status. */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  open: ['in_progress', 'cancelled'],
  in_progress: ['open', 'done', 'cancelled'],
  done: [],
  cancelled: [],
};

/** Statuses a task may be created in (never created already-terminal). */
export const TASK_INITIAL_STATUSES: readonly TaskStatus[] = ['open', 'in_progress'];

/** Terminal statuses — no further transitions are allowed. */
export const TASK_TERMINAL_STATUSES: readonly TaskStatus[] = ['done', 'cancelled'];

/** Whether `to` is a legal next status from `from`. A no-op (same status) is not a transition. */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from]?.includes(to) ?? false;
}
