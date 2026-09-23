'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { PublicLlmProvider } from '@/backend/llm-types';

type ProviderForm = {
  id?: string;
  name: string;
  kind: 'gemini' | 'compatible' | 'local';
  model: string;
  apiUrl: string;
  apiKey: string;
  priority: number;
  enabled: boolean;
  dailyRequestLimit: number;
  dailyTokenLimit: number;
};

function emptyForm(priority: number): ProviderForm {
  return {
    name: '',
    kind: 'gemini',
    model: '',
    apiUrl: '',
    apiKey: '',
    priority,
    enabled: true,
    dailyRequestLimit: 100,
    dailyTokenLimit: 0,
  };
}

async function request<T>(path = '', body?: unknown): Promise<T> {
  const response = await fetch(`/api/llm-providers${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('agenda:logout'));
    throw new Error(result.error ?? 'Não foi possível salvar a configuração.');
  }
  return result;
}

const number = (value: number) => value.toLocaleString('pt-BR');
const date = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Bahia',
  }).format(new Date(value));
function providerStatus(provider: PublicLlmProvider, now: number): string {
  if (!provider.enabled) return 'Desativado';
  if (!provider.keySet) return 'Sem chave';
  if (
    provider.requestsToday >= provider.dailyRequestLimit ||
    (provider.dailyTokenLimit > 0 && provider.tokensToday >= provider.dailyTokenLimit)
  )
    return 'Limite diário do app atingido';
  if (provider.cooldownUntil && new Date(provider.cooldownUntil).getTime() > now) return 'Em pausa';
  return 'Disponível';
}

export default function LlmSettings({ onChange }: { onChange: () => Promise<void> }) {
  const [providers, setProviders] = useState<PublicLlmProvider[]>([]);
  const [form, setForm] = useState<ProviderForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const load = useCallback(async () => {
    const result = await request<{ providers: PublicLlmProvider[] }>();
    setProviders([...result.providers].sort((a, b) => a.priority - b.priority));
  }, []);
  useEffect(() => {
    load()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [load]);

  function update<K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : null));
  }
  function edit(provider: PublicLlmProvider) {
    setError('');
    setNotice('');
    setDeleting(null);
    setForm({
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      model: provider.model,
      apiUrl: provider.apiUrl,
      apiKey: '',
      priority: provider.priority,
      enabled: provider.enabled,
      dailyRequestLimit: provider.dailyRequestLimit,
      dailyTokenLimit: provider.dailyTokenLimit,
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request('', {
        ...form,
        name: form.name.trim(),
        model: form.model.trim(),
        apiUrl: form.kind === 'gemini' ? '' : form.apiUrl.trim(),
        apiKey: form.apiKey.trim(),
      });
      setForm(null);
      setNotice('Modelo salvo. A ordem configurada será usada nos próximos pedidos.');
      await load();
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mutate(path: '/delete' | '/reset', id: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(path, { id });
      setDeleting(null);
      setNotice(
        path === '/delete'
          ? 'Modelo removido.'
          : 'Pausa removida. Os limites de uso continuam valendo.',
      );
      await load();
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="llm-settings">
      <p className="llm-intro">
        O assistente tenta os modelos pela prioridade, começando pelo menor número. Se um atingir a
        cota, limitar as chamadas ou falhar, ele tenta o próximo disponível.
      </p>
      <p className="field-help">
        Toda mensagem enviada ao assistente passa por um destes modelos e conta nos limites diários.
        Cadastre o identificador do modelo e a chave fornecidos pela sua API.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="llm-notice" role="status">
          <Check size={16} />
          {notice}
        </p>
      )}
      {!form && (
        <>
          <div className="llm-toolbar">
            <h3>
              Seus modelos <span className="count-pill">{providers.length}</span>
            </h3>
            <button
              className="icon-button"
              aria-label="Atualizar modelos e uso"
              disabled={busy || loading}
              onClick={async () => {
                setLoading(true);
                setError('');
                try {
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setLoading(false);
                }
              }}
            >
              <RefreshCw size={17} className={loading ? 'spin' : ''} />
            </button>
          </div>
          {loading && (
            <p className="llm-loading" role="status">
              <LoaderCircle size={17} className="spin" />
              Carregando modelos…
            </p>
          )}
          {!loading && providers.length === 0 && (
            <div className="llm-empty">
              <Sparkles size={26} />
              <h3>Escolha a IA da sua agenda</h3>
              <p>
                Adicione uma API para interpretar pedidos em linguagem natural. Cadastre mais de uma
                para ter alternativas quando uma estiver indisponível.
              </p>
            </div>
          )}
          <div className="llm-provider-list">
            {providers.map((provider) => {
              const status = providerStatus(provider, now);
              return (
                <article className="llm-provider" key={provider.id}>
                  <div className="llm-provider-heading">
                    <div>
                      <span className="llm-order">Prioridade {provider.priority}</span>
                      <h3>{provider.name}</h3>
                      <p>
                        {provider.kind === 'gemini'
                          ? 'Gemini'
                          : provider.kind === 'local'
                            ? 'Modelo Local'
                            : 'API compatível'} ·{' '}
                        {provider.model}
                      </p>
                    </div>
                    <span className={`llm-status ${status === 'Disponível' ? 'available' : ''}`}>
                      {status}
                    </span>
                  </div>
                  <dl className="llm-usage">
                    <div>
                      <dt>Tentativas hoje</dt>
                      <dd>
                        {number(provider.requestsToday)} / {number(provider.dailyRequestLimit)}
                      </dd>
                    </div>
                    <div>
                      <dt>Uso local de tokens hoje</dt>
                      <dd>
                        {number(provider.tokensToday)}
                        {provider.dailyTokenLimit > 0
                          ? ` / ${number(provider.dailyTokenLimit)}`
                          : ' · sem limite local'}
                      </dd>
                    </div>
                  </dl>
                  <p className="llm-provider-note">
                    {number(provider.reportedTokensToday ?? 0)} confirmados pela API
                    {' · '}
                    {number(provider.estimatedTokensToday ?? 0)} estimados em respostas sem
                    contagem.
                  </p>
                  {provider.legacyTokensToday > 0 && (
                    <p className="llm-provider-note">
                      {number(provider.legacyTokensToday)} do registro anterior, sem separação entre
                      consumo e estimativas. Esse valor não representa consumo confirmado pela API.
                    </p>
                  )}
                  {provider.unconfirmedRequestsToday > 0 && (
                    <p className="llm-provider-note">
                      {number(provider.unconfirmedRequestsToday)} tentativa(s) sem confirmação de
                      consumo. Nenhum token foi somado por essas falhas; o provedor ainda pode ter
                      processado o pedido.
                    </p>
                  )}
                  {provider.cooldownUntil && new Date(provider.cooldownUntil).getTime() > now && (
                    <p className="llm-provider-note">
                      Pausa por mais{' '}
                      {Math.ceil((new Date(provider.cooldownUntil).getTime() - now) / 1000)} s (até{' '}
                      {date(provider.cooldownUntil)}).
                    </p>
                  )}
                  {provider.lastError && (
                    <p className="llm-provider-note">Última falha: {provider.lastError}</p>
                  )}
                  <div className="llm-provider-actions">
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => edit(provider)}
                    >
                      <Pencil size={14} />
                      Editar
                    </button>
                    {(provider.cooldownUntil || provider.lastError) && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => void mutate('/reset', provider.id)}
                      >
                        <RotateCcw size={14} />
                        Liberar tentativa
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-button danger"
                      disabled={busy}
                      onClick={() => setDeleting(deleting === provider.id ? null : provider.id)}
                      aria-label={`Remover ${provider.name}`}
                    >
                      <Trash2 size={14} />
                      Remover
                    </button>
                  </div>
                  {deleting === provider.id && (
                    <div className="llm-delete-confirm">
                      <p>Remover {provider.name} e sua chave salva?</p>
                      <div>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busy}
                          onClick={() => setDeleting(null)}
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          className="button secondary danger"
                          disabled={busy}
                          onClick={() => void mutate('/delete', provider.id)}
                        >
                          Confirmar remoção
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <button
            type="button"
            className="button primary full llm-add-button"
            disabled={loading || busy}
            onClick={() => {
              setError('');
              setNotice('');
              setForm(
                emptyForm(
                  providers.length
                    ? Math.min(1000, Math.max(...providers.map((p) => p.priority)) + 1)
                    : 1,
                ),
              );
            }}
          >
            <Plus size={17} />
            Adicionar modelo
          </button>
          <p className="field-help">
            O uso mostrado é o registrado nesta agenda, não o saldo da conta na API. O limite local
            de tokens pode ser ultrapassado por uma chamada; o total é atualizado depois da
            resposta. Os contadores diários são renovados à meia-noite, no horário de Brasília.
          </p>
        </>
      )}
      {form && (
        <form onSubmit={save} className="llm-provider-form">
          <h3>{form.id ? 'Editar modelo' : 'Novo modelo'}</h3>
          <fieldset disabled={busy}>
            <label htmlFor="llm-name">Nome para identificar</label>
            <input
              id="llm-name"
              autoFocus
              required
              maxLength={80}
              placeholder="Ex.: Minha IA principal"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
            />
            <div className="form-grid">
              <div>
                <label htmlFor="llm-kind">Tipo de API</label>
                <select
                  id="llm-kind"
                  value={form.kind}
                  onChange={(e) => {
                    const newKind = e.target.value as ProviderForm['kind'];
                    update('kind', newKind);
                    if (newKind === 'local' && !form.apiUrl) {
                      update('apiUrl', 'http://127.0.0.1:11434/v1/chat/completions');
                    }
                  }}
                >
                  <option value="gemini">Gemini (Google)</option>
                  <option value="compatible">Compatível com Chat Completions (OpenAI, Groq, etc.)</option>
                  <option value="local">Modelo Local (Ollama, LM Studio, vLLM, LocalAI)</option>
                </select>
              </div>
              <div>
                <label htmlFor="llm-priority">Prioridade de uso</label>
                <input
                  id="llm-priority"
                  type="number"
                  required
                  min={0}
                  max={1000}
                  step={1}
                  value={form.priority}
                  onChange={(e) => update('priority', Number(e.target.value))}
                />
              </div>
            </div>
            {form.kind === 'local' && (
              <div style={{ margin: '8px 0 12px' }}>
                <span style={{ fontSize: '12px', display: 'block', marginBottom: '6px', opacity: 0.85 }}>
                  Preenchimento rápido:
                </span>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="button secondary"
                    style={{ fontSize: '11px', padding: '4px 10px' }}
                    onClick={() => {
                      update('apiUrl', 'http://127.0.0.1:11434/v1/chat/completions');
                      if (!form.model) update('model', 'llama3');
                      if (!form.name) update('name', 'Ollama Local');
                    }}
                  >
                    🦙 Ollama (11434)
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    style={{ fontSize: '11px', padding: '4px 10px' }}
                    onClick={() => {
                      update('apiUrl', 'http://127.0.0.1:1234/v1/chat/completions');
                      if (!form.name) update('name', 'LM Studio');
                    }}
                  >
                    🤖 LM Studio (1234)
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    style={{ fontSize: '11px', padding: '4px 10px' }}
                    onClick={() => {
                      update('apiUrl', 'http://127.0.0.1:8000/v1/chat/completions');
                      if (!form.name) update('name', 'LocalAI / vLLM');
                    }}
                  >
                    ⚡ LocalAI / vLLM (8000)
                  </button>
                </div>
              </div>
            )}
            <label htmlFor="llm-model">Identificador do modelo</label>
            <input
              id="llm-model"
              required
              maxLength={160}
              placeholder={
                form.kind === 'local'
                  ? 'Ex.: llama3, mistral, qwen2.5, phi3'
                  : 'Copie o nome exato informado pela API'
              }
              value={form.model}
              onChange={(e) => update('model', e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
            />
            {form.kind === 'gemini' && (
              <p className="field-help">
                O tipo Gemini fala sempre com a API do Google, em generativelanguage.googleapis.com,
                e por isso não tem campo de endereço. Use-o só para modelos do Google. Para Groq,
                OpenAI, OpenRouter e semelhantes, escolha “Compatível com Chat Completions” e
                informe a URL do serviço.
              </p>
            )}
            {form.kind === 'compatible' && (
              <>
                <label htmlFor="llm-url">Endereço completo da API (HTTPS)</label>
                <input
                  id="llm-url"
                  type="url"
                  required
                  maxLength={2048}
                  placeholder="https://seu-provedor.com/v1/chat/completions"
                  value={form.apiUrl}
                  onChange={(e) => update('apiUrl', e.target.value)}
                  autoCapitalize="none"
                  spellCheck={false}
                />
                <p className="field-help">
                  Informe o endpoint de Chat Completions, com o caminho completo — não o endereço do
                  site nem o do painel do serviço. No Groq, por exemplo, é
                  https://api.groq.com/openai/v1/chat/completions.
                </p>
              </>
            )}
            {form.kind === 'local' && (
              <>
                <label htmlFor="llm-url">Endereço completo da API Local (HTTP ou HTTPS)</label>
                <input
                  id="llm-url"
                  type="url"
                  required
                  maxLength={2048}
                  placeholder="http://127.0.0.1:11434/v1/chat/completions"
                  value={form.apiUrl}
                  onChange={(e) => update('apiUrl', e.target.value)}
                  autoCapitalize="none"
                  spellCheck={false}
                />
                <p className="field-help">
                  Informe o endereço completo do endpoint de Chat Completions do seu servidor local
                  (como Ollama, LM Studio, Jan, LocalAI ou vLLM). Por exemplo:
                  http://127.0.0.1:11434/v1/chat/completions para Ollama.
                </p>
              </>
            )}
            <label htmlFor="llm-key">
              Chave da API{' '}
              {form.kind === 'local' ? (
                <span>(opcional para modelos locais)</span>
              ) : form.id ? (
                <span>· deixe em branco para manter</span>
              ) : null}
            </label>
            <input
              id="llm-key"
              type="password"
              required={!form.id && form.kind !== 'local'}
              autoComplete="new-password"
              maxLength={4096}
              placeholder={
                form.kind === 'local'
                  ? 'Não obrigatório (preencha somente se o servidor local exigir)'
                  : form.id
                    ? 'Chave já salva; preencha apenas para trocar'
                    : 'Cole sua chave secreta'
              }
              value={form.apiKey}
              onChange={(e) => update('apiKey', e.target.value)}
              spellCheck={false}
            />
            <p className="field-help">
              {form.kind === 'local'
                ? 'A maioria dos servidores locais não exige autenticação.'
                : 'A chave é usada pelo servidor e não é exibida novamente após salvar.'}
            </p>
            <div className="form-grid">
              <div>
                <label htmlFor="llm-requests">Limite de chamadas por dia</label>
                <input
                  id="llm-requests"
                  type="number"
                  required
                  min={1}
                  max={100000}
                  step={1}
                  value={form.dailyRequestLimit}
                  onChange={(e) => update('dailyRequestLimit', Number(e.target.value))}
                />
              </div>
              <div>
                <label htmlFor="llm-tokens">Limite de tokens por dia</label>
                <input
                  id="llm-tokens"
                  type="number"
                  required
                  min={0}
                  max={1000000000}
                  step={1}
                  value={form.dailyTokenLimit}
                  onChange={(e) => update('dailyTokenLimit', Number(e.target.value))}
                />
                <p className="field-help">0 = sem limite local de tokens.</p>
              </div>
            </div>
            <label className="llm-enabled" htmlFor="llm-enabled">
              <input
                id="llm-enabled"
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => update('enabled', e.target.checked)}
              />
              Usar este modelo no assistente
            </label>
          </fieldset>
          <div className="llm-form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setForm(null);
                setError('');
              }}
            >
              Cancelar
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}Salvar
              modelo
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
