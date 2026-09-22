'use client';

import { useState, type FormEvent } from 'react';
import { Check, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react';
import type { Group, History, Task } from '@/backend/domain';
import { Dialog } from './Dialog';
import { timestamp } from './format';
import type { Action } from './types';

export function TaskDialog({
  task,
  groups,
  defaultGroup,
  history,
  busy,
  close,
  action,
}: {
  task?: Task;
  groups: Group[];
  defaultGroup?: string;
  history: History[];
  busy: boolean;
  close: () => void;
  action: Action;
}) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [group, setGroup] = useState(task?.groupId ?? defaultGroup ?? '');
  const [priority, setPriority] = useState(task?.priority ?? 'normal');
  const [status, setStatus] = useState<'pending' | 'in_progress'>(
    task?.status === 'in_progress' ? 'in_progress' : 'pending',
  );
  const [date, setDate] = useState(task?.dueDate ?? '');
  const [time, setTime] = useState(task?.dueTime ?? '');
  async function submit(e: FormEvent) {
    e.preventDefault();
    await action([
      {
        op: task ? 'update_task' : 'create_task',
        ...(task ? { task: `#${task.id}`, expectedVersion: task.version } : {}),
        title,
        description,
        group: group || null,
        priority,
        status,
        dueDate: date || null,
        dueTime: date && time ? time : null,
      },
    ]);
  }
  return (
    <Dialog
      title={task ? `Tarefa #${task.id}` : 'Um novo próximo passo'}
      subtitle={
        task
          ? 'Detalhes, contexto e tudo o que você precisa.'
          : 'Comece pelo título. Os detalhes podem vir depois.'
      }
      close={close}
    >
      <form onSubmit={submit} className="editor-form">
        <fieldset disabled={busy || Boolean(task?.trashedAt)}>
          <label htmlFor="task-title">O que você precisa fazer?</label>
          <input
            id="task-title"
            placeholder="Ex.: Ler o próximo capítulo"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            autoFocus
          />
          <label htmlFor="task-description">
            Descrição <span>opcional</span>
          </label>
          <textarea
            id="task-description"
            placeholder="Anotações, contexto ou um link importante…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
            rows={4}
          />
          <div className="form-grid">
            <div>
              <label htmlFor="task-group">Grupo</label>
              <select id="task-group" value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="">Caixa de entrada</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="task-priority">Prioridade</label>
              <select
                id="task-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as typeof priority)}
              >
                <option value="low">Baixa</option>
                <option value="normal">Normal</option>
                <option value="high">Alta</option>
              </select>
            </div>
            <div>
              <label htmlFor="task-date">Data de entrega</label>
              <input
                id="task-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="task-time">
                Horário <span>opcional</span>
              </label>
              <input
                id="task-time"
                type="time"
                disabled={!date}
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>
          <label htmlFor="task-status">Situação</label>
          <select
            id="task-status"
            value={task?.trashedAt ? task.status : status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="pending">Pendente</option>
            <option value="in_progress">Em andamento</option>
            {task?.status === 'completed' && <option value="completed">Concluída</option>}
          </select>
          <p className="field-help">Horários de Brasília · Definir prazo não cria um lembrete.</p>
        </fieldset>
        {task?.trashedAt && (
          <div className="trash-detail">
            <Trash2 size={18} />
            <p>
              {task.trashReason === 'completed' ? 'Concluída' : 'Descartada'} em{' '}
              {timestamp(task.trashedAt)}.<br />
              Exclusão prevista: <strong>{timestamp(task.purgeAt!)}</strong>.
            </p>
          </div>
        )}
        {history.length > 0 && (
          <details className="history">
            <summary>
              Histórico da tarefa <span>{history.length}</span>
            </summary>
            <ol>
              {[...history].reverse().map((h) => (
                <li key={h.id}>
                  <span className="history-dot" />
                  <div>
                    {h.action}
                    <small>
                      {timestamp(h.at)} ·{' '}
                      {h.source === 'panel'
                        ? 'Painel'
                        : h.source === 'web'
                          ? 'Assistente'
                          : 'Registro anterior'}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        )}
        <div className="dialog-actions">
          {task && !task.trashedAt && (
            <button
              className="icon-button danger"
              type="button"
              title="Enviar à lixeira"
              aria-label="Enviar tarefa à lixeira"
              disabled={busy}
              onClick={() =>
                void action([
                  { op: 'trash_task', task: `#${task.id}`, expectedVersion: task.version },
                ])
              }
            >
              <Trash2 size={18} />
            </button>
          )}
          <button className="button secondary push-right" type="button" onClick={close}>
            Fechar
          </button>
          {task?.trashedAt ? (
            <button
              className="button primary"
              type="button"
              disabled={busy}
              onClick={() =>
                void action([
                  { op: 'restore_task', task: `#${task.id}`, expectedVersion: task.version },
                ])
              }
            >
              <RotateCcw size={16} />
              Restaurar tarefa
            </button>
          ) : (
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}
              {task ? 'Salvar alterações' : 'Criar tarefa'}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
