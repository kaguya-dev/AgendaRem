'use client';

import { useEffect, useState } from 'react';
import { Check, Monitor, Moon, Sparkles, Sun, Trash2 } from 'lucide-react';
import { Dialog } from './Dialog';
import { applyTheme, readTheme, type Theme } from './theme';
import type { Action, Data } from './types';

export function SettingsDialog({
  data,
  busy,
  close,
  action,
  openLlm,
}: {
  data: Data | null;
  busy: boolean;
  close: () => void;
  action: Action;
  openLlm: () => void;
}) {
  const [days, setDays] = useState(data?.settings.retentionDays ?? 30);
  // 'system' até o primeiro render no cliente: no servidor não dá para ler a escolha guardada.
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => setTheme(readTheme()), []);
  function chooseTheme(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }
  return (
    <Dialog title="Do seu jeito" subtitle="Ajustes simples para sua organização." close={close}>
      <form
        className="editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          void action([{ op: 'set_retention', days }]);
        }}
      >
        <div className="setting-title">
          <Sun size={20} />
          <h3>Aparência</h3>
        </div>
        <p className="settings-copy">
          Vale neste aparelho. “Seguir o sistema” acompanha o modo claro ou escuro do seu computador
          ou celular.
        </p>
        <div className="theme-choice" role="group" aria-label="Tema">
          {(
            [
              ['light', 'Claro', <Sun key="l" size={16} />],
              ['dark', 'Escuro', <Moon key="d" size={16} />],
              ['system', 'Seguir o sistema', <Monitor key="s" size={16} />],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              className={theme === value ? 'selected' : ''}
              aria-pressed={theme === value}
              onClick={() => chooseTheme(value)}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
        <div className="setting-title">
          <Trash2 size={20} />
          <h3>Tempo na lixeira</h3>
        </div>
        <p className="settings-copy">
          Ao concluir ou descartar uma tarefa, ela fica na lixeira antes de ser excluída
          definitivamente.
        </p>
        <label htmlFor="retention">Excluir após quantos dias?</label>
        <input
          id="retention"
          type="number"
          min={1}
          max={3650}
          required
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />
        <p className="field-help">
          Vale apenas para novas entradas. Tarefas que já estão na lixeira mantêm a data informada.
          A limpeza ocorre ao acessar a agenda novamente.
        </p>
        <div className="settings-facts">
          <span>
            Fuso horário<strong>America/Bahia</strong>
          </span>
          <span>
            Armazenamento
            <strong>
              {data?.storage === 'local' ? 'Local · desenvolvimento' : 'PostgreSQL · Neon'}
            </strong>
          </span>
          <span>
            Interpretação de mensagens
            <strong>{data?.llm === 'none' ? 'Sem IA — só frases exatas' : 'IA cadastrada'}</strong>
          </span>
        </div>
        <button
          type="button"
          className="button secondary full settings-llm-button"
          onClick={openLlm}
        >
          <Sparkles size={16} />
          Cadastrar e organizar modelos de IA
        </button>
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={close}>
            Cancelar
          </button>
          <button className="button primary" disabled={busy}>
            <Check size={16} />
            Salvar preferência
          </button>
        </div>
      </form>
    </Dialog>
  );
}
