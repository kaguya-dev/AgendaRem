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
  const [status, setStatus] = useState<'pending' | 'in_progress' | 'completed'>(
    task?.status ?? 'pending',
  );
  const [tags, setTags] = useState(task?.tags?.join(', ') ?? '');
  const [checklist, setChecklist] = useState(task?.checklist ?? []);
  const [step, setStep] = useState('');
  const [frequency, setFrequency] = useState(task?.recurrence?.frequency ?? 'none');
  const [interval, setIntervalValue] = useState(task?.recurrence?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(task?.recurrence?.weekdays ?? []);
  const [reminder, setReminder] = useState(
    task?.reminderMinutes == null ? '' : String(task.reminderMinutes),
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
        ...(status !== 'completed' ? { status } : {}),
        dueDate: date || null,
        dueTime: date && time ? time : null,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        checklist,
        recurrence:
          frequency === 'none'
            ? null
            : {
                frequency: frequency as 'daily' | 'weekly' | 'monthly',
                interval,
                ...(frequency === 'weekly' ? { weekdays } : {}),
                ...(frequency === 'monthly' && task?.dueDate === date && task?.recurrence?.monthDay
                  ? { monthDay: task.recurrence.monthDay }
                  : {}),
              },
        reminderMinutes: reminder === '' ? null : Number(reminder),
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
                {groups
                  .filter((g) => !g.archivedAt || g.id === task?.groupId)
                  .map((g) => (
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
          <label htmlFor="task-tags">Etiquetas separadas por vírgula</label>
          <input
            id="task-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="estudo, pessoal, urgente"
            maxLength={800}
          />
          <div className="form-grid">
            <div>
              <label htmlFor="task-repeat">Repetir</label>
              <select
                id="task-repeat"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as typeof frequency)}
              >
                <option value="none">Não repetir</option>
                <option value="daily">Diariamente</option>
                <option value="weekly">Semanalmente</option>
                <option value="monthly">Mensalmente</option>
              </select>
            </div>
            {frequency !== 'none' && (
              <div>
                <label htmlFor="repeat-interval">Intervalo da repetição</label>
                <input
                  id="repeat-interval"
                  type="number"
                  min={1}
                  max={365}
                  value={interval}
                  onChange={(e) => setIntervalValue(Number(e.target.value))}
                />
                <small>
                  {frequency === 'daily'
                    ? 'dia(s)'
                    : frequency === 'weekly'
                      ? 'semana(s)'
                      : 'mês(es)'}
                </small>
              </div>
            )}
          </div>
          {frequency === 'weekly' && (
            <div className="weekday-choice" role="group" aria-label="Dias da semana">
              {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day, i) => (
                <label key={day}>
                  <input
                    type="checkbox"
                    checked={weekdays.includes(i)}
                    onChange={(e) =>
                      setWeekdays(
                        e.target.checked ? [...weekdays, i] : weekdays.filter((d) => d !== i),
                      )
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
          )}
          {frequency !== 'none' && (
            <p className="field-help">
              Ao concluir, cria a próxima ocorrência a partir do prazo atual. Defina uma data.
            </p>
          )}
          <label htmlFor="task-reminder">Lembrete</label>
          <select id="task-reminder" value={reminder} onChange={(e) => setReminder(e.target.value)}>
            <option value="">Sem lembrete</option>
            <option value="0">No prazo</option>
            <option value="5">5 minutos antes</option>
            <option value="15">15 minutos antes</option>
            <option value="30">30 minutos antes</option>
            <option value="60">1 hora antes</option>
            <option value="1440">1 dia antes</option>
            {reminder && !['0', '5', '15', '30', '60', '1440'].includes(reminder) && (
              <option value={reminder}>{reminder} minutos antes</option>
            )}
          </select>
          <p className="field-help">
            Horários de Brasília. Sem horário, o lembrete considera 09:00. Ative notificações nas
            configurações.
          </p>
          <label>
            Checklist · {checklist.filter((i) => i.done).length}/{checklist.length}
          </label>
          <div className="checklist">
            {checklist.map((item) => (
              <div className="checklist-item" key={item.id}>
                <input
                  type="checkbox"
                  aria-label={`Concluir etapa ${item.title}`}
                  checked={item.done}
                  onChange={(e) =>
                    setChecklist(
                      checklist.map((i) =>
                        i.id === item.id ? { ...i, done: e.target.checked } : i,
                      ),
                    )
                  }
                />
                <span className={item.done ? 'done' : ''}>{item.title}</span>
                <button
                  type="button"
                  className="text-button danger"
                  aria-label={`Remover etapa ${item.title}`}
                  onClick={() => setChecklist(checklist.filter((i) => i.id !== item.id))}
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
          <div className="inline-input">
            <input
              aria-label="Nova etapa"
              value={step}
              maxLength={200}
              onChange={(e) => setStep(e.target.value)}
              placeholder="Uma etapa da tarefa"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (step.trim() && checklist.length < 100) {
                    setChecklist([
                      ...checklist,
                      { id: crypto.randomUUID(), title: step.trim(), done: false },
                    ]);
                    setStep('');
                  }
                }
              }}
            />
            <button
              type="button"
              className="button secondary"
              disabled={!step.trim() || checklist.length >= 100}
              onClick={() => {
                setChecklist([
                  ...checklist,
                  { id: crypto.randomUUID(), title: step.trim(), done: false },
                ]);
                setStep('');
              }}
            >
              Adicionar etapa
            </button>
          </div>
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
