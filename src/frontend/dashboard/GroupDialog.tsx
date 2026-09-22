'use client';
import { useState } from 'react';
import type { Group } from '@/backend/domain';
import { Dialog } from './Dialog';
import type { Action } from './types';
export const groupIcons: Record<string, string> = {
  folder: '📁',
  book: '📚',
  briefcase: '💼',
  home: '🏠',
  heart: '♥',
  star: '★',
};
export function GroupDialog({
  group,
  taskCount = 0,
  busy,
  close,
  action,
}: {
  group?: Group;
  taskCount?: number;
  busy: boolean;
  close: () => void;
  action: Action;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [color, setColor] = useState(group?.color ?? 'sage');
  const [icon, setIcon] = useState(group?.icon ?? 'folder');
  const [order, setOrder] = useState(group?.order ?? 0);
  const [deleting, setDeleting] = useState(false);
  const [deleteTasks, setDeleteTasks] = useState(false);
  return (
    <Dialog
      title={group ? 'Editar grupo' : 'Um lugar para suas tarefas'}
      subtitle="Organize suas tarefas por assunto ou projeto."
      close={close}
    >
      <form
        className="editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          void action([
            {
              op: group ? 'update_group' : 'create_group',
              name,
              color: color as 'sage',
              icon: icon as 'folder',
              order,
              ...(group ? { group: group.id, expectedVersion: group.version ?? 0 } : {}),
            },
          ]);
        }}
      >
        <fieldset disabled={busy || deleting}>
          <label htmlFor="group-name">Nome do grupo</label>
          <input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
            autoFocus
          />
          <div className="form-grid">
            <div>
              <label htmlFor="group-color">Cor</label>
              <select id="group-color" value={color} onChange={(e) => setColor(e.target.value)}>
                {Object.entries({
                  sage: 'Verde',
                  blue: 'Azul',
                  violet: 'Violeta',
                  amber: 'Âmbar',
                  rose: 'Rosa',
                }).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="group-icon">Ícone</label>
              <select id="group-icon" value={icon} onChange={(e) => setIcon(e.target.value)}>
                {Object.entries(groupIcons).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}{' '}
                    {
                      (
                        {
                          folder: 'Pasta',
                          book: 'Livro',
                          briefcase: 'Trabalho',
                          home: 'Casa',
                          heart: 'Coração',
                          star: 'Estrela',
                        } as Record<string, string>
                      )[key]
                    }
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label htmlFor="group-order">Ordem na barra lateral</label>
          <input
            id="group-order"
            type="number"
            min={0}
            max={10000}
            value={order}
            onChange={(e) => setOrder(Number(e.target.value))}
          />
          <p className="field-help">Os menores números aparecem primeiro.</p>
        </fieldset>
        {!deleting && (
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={close}>
              Cancelar
            </button>
            <button className="button primary" disabled={busy}>
              {group ? 'Salvar grupo' : 'Criar grupo'}
            </button>
          </div>
        )}
      </form>
      {group && (
        <div className="group-management">
          {!deleting ? (
            <>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void action([
                    {
                      op: group.archivedAt ? 'restore_group' : 'archive_group',
                      group: group.id,
                      expectedVersion: group.version ?? 0,
                    },
                  ])
                }
              >
                {group.archivedAt ? 'Restaurar grupo' : 'Arquivar grupo'}
              </button>
              <button className="button danger" disabled={busy} onClick={() => setDeleting(true)}>
                Excluir grupo
              </button>
            </>
          ) : (
            <div className="confirmation-panel">
              <h3>Excluir “{group.name}”?</h3>
              <p>{taskCount} tarefa(s) vinculada(s). Escolha o que fazer com elas.</p>
              <label className="check-label">
                <input
                  type="radio"
                  name="delete-mode"
                  checked={!deleteTasks}
                  onChange={() => setDeleteTasks(false)}
                />
                Manter tarefas; as ativas vão para a Caixa de entrada
              </label>
              <label className="check-label">
                <input
                  type="radio"
                  name="delete-mode"
                  checked={deleteTasks}
                  onChange={() => setDeleteTasks(true)}
                />
                Excluir também as tarefas, enviando-as à lixeira
              </label>
              <p className="field-help">
                Tarefas que já estão na lixeira mantêm o prazo de exclusão.
              </p>
              <div className="dialog-actions">
                <button className="button secondary" onClick={() => setDeleting(false)}>
                  Cancelar exclusão
                </button>
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() =>
                    void action([
                      {
                        op: 'delete_group',
                        group: group.id,
                        deleteTasks,
                        expectedVersion: group.version ?? 0,
                      },
                    ])
                  }
                >
                  Confirmar exclusão
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
