'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  Clock3,
  Folder,
  Inbox,
  LayoutGrid,
  ListTodo,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { Command, Group, History, Task } from '@/lib/domain';

type View =
  'all' | 'inbox' | 'today' | 'overdue' | 'no_date' | 'completed' | 'trash' | `group:${string}`;
type Message = {
  id: string;
  channel: string;
  body: string | null;
  reply: string | null;
  status: string;
  error: string | null;
  created_at: string;
};
type Delivery = { id: string; status: string; error: string | null; attempts: number };
type Data = {
  tasks: Task[];
  groups: Group[];
  history: History[];
  settings: { retentionDays: number; whatsappStatus: string; whatsappUpdatedAt: string | null };
  messages: Message[];
  deliveries: Delivery[];
  llm: string;
  storage: string;
  whatsappConfigured: boolean;
};
type Modal =
  | { type: 'task'; task?: Task }
  | { type: 'group'; group?: Group }
  | { type: 'settings' }
  | { type: 'chat' }
  | { type: 'activity' }
  | null;
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bahia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const timestamp = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Bahia',
  }).format(new Date(value));
const overdue = (t: Task) =>
  Boolean(
    t.dueDate &&
    (t.dueTime ? new Date(`${t.dueDate}T${t.dueTime}:00-03:00`) < new Date() : t.dueDate < today()),
  );
const due = (t: Task) =>
  !t.dueDate
    ? 'Sem prazo'
    : `${t.dueDate === today() ? 'Hoje' : t.dueDate.split('-').slice(1).reverse().join('/') + (t.dueDate.slice(0, 4) !== today().slice(0, 4) ? '/' + t.dueDate.slice(0, 4) : '')}${t.dueTime ? ` · ${t.dueTime}` : ''}`;
const labels: Record<string, string> = {
  all: 'Todas as tarefas',
  inbox: 'Caixa de entrada',
  today: 'Hoje',
  overdue: 'Atrasadas',
  no_date: 'Sem prazo',
  completed: 'Concluídas',
  trash: 'Lixeira',
};
const statusLabels: Record<string, string> = {
  pending: 'Pendente',
  in_progress: 'Em andamento',
  completed: 'Concluída',
  processing: 'Processando',
  done: 'Concluído',
  clarification: 'Aguardando esclarecimento',
  failed: 'Falhou',
  uncertain: 'Entrega incerta',
  sending: 'Enviando',
};
const priorityLabels = { low: 'Baixa', normal: 'Normal', high: 'Alta' };

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== 'login')
      window.dispatchEvent(new Event('agenda:logout'));
    throw new Error(result.error ?? 'Não foi possível concluir.');
  }
  return result;
}
function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? 'light' : ''}`}>
      <span className="brand-mark">
        <ListTodo size={23} strokeWidth={2.2} />
      </span>
      <span>
        agenda<span className="brand-bold">magno</span>
        <small>ESPAÇO PARA O QUE IMPORTA</small>
      </span>
    </div>
  );
}
function Dialog({
  title,
  subtitle,
  children,
  close,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const show = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener('agenda:error', show);
    return () => window.removeEventListener('agenda:error', show);
  }, []);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'dialog-wide' : ''}`}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      aria-label={title}
    >
      <div className="dialog-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="Fechar" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('login', { password });
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-screen">
      <div className="login-story">
        <Brand light />
        <div className="login-copy">
          <span className="eyebrow">MENOS RUÍDO. MAIS CLAREZA.</span>
          <h1>
            Uma coisa
            <br />
            de cada vez<span>.</span>
          </h1>
          <p>
            Suas ideias, tarefas e próximos passos.
            <br />
            Tudo no seu lugar, no seu ritmo.
          </p>
          <div className="login-illustration" aria-hidden="true">
            <div>
              <span className="mini-check">
                <Check size={15} />
              </span>
              <i />
              <span className="mini-tag">feito</span>
            </div>
            <div>
              <Circle size={19} />
              <i />
              <span className="mini-dot" />
            </div>
            <div>
              <Circle size={19} />
              <i />
            </div>
          </div>
        </div>
        <span className="login-footer">Organização pessoal, feita para você.</span>
      </div>
      <main className="login-panel">
        <div className="login-card">
          <span className="login-icon">
            <ShieldCheck size={28} />
          </span>
          <span className="eyebrow">SEU ESPAÇO PESSOAL</span>
          <h2>Bom ter você por aqui.</h2>
          <p>Entre para cuidar do que vem a seguir.</p>
          <form onSubmit={submit}>
            <label htmlFor="password">Sua senha</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              placeholder="Digite sua senha de acesso"
            />
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  Entrar no meu espaço
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          <small>Acesso exclusivo ao seu AgendaMagno.</small>
        </div>
      </main>
    </div>
  );
}

export default function Dashboard() {
  const [auth, setAuth] = useState<boolean | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [view, setView] = useState<View>('all');
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [mobile, setMobile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [page, setPage] = useState(1);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<Data>('state'));
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    api<{ authenticated: boolean }>('auth')
      .then((r) => setAuth(r.authenticated))
      .catch(() => setAuth(false));
    const logout = () => {
      setAuth(false);
      setData(null);
    };
    window.addEventListener('agenda:logout', logout);
    return () => window.removeEventListener('agenda:logout', logout);
  }, []);
  useEffect(() => {
    if (auth) void refresh();
  }, [auth, refresh]);
  useEffect(() => {
    setPage(1);
  }, [view, search, priority, status]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  async function action(commands: Command[], close = true) {
    setBusy(true);
    try {
      const result = await api<{ reply: string; clarification: boolean }>('actions', {
        commands,
        requestId: crypto.randomUUID(),
      });
      setNotice({ text: result.reply, error: result.clarification });
      if (result.clarification)
        window.dispatchEvent(new CustomEvent('agenda:error', { detail: result.reply }));
      await refresh();
      if (close && !result.clarification) setModal(null);
      return !result.clarification;
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true });
      window.dispatchEvent(new CustomEvent('agenda:error', { detail: (e as Error).message }));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: View) {
    setView(next);
    setMobile(false);
    setSearch('');
    setPriority('');
    setStatus('');
  }
  if (auth === null)
    return (
      <div className="loading-screen">
        <Brand />
        <LoaderCircle className="spin" />
        <span>Preparando seu espaço…</span>
      </div>
    );
  if (!auth) return <Login onLogin={() => setAuth(true)} />;
  const tasks = data?.tasks ?? [];
  const groups = data?.groups ?? [];
  const active = tasks.filter((t) => !t.trashedAt);
  const group = view.startsWith('group:') ? groups.find((g) => g.id === view.slice(6)) : undefined;
  const title = group?.name ?? labels[view] ?? 'Tarefas';
  const isTrash = view === 'trash' || view === 'completed';
  const filtered = tasks
    .filter((t) => {
      if (isTrash ? !t.trashedAt : t.trashedAt) return false;
      if (view === 'completed' && t.status !== 'completed') return false;
      if (view === 'inbox' && t.groupId) return false;
      if (view === 'today' && t.dueDate !== today()) return false;
      if (view === 'overdue' && !overdue(t)) return false;
      if (view === 'no_date' && t.dueDate) return false;
      if (group && t.groupId !== group.id) return false;
      if (priority && t.priority !== priority) return false;
      if (status && t.status !== status) return false;
      const norm = (s: string) =>
        s
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();
      return norm(`${t.title} ${t.description}`).includes(norm(search));
    })
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.id - a.id);
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pages);
  const shown = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const connection = !data?.whatsappConfigured
    ? 'Não configurado'
    : ({
        WORKING: 'Conectado',
        SCAN_QR_CODE: 'Aguardando QR',
        STARTING: 'Conectando',
        STOPPED: 'Desconectado',
        FAILED: 'Falha na conexão',
      }[data.settings.whatsappStatus] ?? 'Aguardando conexão');
  const issueCount =
    (data?.messages.filter((m) => m.status === 'failed' || m.status === 'clarification').length ??
      0) + (data?.deliveries.length ?? 0);
  const navItem = (key: View, label: string, icon: ReactNode, count?: number) => (
    <button className={`nav-item ${view === key ? 'selected' : ''}`} onClick={() => navigate(key)}>
      {icon}
      <span>{label}</span>
      {count !== undefined && <span className="nav-count">{count}</span>}
    </button>
  );
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="mobile-scrim"
          aria-label="Fechar menu"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <Brand />
        <div className="workspace-label">
          <span className="workspace-avatar">M</span>
          <div>
            Meu espaço<small>Organização pessoal</small>
          </div>
          <span className="personal-tag">PESSOAL</span>
        </div>
        <nav aria-label="Navegação principal">
          <span className="nav-label">SUA AGENDA</span>
          {navItem('all', 'Todas as tarefas', <LayoutGrid size={18} />, active.length)}
          {navItem(
            'inbox',
            'Caixa de entrada',
            <Inbox size={18} />,
            active.filter((t) => !t.groupId).length,
          )}
          {navItem(
            'today',
            'Hoje',
            <Clock3 size={18} />,
            active.filter((t) => t.dueDate === today()).length,
          )}
          {navItem(
            'overdue',
            'Atrasadas',
            <ArrowDown size={18} />,
            active.filter((t) => overdue(t)).length,
          )}
          {navItem('no_date', 'Sem prazo', <ListTodo size={18} />)}
          <div className="nav-label group-label">
            MEUS GRUPOS
            <button
              className="icon-button tiny"
              aria-label="Criar grupo"
              onClick={() => setModal({ type: 'group' })}
            >
              <Plus size={17} />
            </button>
          </div>
          <div className="group-nav">
            {groups.map((g, i) => (
              <button
                key={g.id}
                className={`nav-item ${view === `group:${g.id}` ? 'selected' : ''}`}
                onClick={() => navigate(`group:${g.id}`)}
              >
                <span className={`group-dot color-${i % 5}`} />
                <span>{g.name}</span>
                <span className="nav-count">{active.filter((t) => t.groupId === g.id).length}</span>
              </button>
            ))}
            {!groups.length && (
              <button className="empty-groups" onClick={() => setModal({ type: 'group' })}>
                + Seu primeiro grupo
              </button>
            )}
          </div>
          <div className="nav-divider" />
          {navItem(
            'completed',
            'Concluídas',
            <CheckCheck size={18} />,
            tasks.filter((t) => t.status === 'completed').length,
          )}
          {navItem(
            'trash',
            'Lixeira',
            <Trash2 size={18} />,
            tasks.filter((t) => t.trashedAt).length,
          )}
        </nav>
        <div className="sidebar-bottom">
          <button className="connection-card" onClick={() => setModal({ type: 'activity' })}>
            <MessageCircle size={20} />
            <span>
              WhatsApp
              <small>
                <i className={data?.settings.whatsappStatus === 'WORKING' ? 'connected' : ''} />
                {connection}
              </small>
            </span>
            <ChevronRight size={15} />
          </button>
          <button className="nav-item" onClick={() => setModal({ type: 'settings' })}>
            <Settings2 size={18} />
            <span>Configurações</span>
          </button>
          <button
            className="nav-item"
            onClick={async () => {
              try {
                await api('logout', {});
                setAuth(false);
                setData(null);
              } catch (e) {
                setNotice({ text: (e as Error).message, error: true });
              }
            }}
          >
            <LogOut size={18} />
            <span>Sair</span>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir menu"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span>Meu espaço</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <span className="today-label">
              {new Intl.DateTimeFormat('pt-BR', {
                day: 'numeric',
                month: 'long',
                timeZone: 'America/Bahia',
              }).format(new Date())}
            </span>
            <button
              className="avatar"
              aria-label="Abrir configurações"
              onClick={() => setModal({ type: 'settings' })}
            >
              M
            </button>
          </div>
        </header>
        <main className="main-content">
          <section className="page-heading">
            <div>
              <span className="eyebrow">UM PASSO DE CADA VEZ</span>
              <div className="title-row">
                <h1>{title}</h1>
                {group && (
                  <button
                    className="icon-button"
                    aria-label="Renomear grupo"
                    onClick={() => setModal({ type: 'group', group })}
                  >
                    <Pencil size={17} />
                  </button>
                )}
              </div>
              <p>
                {isTrash
                  ? 'O que já passou também tem seu lugar. Restaure enquanto precisar.'
                  : group
                    ? 'Um espaço para transformar planos em próximos passos.'
                    : 'Tire da cabeça. Organize aqui. Siga no seu ritmo.'}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="icon-button outlined"
                aria-label="Atualizar tarefas"
                title="Atualizar"
                onClick={() => void refresh()}
                disabled={loading}
              >
                <RefreshCw size={18} className={loading ? 'spin' : ''} />
              </button>
              <button className="button primary" onClick={() => setModal({ type: 'task' })}>
                <Plus size={18} />
                Nova tarefa
              </button>
            </div>
          </section>
          <section className="stats" aria-label="Resumo da agenda">
            <button className="stat-card" onClick={() => navigate('all')}>
              <span className="stat-icon sage">
                <ListTodo size={20} />
              </span>
              <span>
                <span className="stat-label">Tarefas ativas</span>
                <strong>
                  {active.length}
                  <small>para seguir em frente</small>
                </strong>
              </span>
              <span className="stat-corner">↗</span>
            </button>
            <button className="stat-card" onClick={() => navigate('today')}>
              <span className="stat-icon sand">
                <Clock3 size={20} />
              </span>
              <span>
                <span className="stat-label">Para hoje</span>
                <strong>
                  {active.filter((t) => t.dueDate === today()).length}
                  <small>um foco de cada vez</small>
                </strong>
              </span>
              <span className="stat-corner">↗</span>
            </button>
            <button className="stat-card" onClick={() => navigate('completed')}>
              <span className="stat-icon lilac">
                <CheckCheck size={20} />
              </span>
              <span>
                <span className="stat-label">Concluídas</span>
                <strong>
                  {tasks.filter((t) => t.status === 'completed').length}
                  <small>guardadas na lixeira</small>
                </strong>
              </span>
              <span className="stat-corner">↗</span>
            </button>
          </section>
          <section className="tasks-card">
            <div className="list-toolbar">
              <div className="list-heading">
                <h2>{isTrash ? 'Seu histórico recente' : 'Seus próximos passos'}</h2>
                <span className="count-pill">{filtered.length}</span>
              </div>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void action([{ op: 'undo' }], false)}
              >
                <RotateCcw size={15} />
                Desfazer
              </button>
            </div>
            <div className="filters">
              <label className="search-box">
                <Search size={18} />
                <input
                  type="search"
                  placeholder="Buscar título ou descrição…"
                  aria-label="Buscar tarefas"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    className="icon-button tiny"
                    aria-label="Limpar busca"
                    onClick={() => setSearch('')}
                  >
                    <X size={15} />
                  </button>
                )}
              </label>
              <div className="filter-selects">
                <select
                  aria-label="Filtrar prioridade"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  <option value="">Prioridade: todas</option>
                  <option value="high">Alta</option>
                  <option value="normal">Normal</option>
                  <option value="low">Baixa</option>
                </select>
                {!isTrash && (
                  <select
                    aria-label="Filtrar situação"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="">Situação: todas</option>
                    <option value="pending">Pendente</option>
                    <option value="in_progress">Em andamento</option>
                  </select>
                )}
              </div>
            </div>
            {isTrash && (
              <div className="trash-notice">
                <Trash2 size={16} />
                As tarefas permanecem aqui até a data de exclusão. Você pode restaurá-las antes
                disso.
              </div>
            )}
            <div className="task-table">
              <div className="table-head">
                <span>TAREFA</span>
                <span>GRUPO</span>
                <span>{isTrash ? 'EXCLUSÃO PREVISTA' : 'PRAZO'}</span>
                <span>PRIORIDADE</span>
                <span />
              </div>
              {!data ? (
                <div className="empty-state">
                  <LoaderCircle className={loading ? 'spin' : ''} size={30} />
                  <h3>{loading ? 'Carregando sua agenda…' : 'Não foi possível carregar'}</h3>
                  <p>
                    {loading
                      ? 'Buscando seus próximos passos.'
                      : 'Confira a conexão e tente atualizar.'}
                  </p>
                  {!loading && (
                    <button className="button secondary" onClick={() => void refresh()}>
                      Tentar novamente
                    </button>
                  )}
                </div>
              ) : shown.length ? (
                shown.map((t) => (
                  <div className={`task-row ${t.trashedAt ? 'trashed' : ''}`} key={t.id}>
                    <div className="task-primary">
                      {t.trashedAt ? (
                        <span className="completed-check">
                          {t.status === 'completed' ? <Check size={17} /> : <Trash2 size={16} />}
                        </span>
                      ) : (
                        <button
                          className={`task-check ${t.status === 'in_progress' ? 'in-progress' : ''}`}
                          aria-label={`Concluir ${t.title}`}
                          disabled={busy}
                          onClick={() =>
                            void action(
                              [
                                {
                                  op: 'complete_task',
                                  task: `#${t.id}`,
                                  expectedVersion: t.version,
                                },
                              ],
                              false,
                            )
                          }
                        >
                          {t.status === 'in_progress' && <span />}
                        </button>
                      )}
                      <button
                        className="task-title"
                        onClick={() => setModal({ type: 'task', task: t })}
                      >
                        <strong>{t.title}</strong>
                        <span>
                          #{t.id}
                          {t.status === 'in_progress' && <em>Em andamento</em>}
                          {t.trashedAt && (
                            <em>{t.trashReason === 'completed' ? 'Concluída' : 'Descartada'}</em>
                          )}
                          {t.description && (
                            <span className="description-preview">{t.description}</span>
                          )}
                        </span>
                      </button>
                    </div>
                    <span className="task-group">
                      <span
                        className={`group-dot color-${
                          Math.max(
                            0,
                            groups.findIndex((g) => g.id === t.groupId),
                          ) % 5
                        }`}
                      />
                      {groups.find((g) => g.id === t.groupId)?.name ?? 'Caixa de entrada'}
                    </span>
                    <span
                      className={`task-due ${!isTrash && overdue(t) ? 'late' : ''} ${t.dueDate === today() && !isTrash ? 'due-today' : ''}`}
                    >
                      {isTrash ? (
                        timestamp(t.purgeAt!)
                      ) : (
                        <>
                          <Clock3 size={13} />
                          {due(t)}
                        </>
                      )}
                    </span>
                    <span className={`priority priority-${t.priority}`}>
                      <i />
                      {priorityLabels[t.priority]}
                    </span>
                    {isTrash ? (
                      <button
                        className="icon-button"
                        title="Restaurar"
                        aria-label={`Restaurar ${t.title}`}
                        disabled={busy}
                        onClick={() =>
                          void action(
                            [{ op: 'restore_task', task: `#${t.id}`, expectedVersion: t.version }],
                            false,
                          )
                        }
                      >
                        <RotateCcw size={17} />
                      </button>
                    ) : (
                      <button
                        className="icon-button"
                        aria-label={`Editar ${t.title}`}
                        onClick={() => setModal({ type: 'task', task: t })}
                      >
                        <MoreHorizontal size={19} />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <span className="empty-icon">
                    {isTrash ? (
                      <CheckCheck size={31} />
                    ) : search || priority || status ? (
                      <Search size={30} />
                    ) : (
                      <Inbox size={31} />
                    )}
                  </span>
                  <h3>
                    {search || priority || status
                      ? 'Nenhuma tarefa por aqui'
                      : isTrash
                        ? 'Tudo em seu lugar'
                        : view === 'today'
                          ? 'Seu dia está em aberto'
                          : view === 'overdue'
                            ? 'Nenhuma tarefa atrasada'
                            : 'Abra espaço para o próximo passo'}
                  </h3>
                  <p>
                    {search || priority || status
                      ? 'Tente outra busca ou ajuste os filtros.'
                      : isTrash
                        ? 'Tarefas concluídas ou descartadas aparecerão aqui.'
                        : 'Anote uma tarefa pequena. O resto vem no seu ritmo.'}
                  </p>
                  {!isTrash && (
                    <button className="button secondary" onClick={() => setModal({ type: 'task' })}>
                      <Plus size={16} />
                      Adicionar tarefa
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="list-footer">
              <span>
                {filtered.length
                  ? `${(currentPage - 1) * 20 + 1}–${Math.min(currentPage * 20, filtered.length)} de ${filtered.length} tarefas`
                  : 'Nenhuma tarefa nesta visualização'}
              </span>
              <div className="pagination">
                <button
                  className="icon-button tiny"
                  aria-label="Página anterior"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ArrowLeft size={15} />
                </button>
                <span>
                  {currentPage} / {pages}
                </span>
                <button
                  className="icon-button tiny"
                  aria-label="Próxima página"
                  disabled={currentPage >= pages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          </section>
          <section className="conversation-banner">
            <span className="banner-icon">
              <MessageCircle size={25} />
            </span>
            <div>
              <h3>Uma conversa também organiza.</h3>
              <p>Experimente criar e consultar tarefas por mensagem, direto daqui.</p>
            </div>
            <button className="button secondary" onClick={() => setModal({ type: 'chat' })}>
              Testar conversa
              <ArrowRight size={16} />
            </button>
          </section>
          <footer className="page-footer">
            <span>
              <span className="footer-dot" />
              Seu espaço, no seu ritmo.
            </span>
            <button className="text-button" onClick={() => setModal({ type: 'activity' })}>
              Atividade{issueCount > 0 && <span className="count-pill">{issueCount}</span>}
              <ChevronRight size={14} />
            </button>
          </footer>
        </main>
      </div>
      {notice && (
        <div
          className={`toast ${notice.error ? 'error' : ''}`}
          role={notice.error ? 'alert' : 'status'}
        >
          <span>{notice.error ? <Circle size={18} /> : <Check size={18} />}</span>
          <p>{notice.text}</p>
          <button
            className="icon-button tiny"
            aria-label="Dispensar aviso"
            onClick={() => setNotice(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal?.type === 'task' && (
        <TaskDialog
          task={modal.task}
          groups={groups}
          defaultGroup={group?.id}
          history={(data?.history ?? []).filter((h) => h.taskId === modal.task?.id)}
          busy={busy}
          close={() => setModal(null)}
          action={action}
        />
      )}
      {modal?.type === 'group' && (
        <GroupDialog group={modal.group} busy={busy} close={() => setModal(null)} action={action} />
      )}
      {modal?.type === 'settings' && (
        <SettingsDialog data={data} busy={busy} close={() => setModal(null)} action={action} />
      )}
      {modal?.type === 'chat' && (
        <ChatDialog data={data} close={() => setModal(null)} refresh={refresh} />
      )}
      {modal?.type === 'activity' && (
        <ActivityDialog
          data={data}
          connection={connection}
          close={() => setModal(null)}
          refresh={refresh}
        />
      )}
    </div>
  );
}

type Action = (commands: Command[], close?: boolean) => Promise<boolean>;
function TaskDialog({
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
                        : h.source === 'simulator'
                          ? 'Conversa de teste'
                          : 'WhatsApp'}
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
function GroupDialog({
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
function SettingsDialog({
  data,
  busy,
  close,
  action,
}: {
  data: Data | null;
  busy: boolean;
  close: () => void;
  action: Action;
}) {
  const [days, setDays] = useState(data?.settings.retentionDays ?? 30);
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
          A limpeza ocorre na próxima execução da rotina automática.
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
            <strong>
              {data?.llm === 'none'
                ? 'Comandos básicos'
                : data?.llm === 'gemini'
                  ? 'Gemini'
                  : 'IA configurada'}
            </strong>
          </span>
        </div>
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
function ChatDialog({
  data,
  close,
  refresh,
}: {
  data: Data | null;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const messages = [...(data?.messages.filter((m) => m.channel === 'simulator') ?? [])].reverse();
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, busy]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ error?: string }>('simulate', { text, requestId: crypto.randomUUID() });
      setText('');
      if (r.error) setError(r.error);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Converse com sua agenda"
      subtitle="Teste por aqui antes de conectar o WhatsApp."
      close={close}
      wide
    >
      <div className="chat-note">
        <MessageCircle size={16} />
        Os comandos alteram suas tarefas reais.{' '}
        {data?.llm === 'none' && 'A interpretação está no modo básico, sem IA.'}
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
              {['Anota: comprar pilhas', 'Quais tarefas existem?', 'Ajuda'].map((example) => (
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
                {m.reply}
              </div>
            ) : (
              <div className="bubble assistant muted">
                {m.error ?? statusLabels[m.status] ?? 'Aguardando processamento'}
                {m.status === 'failed' && (
                  <button
                    className="text-button"
                    onClick={async () => {
                      try {
                        await api('retry', { id: m.id, kind: 'message' });
                        await refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Tentar novamente
                  </button>
                )}
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
      <p className="chat-footer">
        Somente texto · Sem áudio, lembretes ou recorrência nesta versão.
      </p>
    </Dialog>
  );
}
function ActivityDialog({
  data,
  connection,
  close,
  refresh,
}: {
  data: Data | null;
  connection: string;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function retryItem(id: string, kind: 'message' | 'delivery', uncertain: boolean) {
    if (
      uncertain &&
      !window.confirm(
        'Confira o WhatsApp: essa resposta pode já ter sido entregue. Reenviar pode duplicar a mensagem. Deseja reenviar?',
      )
    )
      return;
    setBusy(true);
    try {
      await api('retry', { id, kind, confirmUncertain: uncertain });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Atividade e conexão"
      subtitle="Acompanhe os pedidos e as respostas da sua agenda."
      close={close}
      wide
    >
      <div className="activity-content">
        <div className="activity-connection">
          <MessageCircle size={23} />
          <div>
            <strong>WhatsApp · {connection}</strong>
            <p>
              {data?.settings.whatsappUpdatedAt
                ? `Último evento: ${timestamp(data.settings.whatsappUpdatedAt)}`
                : 'Use a conversa de teste enquanto o número não está conectado.'}
            </p>
            {data?.settings.whatsappStatus === 'SCAN_QR_CODE' && (
              <p>Leia o QR no painel administrativo do WAHA para conectar a sessão.</p>
            )}
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="activity-heading">
          <h3>Pedidos recentes</h3>
          <button className="text-button" onClick={() => void refresh()}>
            <RefreshCw size={15} />
            Atualizar
          </button>
        </div>
        {!data?.messages.length && (
          <p className="muted">Os pedidos aparecerão aqui conforme você usar a agenda.</p>
        )}
        {data?.messages.map((m) => (
          <div className="activity-item" key={m.id}>
            <span className={`activity-dot ${m.status === 'failed' ? 'failed' : ''}`} />
            <div>
              <strong>
                {m.body ||
                  (m.channel === 'panel' ? 'Alteração pelo painel' : 'Mensagem processada')}
              </strong>
              <p>
                {statusLabels[m.status] ?? m.status} · {timestamp(m.created_at)}
              </p>
              {m.error && <p className="form-error">{m.error}</p>}
              {m.status === 'clarification' && <p>{m.reply}</p>}
            </div>
            {m.status === 'failed' && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void retryItem(m.id, 'message', false)}
              >
                Tentar de novo
              </button>
            )}
          </div>
        ))}
        {Boolean(data?.deliveries.length) && (
          <>
            <h3 className="delivery-title">Respostas a entregar</h3>
            {data?.deliveries.map((d) => (
              <div className="activity-item" key={d.id}>
                <div>
                  <strong>{statusLabels[d.status] ?? d.status}</strong>
                  <p>{d.error ?? 'Aguardando a próxima execução da automação.'}</p>
                </div>
                {['failed', 'uncertain'].includes(d.status) && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void retryItem(d.id, 'delivery', d.status === 'uncertain')}
                  >
                    Reenviar
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </Dialog>
  );
}
