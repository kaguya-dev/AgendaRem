'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Dialog } from './Dialog';
import { statusLabels, timestamp } from './format';
import type { Data } from './types';

export function ActivityDialog({
  data,
  close,
  refresh,
}: {
  data: Data | null;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const messages = data?.messages.filter((m) => m.channel === 'web' || m.channel === 'panel') ?? [];
  return (
    <Dialog
      title="Atividade da agenda"
      subtitle="Histórico de pedidos feitos pelo assistente e pelo painel."
      close={close}
      wide
    >
      <div className="activity-content">
        <div className="activity-heading">
          <h3>Pedidos recentes</h3>
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await refresh();
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={15} className={busy ? 'spin' : ''} />
            Atualizar
          </button>
        </div>
        {!messages.length && (
          <p className="muted">Os pedidos aparecerão aqui conforme você usar a agenda.</p>
        )}
        {messages.map((m) => (
          <div className="activity-item" key={m.id}>
            <span className={`activity-dot ${m.status === 'failed' ? 'failed' : ''}`} />
            <div>
              <strong>{m.body || 'Alteração pelo painel'}</strong>
              <p>
                {m.channel === 'web' ? 'Assistente' : 'Painel'} ·{' '}
                {statusLabels[m.status] ?? m.status} · {timestamp(m.created_at)}
              </p>
              {m.error && <p className="form-error">{m.error}</p>}
              {m.reply && <p>{m.reply}</p>}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
