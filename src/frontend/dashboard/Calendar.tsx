'use client';
import { useState } from 'react';
import type { Task } from '@/backend/domain';
import type { Action } from './types';
import { today } from './format';
const iso = (date: Date) => date.toISOString().slice(0, 10);
export function Calendar({
  tasks,
  edit,
  action,
  busy,
}: {
  tasks: Task[];
  edit: (task: Task) => void;
  action: Action;
  busy: boolean;
}) {
  const [anchor, setAnchor] = useState(today());
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const date = new Date(`${anchor}T12:00:00Z`);
  const start = new Date(date);
  if (mode === 'month') start.setUTCDate(1);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const days = Array.from(
    { length: mode === 'month' ? 42 : 7 },
    (_, i) => new Date(start.getTime() + i * 86400000),
  );
  function move(direction: number) {
    const next = new Date(date);
    if (mode === 'month') {
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + direction);
    } else next.setUTCDate(next.getUTCDate() + direction * 7);
    setAnchor(iso(next));
  }
  return (
    <section className="calendar-card">
      <div className="calendar-toolbar">
        <div>
          <h2>
            {new Intl.DateTimeFormat('pt-BR', {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(date)}
          </h2>
          <p>Arraste uma tarefa para reagendar ou abra seus detalhes.</p>
        </div>
        <div className="calendar-controls">
          <button
            className="button secondary"
            onClick={() => move(-1)}
            aria-label="Período anterior"
          >
            ←
          </button>
          <button className="button secondary" onClick={() => setAnchor(today())}>
            Hoje
          </button>
          <button className="button secondary" onClick={() => move(1)} aria-label="Próximo período">
            →
          </button>
          <select
            aria-label="Visualização do calendário"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="month">Mês</option>
            <option value="week">Semana</option>
          </select>
        </div>
      </div>
      <div className={`calendar-grid ${mode}`}>
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => (
          <div className="calendar-weekday" key={day}>
            {day}
          </div>
        ))}
        {days.map((day) => {
          const key = iso(day);
          return (
            <div
              key={key}
              className={`calendar-day ${key === today() ? 'today' : ''} ${day.getUTCMonth() !== date.getUTCMonth() ? 'outside' : ''}`}
              aria-label={`Dia ${key}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = Number(e.dataTransfer.getData('text/plain'));
                const task = tasks.find((t) => t.id === id);
                if (task && !busy)
                  void action(
                    [
                      {
                        op: 'update_task',
                        task: `#${id}`,
                        dueDate: key,
                        expectedVersion: task.version,
                      },
                    ],
                    false,
                  );
              }}
            >
              <span className="calendar-number">{day.getUTCDate()}</span>
              {tasks
                .filter((t) => t.dueDate === key && !t.trashedAt && t.status !== 'completed')
                .map((t) => (
                  <button
                    key={t.id}
                    className={`calendar-task priority-${t.priority}`}
                    draggable={!busy && t.id > 0}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', String(t.id))}
                    onClick={() => edit(t)}
                  >
                    <small>{t.dueTime ?? 'Sem horário'}</small>
                    {t.title}
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
