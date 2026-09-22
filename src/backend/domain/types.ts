import { z } from 'zod';

export const TIMEZONE = 'America/Bahia';
export type Status = 'pending' | 'in_progress' | 'completed';
export type Priority = 'low' | 'normal' | 'high';
export interface Group {
  id: string;
  name: string;
  createdAt: string;
}
export interface Task {
  id: number;
  title: string;
  description: string;
  groupId: string | null;
  status: Status;
  priority: Priority;
  dueDate: string | null;
  dueTime: string | null;
  completedAt: string | null;
  trashedAt: string | null;
  purgeAt: string | null;
  trashReason: 'completed' | 'discarded' | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface History {
  id: string;
  taskId: number;
  action: string;
  source: string;
  at: string;
}
export interface Change {
  taskId: number;
  before: Task | null;
  afterVersion: number;
}
export interface Operation {
  id: string;
  sequence: number;
  channel: string;
  at: string;
  changes: Change[];
  undoable: boolean;
  undone: boolean;
}
export interface Conversation {
  id: string;
  groupId: string | null;
  taskIds: number[];
  expiresAt: string;
  pending?: {
    commands: Command[];
    index: number;
    field: 'task' | 'group';
    options: { ref: string; label: string }[];
    createGroup?: string;
  };
  lastQuery?: Command;
}
export interface State {
  tasks: Task[];
  groups: Group[];
  history: History[];
  operations: Operation[];
  conversations: Conversation[];
  settings: {
    retentionDays: number;
    nextTaskId: number;
    revision: number;
  };
}
export function emptyState(): State {
  return {
    tasks: [],
    groups: [],
    history: [],
    operations: [],
    conversations: [],
    settings: {
      retentionDays: 30,
      nextTaskId: 1,
      revision: 0,
    },
  };
}
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Data inválida');
export const commandSchema = z
  .object({
    op: z.enum([
      'create_group',
      'rename_group',
      'list_groups',
      'create_task',
      'update_task',
      'complete_task',
      'trash_task',
      'restore_task',
      'list_tasks',
      'details',
      'settings',
      'set_retention',
      'undo',
      'help',
      'clarify',
    ]),
    task: z.string().min(1).max(200).optional(),
    group: z.string().min(1).max(100).nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(5000).optional(),
    appendDescription: z.string().max(5000).optional(),
    status: z.enum(['pending', 'in_progress']).optional(),
    priority: z.enum(['low', 'normal', 'high']).optional(),
    dueDate: date.nullable().optional(),
    dueTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .optional(),
    filter: z
      .enum(['active', 'today', 'overdue', 'no_date', 'trash', 'completed', 'all'])
      .optional(),
    search: z.string().max(200).optional(),
    page: z.number().int().min(1).max(10000).optional(),
    days: z.number().int().min(1).max(3650).optional(),
    expectedVersion: z.number().int().positive().optional(),
    question: z.string().min(1).max(600).optional(),
  })
  .strict();
export type Command = z.infer<typeof commandSchema>;
export const commandsSchema = z.array(commandSchema).min(1).max(10);
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
// Thrown by the lookup helpers when a command's task/group reference doesn't resolve to
// exactly one match. Caught by execute() to turn it into a clarification reply instead of
// a hard failure, without applying any of the command's siblings.
export class Ambiguity extends DomainError {
  constructor(
    message: string,
    public field: 'task' | 'group',
    public options: { ref: string; label: string }[],
    public createGroup?: string,
  ) {
    super(message);
  }
}
