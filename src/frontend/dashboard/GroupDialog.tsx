'use client';

import { useState } from 'react';
import { Folder } from 'lucide-react';
import type { Group } from '@/backend/domain';
import { Dialog } from './Dialog';
import type { Action } from './types';

export function GroupDialog({
  group,
  busy,
  close,
  action,
}: {
  group?: Group;
  busy: boolean;
  close: () => void;
  action: Action;
}) {
  const [name, setName] = useState(group?.name ?? '');
  return (
    <Dialog
      title={group ? 'Renomear grupo' : 'Um lugar para suas tarefas'}
      subtitle="Agrupe por disciplina, projeto ou área da vida."
      close={close}
    >
      <form
        className="editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          void action([
            {
              op: group ? 'rename_group' : 'create_group',
              name,
              ...(group ? { group: group.id } : {}),
            },
          ]);
        }}
      >
        <label htmlFor="group-name">Nome do grupo</label>
        <input
          id="group-name"
          autoFocus
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Estudos, Casa, Trabalho"
        />
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={close}>
            Cancelar
          </button>
          <button className="button primary" disabled={busy}>
            <Folder size={16} />
            {group ? 'Salvar nome' : 'Criar grupo'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
