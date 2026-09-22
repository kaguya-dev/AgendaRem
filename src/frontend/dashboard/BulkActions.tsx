'use client';
import { useState } from 'react';
import type { Command, Group, Task } from '@/backend/domain';
import type { Action } from './types';
export function BulkActions({
  tasks,
  groups,
  clear,
  action,
  busy,
}: {
  tasks: Task[];
  groups: Group[];
  clear: () => void;
  action: Action;
  busy: boolean;
}) {
  const [target, setTarget] = useState('');
  const [priority, setPriority] = useState('normal');
  const [confirm, setConfirm] = useState(false);
  async function apply(command: Partial<Command>) {
    if (
      await action(
        tasks.map(
          (t) =>
            ({
              op: 'update_task',
              ...command,
              task: `#${t.id}`,
              expectedVersion: t.version,
            }) as Command,
        ),
        false,
      )
    ) {
      clear();
      setConfirm(false);
    }
  }
  const active = tasks.every((t) => !t.trashedAt && t.status !== 'completed');
  const editable = tasks.every((t) => !t.trashedAt);
  return (
    <div className="bulk-toolbar">
      <strong>{tasks.length} selecionada(s)</strong>
      <button className="text-button" onClick={clear}>
        Limpar seleção
      </button>
      {editable && (
        <>
          <select
            aria-label="Mover selecionadas para"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Caixa de entrada</option>
            {groups
              .filter((g) => !g.archivedAt)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void apply({ group: target || null })}
          >
            Mover selecionadas
          </button>
          <select
            aria-label="Prioridade das selecionadas"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="low">Baixa</option>
            <option value="normal">Normal</option>
            <option value="high">Alta</option>
          </select>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void apply({ priority: priority as 'normal' })}
          >
            Aplicar prioridade
          </button>
        </>
      )}
      {active && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void apply({ op: 'complete_task' })}
        >
          Concluir selecionadas
        </button>
      )}
      {!active && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void apply({ op: 'restore_task' })}
        >
          Restaurar selecionadas
        </button>
      )}
      {tasks.some((t) => !t.trashedAt) &&
        (confirm ? (
          <>
            <span>Enviar {tasks.length} tarefa(s) à lixeira?</span>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void apply({ op: 'trash_task' })}
            >
              Confirmar envio à lixeira
            </button>
            <button className="text-button" onClick={() => setConfirm(false)}>
              Cancelar
            </button>
          </>
        ) : (
          <button className="button danger" disabled={busy} onClick={() => setConfirm(true)}>
            Excluir selecionadas
          </button>
        ))}
    </div>
  );
}
