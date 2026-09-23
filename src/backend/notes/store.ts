import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, lock, type Database, type Sql } from '../db';
import { DomainError } from '../domain';
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_NOTE,
  type Note,
  type NoteFile,
  type NotesPage,
  type NoteWithFiles,
} from './types';

const PAGE = 20;
const listSchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    note: z.string().uuid().optional(),
  })
  .strict();
const saveSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(20000).default(''),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();
// O conteúdo chega em base64 porque a rota é JSON como todas as outras. O limite abaixo é do
// arquivo original; o corpo da requisição é barrado antes disso, na leitura.
const uploadSchema = z
  .object({
    note: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    type: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[\w.+-]+\/[\w.+-]+$/, 'Tipo de arquivo inválido.'),
    content: z.string().min(1),
  })
  .strict();

async function files(sql: Sql, noteId: string) {
  return (
    await sql.query<{ data: NoteFile }>(
      "SELECT data FROM agenda_note_files WHERE note_id=$1 ORDER BY data->>'createdAt', id",
      [noteId],
    )
  ).rows.map((r) => r.data);
}

export async function listNotes(input: unknown, connection?: Database): Promise<NotesPage> {
  const q = listSchema.parse(input);
  const database = connection ?? (await db());
  // % e _ são curingas do LIKE: sem escapar, buscar "%" devolvia todas as anotações e "100%"
  // casava com qualquer coisa depois do 100.
  const search = q.search ? `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const where = `($1::text IS NULL OR data->>'title' ILIKE $1 ESCAPE '\\' OR data->>'body' ILIKE $1 ESCAPE '\\')`;
  const rows = (
    await database.query<{ data: Note; files: string }>(
      `SELECT n.data, (SELECT count(*) FROM agenda_note_files f WHERE f.note_id=n.id) AS files
       FROM agenda_notes n WHERE ${where}
       ORDER BY n.data->>'updatedAt' DESC, n.id DESC LIMIT ${PAGE} OFFSET $2`,
      [search, (q.page - 1) * PAGE],
    )
  ).rows;
  const total = Number(
    (
      await database.query<{ count: string }>(`SELECT count(*) FROM agenda_notes WHERE ${where}`, [
        search,
      ])
    ).rows[0].count,
  );
  return {
    notes: rows.map((r) => ({ ...r.data, fileCount: Number(r.files) })),
    total,
    page: q.page,
  };
}

export async function readNote(input: unknown, connection?: Database): Promise<NoteWithFiles> {
  const q = listSchema.parse(input);
  if (!q.note) throw new DomainError('Informe a anotação.');
  const database = connection ?? (await db());
  const note = (
    await database.query<{ data: Note }>('SELECT data FROM agenda_notes WHERE id=$1', [q.note])
  ).rows[0]?.data;
  if (!note) throw new DomainError('Anotação não encontrada.', 404);
  return { ...note, files: await files(database, note.id) };
}

export async function saveNote(input: unknown, connection?: Database): Promise<NoteWithFiles> {
  const value = saveSchema.parse(input);
  const database = connection ?? (await db());
  const at = new Date().toISOString();
  return database.transaction(async (tx) => {
    await lock(tx);
    if (!value.id) {
      const note: Note = {
        id: randomUUID(),
        title: value.title,
        body: value.body,
        version: 1,
        createdAt: at,
        updatedAt: at,
      };
      await tx.query('INSERT INTO agenda_notes(id,data) VALUES($1,$2::jsonb)', [
        note.id,
        JSON.stringify(note),
      ]);
      return { ...note, files: [] };
    }
    const current = (
      await tx.query<{ data: Note }>('SELECT data FROM agenda_notes WHERE id=$1', [value.id])
    ).rows[0]?.data;
    if (!current) throw new DomainError('Anotação não encontrada.', 404);
    if (value.expectedVersion !== undefined && value.expectedVersion !== current.version)
      throw new DomainError(
        'Esta anotação foi alterada em outro lugar. Atualize antes de salvar.',
        409,
      );
    const note: Note = {
      ...current,
      title: value.title,
      body: value.body,
      version: current.version + 1,
      updatedAt: at,
    };
    await tx.query('UPDATE agenda_notes SET data=$2::jsonb WHERE id=$1', [
      note.id,
      JSON.stringify(note),
    ]);
    return { ...note, files: await files(tx, note.id) };
  });
}

export async function deleteNote(input: unknown, connection?: Database) {
  const { note } = z.object({ note: z.string().uuid() }).strict().parse(input);
  const database = connection ?? (await db());
  return database.transaction(async (tx) => {
    await lock(tx);
    const removed = await tx.query('DELETE FROM agenda_notes WHERE id=$1 RETURNING id', [note]);
    if (!removed.rows.length) throw new DomainError('Anotação não encontrada.', 404);
    await tx.query('DELETE FROM agenda_note_files WHERE note_id=$1', [note]);
    return { ok: true };
  });
}

export async function addNoteFile(input: unknown, connection?: Database): Promise<NoteFile> {
  const value = uploadSchema.parse(input);
  const content = Buffer.from(value.content, 'base64');
  if (!content.length) throw new DomainError('Arquivo vazio.');
  if (content.length > MAX_FILE_BYTES) throw new DomainError('Cada arquivo pode ter até 3 MB.');
  const database = connection ?? (await db());
  return database.transaction(async (tx) => {
    await lock(tx);
    const exists = await tx.query('SELECT 1 FROM agenda_notes WHERE id=$1', [value.note]);
    if (!exists.rows.length) throw new DomainError('Anotação não encontrada.', 404);
    const count = Number(
      (
        await tx.query<{ count: string }>(
          'SELECT count(*) FROM agenda_note_files WHERE note_id=$1',
          [value.note],
        )
      ).rows[0].count,
    );
    if (count >= MAX_FILES_PER_NOTE)
      throw new DomainError(`Cada anotação aceita até ${MAX_FILES_PER_NOTE} arquivos.`);
    const file: NoteFile = {
      id: randomUUID(),
      noteId: value.note,
      name: value.name,
      type: value.type,
      size: content.length,
      createdAt: new Date().toISOString(),
    };
    await tx.query(
      'INSERT INTO agenda_note_files(id,note_id,data,content) VALUES($1,$2,$3::jsonb,$4)',
      [file.id, file.noteId, JSON.stringify(file), content.toString('base64')],
    );
    return file;
  });
}

export async function readNoteFile(input: unknown, connection?: Database) {
  const { file } = z.object({ file: z.string().uuid() }).strict().parse(input);
  const database = connection ?? (await db());
  const row = (
    await database.query<{ data: NoteFile; content: string }>(
      'SELECT data,content FROM agenda_note_files WHERE id=$1',
      [file],
    )
  ).rows[0];
  if (!row) throw new DomainError('Arquivo não encontrado.', 404);
  return { ...row.data, content: row.content };
}

export async function deleteNoteFile(input: unknown, connection?: Database) {
  const { file } = z.object({ file: z.string().uuid() }).strict().parse(input);
  const database = connection ?? (await db());
  const removed = await database.query('DELETE FROM agenda_note_files WHERE id=$1 RETURNING id', [
    file,
  ]);
  if (!removed.rows.length) throw new DomainError('Arquivo não encontrado.', 404);
  return { ok: true };
}
