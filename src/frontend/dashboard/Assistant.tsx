'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ListTodo, LoaderCircle, MessageCircle, Send, Trash2 } from 'lucide-react';
import { AssistantReply } from './AssistantReply';
import { api } from './api';
import { statusLabels } from './format';
import type { Data } from './types';

const EXAMPLES = [
  'Anota: comprar pilhas',
  'Quais tarefas eu tenho pro dia 24?',
  'Adicione revisar o artigo em Estudos',
  'Finalizei #1',
];

// Tela inicial do painel, não uma janela sobre ele: a conversa é por onde a maior parte dos
// pedidos entra, e abrir a agenda já dentro dela poupa um clique em toda visita.
export function Assistant({ data, refresh }: { data: Data | null; refresh: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const pendingRequest = useRef<{ text: string; id: string } | null>(null);
  const messages = [...(data?.messages.filter((m) => m.channel === 'web') ?? [])].reverse();
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, busy]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      if (pendingRequest.current?.text !== text) {
        pendingRequest.current = { text, id: crypto.randomUUID() };
      }
      const r = await api<{ error?: string; status: string }>('chat', {
        text,
        requestId: pendingRequest.current.id,
      });
      if (r.status === 'processing') {
        setError(
          'Este pedido ainda está sendo processado. Aguarde um pouco e envie novamente para consultar a resposta, sem repetir a ação.',
        );
        await refresh();
        return;
      }
      pendingRequest.current = null;
      setText('');
      if (r.error) setError(r.error);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    setBusy(true);
    setError('');
    try {
      await api('chat/clear', {});
      setConfirming(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="assistant-view" aria-label="Assistente da agenda">
      <div className="chat-note">
        <MessageCircle size={16} />
        {data?.llm === 'none'
          ? 'Sem IA cadastrada, entendo só frases em formato exato, como “Anota: comprar pilhas”. Cadastre uma API em Modelos de IA para escrever do seu jeito.'
          : `Toda mensagem é interpretada pela IA, na ordem de prioridade que você configurou, e conta nos limites diários.${
              data?.settings.naturalReply
                ? ' A resposta passa por uma segunda chamada, que reescreve o texto sem mudar os dados.'
                : ''
            }`}
      </div>
      <div className="chat-messages">
        {!messages.length && (
          <div className="chat-welcome">
            <span className="empty-icon">
              <MessageCircle size={30} />
            </span>
            <h3>O que você quer organizar?</h3>
            <p>Escreva uma tarefa ou experimente um exemplo.</p>
            <div className="chat-examples">
              {EXAMPLES.map((example) => (
                <button key={example} onClick={() => setText(example)}>
                  {example}
                  <ArrowRight size={13} />
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div className="chat-pair" key={m.id}>
            {m.body && <div className="bubble user">{m.body}</div>}
            {m.reply ? (
              <div className="bubble assistant">
                <span className="assistant-name">
                  <ListTodo size={14} />
                  AgendaMagno
                </span>
                <AssistantReply text={m.reply} />
              </div>
            ) : (
              <div className="bubble assistant muted">
                {m.error ?? statusLabels[m.status] ?? 'Aguardando processamento'}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="chat-typing">
            <LoaderCircle size={14} className="spin" />
            Organizando seu pedido…
          </div>
        )}
        <div ref={end} />
      </div>
      {error && (
        <p className="form-error chat-error" role="alert">
          {error}
        </p>
      )}
      <form className="chat-composer" onSubmit={send}>
        <input
          aria-label="Sua mensagem"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex.: Finalizei #1"
          maxLength={6000}
          disabled={busy}
        />
        <button
          className="button primary"
          aria-label="Enviar mensagem"
          disabled={busy || !text.trim()}
        >
          <Send size={18} />
        </button>
      </form>
      <div className="chat-footer">
        <span>A IA interpreta o pedido. A agenda valida e executa as ações.</span>
        {messages.length > 0 &&
          (confirming ? (
            <span className="chat-clear-confirm">
              Apagar toda a conversa?
              <button className="text-button danger" disabled={busy} onClick={clear}>
                Apagar
              </button>
              <button className="text-button" disabled={busy} onClick={() => setConfirming(false)}>
                Cancelar
              </button>
            </span>
          ) : (
            <button className="text-button" onClick={() => setConfirming(true)}>
              <Trash2 size={14} />
              Apagar conversa
            </button>
          ))}
      </div>
    </section>
  );
}
