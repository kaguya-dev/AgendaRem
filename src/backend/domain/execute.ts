import { randomUUID } from 'node:crypto';
import { dueLabel, formatDate, normalize } from './format';
import { contextFor, findGroup, findTask, selectTasks } from './lookup';
import {
  Ambiguity,
  DomainError,
  commandsSchema,
  type Command,
  type State,
  type Task,
} from './types';

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
  'Você pode criar grupos e tarefas, editar, concluir, restaurar e consultar. Exemplos:\n• Crie um grupo chamado Estudos\n• Adicione ler capítulo 3 em Estudos\n• Anota: comprar pilhas\n• Finalizei #1\n• Restaure #1\n• O que vence hoje?\n• Quais tarefas estão na lixeira?\n• Exclua as tarefas da lixeira depois de 15 dias\n• Desfaça a última alteração\nPara descrições e campos, use também o painel. Com uma IA cadastrada em Modelos de IA, você escreve do seu jeito, sem seguir esses formatos.';

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
