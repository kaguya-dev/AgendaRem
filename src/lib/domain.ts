import { randomUUID } from 'node:crypto';
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
class Ambiguity extends DomainError {
  constructor(
    message: string,
    public field: 'task' | 'group',
    public options: { ref: string; label: string }[],
    public createGroup?: string,
  ) {
    super(message);
  }
}
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
export function localDate(now: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
export function dueLabel(t: Task) {
  return t.dueDate
    ? `${t.dueDate.split('-').reverse().join('/')}${t.dueTime ? ` às ${t.dueTime}` : ''}`
    : 'sem prazo';
}
export function isOverdue(t: Task, now = new Date()) {
  if (!t.dueDate) return false;
  return t.dueTime
    ? new Date(`${t.dueDate}T${t.dueTime}:00-03:00`) < now
    : t.dueDate < localDate(now);
}
export function contextFor(state: State, channel: string, now: Date): Conversation {
  const existing = state.conversations.find((c) => c.id === channel);
  if (existing && existing.expiresAt > now.toISOString()) return existing;
  const ctx: Conversation = {
    id: channel,
    groupId: null,
    taskIds: [],
    expiresAt: new Date(now.getTime() + 30 * 60000).toISOString(),
  };
  state.conversations = [...state.conversations.filter((c) => c.id !== channel), ctx];
  return ctx;
}
function findGroup(state: State, ref: string | null | undefined, ctx: Conversation): Group | null {
  if (ref == null || normalize(ref) === 'caixa de entrada') return null;
  if (['nesse grupo', 'neste grupo', 'esse grupo', 'contexto'].includes(normalize(ref))) {
    if (!ctx.groupId) throw new DomainError('Qual grupo você quer usar? Informe o nome.');
    ref = ctx.groupId;
  }
  const exact = state.groups.filter((g) => g.id === ref || normalize(g.name) === normalize(ref!));
  const matches = exact.length
    ? exact
    : state.groups.filter((g) => normalize(g.name).includes(normalize(ref!)));
  if (!matches.length)
    throw new Ambiguity(
      `O grupo “${ref}” não existe. Responda “criar” para criá-lo e continuar, ou envie um novo comando.`,
      'group',
      [],
      ref,
    );
  if (matches.length > 1)
    throw new Ambiguity(
      'Encontrei mais de um grupo. Responda com o número da opção:',
      'group',
      matches.map((g) => ({ ref: g.id, label: g.name })),
    );
  ctx.groupId = matches[0].id;
  return matches[0];
}
function findTask(state: State, command: Command, ctx: Conversation): Task {
  let ref = command.task;
  if (!ref) throw new DomainError('Informe o título ou o código da tarefa.');
  if (['essa tarefa', 'esta tarefa', 'contexto'].includes(normalize(ref))) {
    if (ctx.taskIds.length !== 1)
      throw new DomainError('Qual tarefa? Informe o código, por exemplo #12.');
    ref = `#${ctx.taskIds[0]}`;
  }
  const ordinal = normalize(ref).match(/^(?:a )?(primeira|segunda|terceira|quarta|quinta)$/);
  if (ordinal) {
    const idx = ['primeira', 'segunda', 'terceira', 'quarta', 'quinta'].indexOf(ordinal[1]);
    if (!ctx.taskIds[idx])
      throw new DomainError('Essa posição não está na última lista. Informe o código da tarefa.');
    ref = `#${ctx.taskIds[idx]}`;
  }
  let scope = state.tasks;
  if (command.group !== undefined && command.op !== 'update_task') {
    const g = findGroup(state, command.group, ctx);
    scope = scope.filter((t) => t.groupId === (g?.id ?? null));
  }
  const numeric = ref.match(/^#?(\d+)$/);
  let matches = numeric
    ? scope.filter((t) => t.id === Number(numeric[1]))
    : scope.filter((t) => normalize(t.title) === normalize(ref!));
  if (!matches.length && !numeric)
    matches = scope.filter((t) => normalize(t.title).includes(normalize(ref!)));
  if (!matches.length)
    throw new DomainError('Não encontrei essa tarefa. Ela pode ter sido excluída definitivamente.');
  if (matches.length > 1)
    throw new Ambiguity(
      'Encontrei tarefas com nomes parecidos. Responda com o número da opção:',
      'task',
      matches.slice(0, 20).map((t) => ({
        ref: `#${t.id}`,
        label: `#${t.id} ${t.title} — ${state.groups.find((g) => g.id === t.groupId)?.name ?? 'Caixa de entrada'}${t.trashedAt ? ' (lixeira)' : ''}`,
      })),
    );
  if (command.expectedVersion && command.expectedVersion !== matches[0].version)
    throw new DomainError('A tarefa foi alterada em outra tela. Atualize antes de salvar.', 409);
  ctx.taskIds = [matches[0].id];
  return matches[0];
}
export function selectTasks(
  state: State,
  command: Command,
  now: Date,
  groupId?: string | null,
): Task[] {
  return state.tasks
    .filter((t) => {
      const filter = command.filter ?? 'active';
      if (filter === 'trash') {
        if (!t.trashedAt) return false;
      } else if (filter === 'completed') {
        if (!t.trashedAt || t.status !== 'completed') return false;
      } else if (filter !== 'all' && t.trashedAt) return false;
      if (filter === 'today' && t.dueDate !== localDate(now)) return false;
      if (filter === 'overdue' && !isOverdue(t, now)) return false;
      if (filter === 'no_date' && t.dueDate) return false;
      if (groupId !== undefined && t.groupId !== groupId) return false;
      if (
        command.search &&
        !normalize(`${t.title} ${t.description}`).includes(normalize(command.search))
      )
        return false;
      return true;
    })
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.id - a.id);
}
function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new DomainError(`Informe ${label}.`);
  return value;
}
function trash(t: Task, state: State, now: Date, completed: boolean) {
  if (!t.trashedAt) {
    t.trashedAt = now.toISOString();
    t.purgeAt = new Date(now.getTime() + state.settings.retentionDays * 86400000).toISOString();
  }
  t.trashReason = completed ? 'completed' : 'discarded';
  if (completed) {
    t.status = 'completed';
    t.completedAt ??= now.toISOString();
  }
}
export const HELP =
  'Você pode criar grupos e tarefas, editar, concluir, restaurar e consultar. Exemplos:\n• Crie um grupo chamado Estudos\n• Adicione ler capítulo 3 em Estudos\n• Anota: comprar pilhas\n• Finalizei #1\n• Restaure #1\n• O que vence hoje?\n• Quais tarefas estão na lixeira?\n• Exclua as tarefas da lixeira depois de 15 dias\n• Desfaça a última alteração\nPara descrições e campos, use também o painel. Com uma LLM configurada, mais variações de texto são compreendidas.';

export function execute(
  original: State,
  input: unknown,
  channel = 'panel',
  now = new Date(),
): { state: State; reply: string; clarification: boolean } {
  const commands = commandsSchema.parse(input);
  if (commands.some((c) => c.op === 'undo' || c.op === 'clarify') && commands.length > 1)
    throw new DomainError('Envie esse pedido separadamente para evitar alterações parciais.');
  const state = structuredClone(original);
  const ctx = contextFor(state, channel, now);
  delete ctx.pending;
  ctx.expiresAt = new Date(now.getTime() + 30 * 60000).toISOString();
  const replies: string[] = [];
  const touched = new Map<number, Task | null>();
  let barrier = false;
  let mutation = false;
  let commandIndex = 0;
  const touch = (t: Task, action: string) => {
    if (!touched.has(t.id))
      touched.set(t.id, structuredClone(original.tasks.find((old) => old.id === t.id) ?? null));
    t.version++;
    t.updatedAt = now.toISOString();
    state.history.push({
      id: randomUUID(),
      taskId: t.id,
      action,
      source: channel,
      at: now.toISOString(),
    });
    mutation = true;
  };
  try {
    for (const c of commands) {
      switch (c.op) {
        case 'help':
          replies.push(HELP);
          break;
        case 'clarify':
          replies.push(c.question ?? 'Pode explicar qual tarefa e alteração você quer fazer?');
          break;
        case 'settings':
          replies.push(
            `A lixeira exclui tarefas após ${state.settings.retentionDays} dias. Alterações no prazo valem para novas entradas.`,
          );
          break;
        case 'set_retention':
          state.settings.retentionDays = requireValue(c.days, 'a quantidade de dias');
          mutation = barrier = true;
          replies.push(
            `Lixeira configurada para ${c.days} dias. Vale para novas entradas; as tarefas já na lixeira mantêm suas datas.`,
          );
          break;
        case 'create_group': {
          const name = requireValue(c.name, 'o nome do grupo');
          if (state.groups.some((g) => normalize(g.name) === normalize(name)))
            throw new DomainError('Já existe um grupo com esse nome.');
          const group = { id: randomUUID(), name, createdAt: now.toISOString() };
          state.groups.push(group);
          ctx.groupId = group.id;
          mutation = barrier = true;
          replies.push(`Grupo ${name} criado.`);
          break;
        }
        case 'rename_group': {
          const group = findGroup(state, requireValue(c.group ?? undefined, 'o grupo'), ctx)!;
          if (!group) throw new DomainError('A Caixa de entrada não pode ser renomeada.');
          const name = requireValue(c.name, 'o novo nome');
          if (state.groups.some((g) => g.id !== group.id && normalize(g.name) === normalize(name)))
            throw new DomainError('Já existe um grupo com esse nome.');
          group.name = name;
          mutation = barrier = true;
          replies.push(`Grupo renomeado para ${name}.`);
          break;
        }
        case 'list_groups':
          replies.push(
            state.groups.length
              ? `${state.groups.length} grupo(s):\n${state.groups.map((g) => `• ${g.name}`).join('\n')}`
              : 'Você ainda não tem grupos.',
          );
          break;
        case 'create_task': {
          const group = findGroup(state, c.group, ctx);
          const t: Task = {
            id: state.settings.nextTaskId++,
            title: requireValue(c.title, 'o título'),
            description: c.description ?? '',
            groupId: group?.id ?? null,
            status: c.status ?? 'pending',
            priority: c.priority ?? 'normal',
            dueDate: c.dueDate ?? null,
            dueTime: c.dueTime ?? null,
            completedAt: null,
            trashedAt: null,
            purgeAt: null,
            trashReason: null,
            version: 0,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          };
          if (t.dueTime && !t.dueDate) throw new DomainError('Informe a data junto com o horário.');
          state.tasks.push(t);
          touch(t, 'Tarefa criada');
          ctx.taskIds = [t.id];
          replies.push(
            `#${t.id} ${t.title} adicionada em ${group?.name ?? 'Caixa de entrada'} — ${dueLabel(t)}.`,
          );
          break;
        }
        case 'update_task': {
          const t = findTask(state, c, ctx);
          if (t.trashedAt) throw new DomainError('Restaure a tarefa da lixeira antes de editar.');
          if (c.description !== undefined && c.appendDescription !== undefined)
            throw new DomainError('Escolha substituir ou acrescentar a descrição.');
          for (const key of [
            'title',
            'description',
            'status',
            'priority',
            'dueDate',
            'dueTime',
          ] as const) {
            if (c[key] !== undefined) Object.assign(t, { [key]: c[key] });
          }
          if (c.appendDescription !== undefined)
            t.description = [t.description, c.appendDescription].filter(Boolean).join('\n');
          if (t.description.length > 5000)
            throw new DomainError('A descrição pode ter até 5.000 caracteres.');
          if (c.dueDate === null) t.dueTime = null;
          if (t.dueTime && !t.dueDate) throw new DomainError('Informe a data junto com o horário.');
          if (c.group !== undefined) t.groupId = findGroup(state, c.group, ctx)?.id ?? null;
          touch(t, 'Tarefa atualizada');
          replies.push(`#${t.id} ${t.title} atualizada — ${dueLabel(t)}.`);
          break;
        }
        case 'complete_task':
        case 'trash_task':
        case 'restore_task': {
          const t = findTask(state, c, ctx);
          if (c.op === 'restore_task') {
            if (!t.trashedAt) {
              replies.push(`#${t.id} já está fora da lixeira.`);
              break;
            }
            t.status = 'pending';
            t.trashedAt = t.purgeAt = t.completedAt = t.trashReason = null;
            touch(t, 'Tarefa restaurada');
            replies.push(`#${t.id} ${t.title} restaurada como pendente.`);
          } else {
            if (t.trashedAt && (c.op === 'trash_task' || t.status === 'completed')) {
              replies.push(
                `#${t.id} já está na lixeira. Exclusão prevista: ${formatDate(t.purgeAt!)}.`,
              );
              break;
            }
            trash(t, state, now, c.op === 'complete_task');
            touch(
              t,
              c.op === 'complete_task'
                ? 'Tarefa concluída e enviada à lixeira'
                : 'Tarefa descartada',
            );
            replies.push(
              `#${t.id} ${t.title} ${c.op === 'complete_task' ? 'concluída e enviada' : 'enviada'} à lixeira. Exclusão prevista: ${formatDate(t.purgeAt!)}. Você pode restaurá-la antes da exclusão.`,
            );
          }
          break;
        }
        case 'details': {
          const t = findTask(state, c, ctx);
          replies.push(
            `#${t.id} ${t.title}\n${t.description || 'Sem descrição.'}\nGrupo: ${state.groups.find((g) => g.id === t.groupId)?.name ?? 'Caixa de entrada'}\nPrazo: ${dueLabel(t)}\nSituação: ${{ pending: 'pendente', in_progress: 'em andamento', completed: 'concluída' }[t.status]}${t.purgeAt ? `\nExclusão prevista: ${formatDate(t.purgeAt)}` : ''}`,
          );
          break;
        }
        case 'list_tasks': {
          const groupId =
            c.group !== undefined ? (findGroup(state, c.group, ctx)?.id ?? null) : undefined;
          const all = selectTasks(state, c, now, groupId);
          const page = c.page ?? 1;
          const items = all.slice((page - 1) * 10, page * 10);
          ctx.taskIds = items.map((t) => t.id);
          ctx.lastQuery = { ...c, page };
          const filterName = {
            active: 'ativas',
            today: 'hoje',
            overdue: 'atrasadas',
            no_date: 'sem prazo',
            trash: 'lixeira',
            completed: 'concluídas na lixeira',
            all: 'todas, incluindo lixeira',
          }[c.filter ?? 'active'];
          replies.push(
            `${all.length} tarefa(s) — ${filterName}${c.search ? `; busca: ${c.search}` : ''}. Página ${page}/${Math.max(1, Math.ceil(all.length / 10))}.\n${items.map((t) => `#${t.id} ${t.title} — ${dueLabel(t)}${t.purgeAt ? `; exclusão: ${formatDate(t.purgeAt)}` : ''}`).join('\n')}${all.length > page * 10 ? '\nEnvie “mostrar mais” para continuar.' : ''}`,
          );
          break;
        }
        case 'undo': {
          const op = [...state.operations].reverse().find((o) => o.channel === channel);
          if (!op || op.undone || !op.undoable)
            throw new DomainError(
              'A última operação não pode ser desfeita. Alterações de grupos e configurações não têm desfazer no MVP.',
            );
          if (now.getTime() - new Date(op.at).getTime() > 86400000)
            throw new DomainError(
              'O prazo de 24 horas para desfazer terminou. Tarefas na lixeira ainda podem ser restauradas.',
            );
          for (const change of op.changes) {
            const t = state.tasks.find((t) => t.id === change.taskId);
            if (!t)
              throw new DomainError(
                'Uma tarefa dessa operação foi excluída definitivamente. Não é possível desfazer.',
              );
            if (t.version !== change.afterVersion)
              throw new DomainError(
                'Uma tarefa foi alterada depois dessa operação. Atualize e faça uma correção específica.',
                409,
              );
          }
          for (const change of op.changes) {
            const t = state.tasks.find((t) => t.id === change.taskId)!;
            if (change.before) {
              const version = t.version;
              Object.assign(t, change.before, { version });
            } else trash(t, state, now, false);
            touch(t, 'Alteração desfeita');
          }
          op.undone = true;
          barrier = true;
          replies.push('Última alteração desfeita.');
          break;
        }
      }
      commandIndex++;
    }
  } catch (error) {
    if (!(error instanceof Ambiguity)) throw error;
    // All-or-nothing: retain only the question, never preceding mutations.
    const clean = structuredClone(original);
    const pendingCtx = contextFor(clean, channel, now);
    pendingCtx.pending = {
      commands,
      index: commandIndex,
      field: error.field,
      options: error.options,
      createGroup: error.createGroup,
    };
    pendingCtx.expiresAt = new Date(now.getTime() + 30 * 60000).toISOString();
    return {
      state: clean,
      reply: `${error.message}${error.options.length ? '\n' + error.options.map((o, i) => `${i + 1}. ${o.label}`).join('\n') : ''}`,
      clarification: true,
    };
  }
  if (mutation) {
    state.settings.revision++;
    state.operations.push({
      id: randomUUID(),
      sequence: state.settings.revision,
      channel,
      at: now.toISOString(),
      changes: [...touched].map(([taskId, before]) => ({
        taskId,
        before,
        afterVersion: state.tasks.find((t) => t.id === taskId)!.version,
      })),
      undoable: !barrier && touched.size > 0,
      undone: false,
    });
  }
  return {
    state,
    reply: replies.join('\n\n'),
    clarification: commands.some((c) => c.op === 'clarify'),
  };
}

export function pendingAnswer(
  state: State,
  text: string,
  channel: string,
  now: Date,
): Command[] | null {
  const ctx = contextFor(structuredClone(state), channel, now);
  if (normalize(text) === 'mostrar mais' && ctx.lastQuery)
    return [{ ...ctx.lastQuery, page: (ctx.lastQuery.page ?? 1) + 1 }];
  if (!ctx.pending) return null;
  const p = ctx.pending;
  const commands = structuredClone(p.commands);
  if (p.createGroup && ['criar', 'sim', 'sim criar'].includes(normalize(text))) {
    if (commands.length >= 10)
      return [
        {
          op: 'clarify',
          question: 'Crie o grupo separadamente e reenvie a lista (limite de 10 ações).',
        },
      ];
    return [{ op: 'create_group', name: p.createGroup }, ...commands];
  }
  if (/^\d+$/.test(text.trim())) {
    const choice = p.options[Number(text.trim()) - 1];
    if (!choice)
      return [
        {
          op: 'clarify',
          question: 'Essa opção não existe. Informe o nome ou código em um novo comando.',
        },
      ];
    commands[p.index][p.field] = choice.ref;
    return commands;
  }
  return null;
}

export function purge(original: State, now = new Date()): { state: State; removed: number[] } {
  const state = structuredClone(original);
  const removed = state.tasks
    .filter((t) => t.trashedAt && t.purgeAt && t.purgeAt <= now.toISOString())
    .map((t) => t.id);
  state.tasks = state.tasks.filter((t) => !removed.includes(t.id));
  state.history = state.history.filter((h) => !removed.includes(h.taskId));
  for (const op of state.operations)
    if (op.changes.some((c) => removed.includes(c.taskId))) {
      op.changes = [];
      op.undoable = false;
    }
  for (const ctx of state.conversations) {
    ctx.taskIds = ctx.taskIds.filter((id) => !removed.includes(id));
    // Pending commands and queries can contain deleted task text. Expire them on purge.
    if (removed.length) {
      delete ctx.pending;
      delete ctx.lastQuery;
    }
  }
  if (removed.length) state.settings.revision++;
  // Undo lasts 24h. Keep only a content-free barrier for each old channel.
  const cutoff = new Date(now.getTime() - 86400000).toISOString();
  state.operations = state.operations.filter(
    (o, i, all) => o.at >= cutoff || !all.slice(i + 1).some((later) => later.channel === o.channel),
  );
  for (const op of state.operations)
    if (op.at < cutoff) {
      op.changes = [];
      op.undoable = false;
    }
  return { state, removed };
}
