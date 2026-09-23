'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import type { NoteFile, NotesPage, NoteWithFiles } from '@/backend/notes/types';
import { api } from './api';
import { timestamp } from './format';
import { Dialog } from './Dialog';

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function Notes({ offline }: { offline: boolean }) {
  const [list, setList] = useState<NotesPage | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<NoteWithFiles | 'new' | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    if (offline || !navigator.onLine) {
      setList(null);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search.trim()) params.set('search', search.trim());
      const result = await api<NotesPage>(`notes?${params}`);
      if (current === generation.current) {
        setList(result);
        setError('');
      }
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [offline, page, search]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);
  if (offline)
    return (
      <section className="notes-view">
        <h1>Anotações</h1>
        <p role="status">
          Conecte-se para ler ou escrever suas anotações. Elas não ficam disponíveis offline.
        </p>
      </section>
    );
  return (
    <section className="notes-view" aria-label="Anotações">
      <div className="page-heading">
        <div>
          <h1>Anotações</h1>
          <p>Textos soltos e arquivos, sem prazo nem cobrança.</p>
        </div>
        <div className="heading-actions">
          <button className="button secondary" disabled={loading} onClick={() => void load()}>
            Atualizar anotações
          </button>
          <button className="button primary" onClick={() => setOpen('new')}>
            Nova anotação
          </button>
        </div>
      </div>
      <label className="notes-search">
        Buscar nas anotações
        <input
          value={search}
          placeholder="Título ou trecho do texto"
          maxLength={200}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Atualizando anotações…</p>}
      {list && !list.notes.length && (
        <p>Nenhuma anotação{search.trim() ? ' para essa busca' : ' ainda'}.</p>
      )}
      <div className="notes-list">
        {list?.notes.map((note) => (
          <button
            className="note-card"
            key={note.id}
            onClick={async () => {
              try {
                setOpen(await api<NoteWithFiles>(`notes/note?note=${note.id}`));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <strong>{note.title}</strong>
            <span>{note.body.slice(0, 160) || 'Sem texto'}</span>
            <small>
              Atualizada em {timestamp(note.updatedAt)}
              {note.fileCount ? ` · ${note.fileCount} arquivo(s)` : ''}
            </small>
          </button>
        ))}
      </div>
      {list && list.total > 20 && (
        <div className="finance-pagination">
          <button
            className="button secondary"
            disabled={page === 1 || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </button>
          <span>
            Página {page} · {list.total} anotação(ões)
          </span>
          <button
            className="button secondary"
            disabled={page * 20 >= list.total || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </button>
        </div>
      )}
      {open && (
        <NoteEditor
          note={open === 'new' ? undefined : open}
          // Anexos são gravados na hora: fechar sem salvar o texto ainda precisa atualizar a
          // lista, senão a contagem de arquivos do cartão fica velha.
          close={() => {
            setOpen(null);
            void load();
          }}
          // Anotação nova continua aberta depois de salva, senão não haveria como anexar um
          // arquivo sem reabrir o que acabou de ser criado.
          saved={(note, isNew) => {
            setOpen(isNew ? note : null);
            void load();
          }}
          done={() => {
            setOpen(null);
            void load();
          }}
          reload={async (id) => setOpen(await api<NoteWithFiles>(`notes/note?note=${id}`))}
        />
      )}
    </section>
  );
}

function NoteEditor({
  note,
  close,
  saved,
  done,
  reload,
}: {
  note?: NoteWithFiles;
  close: () => void;
  saved: (note: NoteWithFiles, isNew: boolean) => void;
  done: () => void;
  reload: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (file.size > MAX_FILE_BYTES) throw new Error('Cada arquivo pode ter até 3 MB.');
    const buffer = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buffer.length; i += 8192)
      binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
    await api('notes/file', {
      note: note!.id,
      name: file.name,
      type: file.type || 'application/octet-stream',
      content: btoa(binary),
    });
    await reload(note!.id);
    setNotice(`${file.name} anexado.`);
  }
  async function download(file: NoteFile) {
    const saved = await api<NoteFile & { content: string }>(`notes/file?file=${file.id}`);
    const bytes = Uint8Array.from(atob(saved.content), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: saved.type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = saved.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Dialog
      title={note ? 'Anotação' : 'Nova anotação'}
      subtitle="O texto é salvo no botão abaixo. Anexos são enviados na hora."
      close={close}
      wide
    >
      <form
        className="editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const result = await api<NoteWithFiles>('notes', {
              ...(note ? { id: note.id, expectedVersion: note.version } : {}),
              title,
              body,
            });
            if (!note) setNotice('Anotação criada. Agora dá para anexar arquivos.');
            saved(result, !note);
          });
        }}
      >
        <fieldset disabled={busy}>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <label htmlFor="note-title">Título</label>
          <input
            id="note-title"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label htmlFor="note-body">Texto</label>
          <textarea
            id="note-body"
            rows={12}
            maxLength={20000}
            placeholder="Escreva o que quiser guardar."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <small>{body.length}/20.000 caracteres</small>
          {note ? (
            <section className="note-files">
              <h3>
                <Paperclip size={15} /> Arquivos
              </h3>
              {!note.files.length && <p>Nenhum arquivo anexado.</p>}
              {note.files.map((file) => (
                <div className="note-file-row" key={file.id}>
                  <span>
                    {file.name} · {size(file.size)}
                  </span>
                  <div className="finance-row-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void run(() => download(file))}
                    >
                      Baixar
                    </button>
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() =>
                        void run(async () => {
                          if (!window.confirm(`Remover ${file.name}?`)) return;
                          await api('notes/file/delete', { file: file.id });
                          await reload(note.id);
                        })
                      }
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
              <label htmlFor="note-file">Anexar arquivo (até 3 MB, 10 por anotação)</label>
              <input
                id="note-file"
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void run(() => upload(file));
                }}
              />
            </section>
          ) : (
            <p className="field-help">Salve a anotação para poder anexar arquivos.</p>
          )}
          <div className="dialog-actions">
            {note && (
              <button
                type="button"
                className="button danger"
                onClick={() =>
                  void run(async () => {
                    if (!window.confirm(`Excluir ${note.title} e seus arquivos?`)) return;
                    await api('notes/delete', { note: note.id });
                    done();
                  })
                }
              >
                Excluir anotação
              </button>
            )}
            <button type="button" className="button secondary" onClick={close}>
              Fechar sem salvar
            </button>
            <button className="button primary">Salvar anotação</button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
