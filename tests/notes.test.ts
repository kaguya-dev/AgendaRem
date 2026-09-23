import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase, type Database } from '../src/backend/db';
import {
  addNoteFile,
  deleteNote,
  deleteNoteFile,
  listNotes,
  readNote,
  readNoteFile,
  saveNote,
} from '../src/backend/notes/store';
import { MAX_FILE_BYTES, MAX_FILES_PER_NOTE } from '../src/backend/notes/types';

let db: Database;
before(async () => {
  db = await createDatabase();
});
after(async () => {
  await db.close();
});
const attach = (note: string, name: string, bytes: Buffer) =>
  addNoteFile({ note, name, type: 'text/plain', content: bytes.toString('base64') }, db);

test('anotação guarda título e texto, aparece na busca e recusa edição concorrente', async () => {
  const note = await saveNote({ title: 'Ideias de viagem', body: 'Passagem e hospedagem' }, db);
  assert.equal(note.version, 1);
  assert.deepEqual(note.files, []);
  const updated = await saveNote(
    {
      id: note.id,
      title: 'Ideias de viagem',
      body: 'Passagem, hospedagem e seguro',
      expectedVersion: note.version,
    },
    db,
  );
  assert.equal(updated.version, 2);
  await assert.rejects(
    saveNote({ id: note.id, title: 'Outra', body: '', expectedVersion: 1 }, db),
    /alterada/,
  );
  // Busca alcança o corpo do texto, não só o título.
  assert.equal((await listNotes({ search: 'seguro' }, db)).total, 1);
  assert.equal((await listNotes({ search: 'nada disso' }, db)).total, 0);
  assert.equal((await listNotes({}, db)).notes[0].fileCount, 0);
  await assert.rejects(saveNote({ title: '', body: '' }, db));
  await assert.rejects(
    saveNote({ id: randomUUID(), title: 'Fantasma', body: '' }, db),
    /não encontrada/,
  );
});

test('anexos entram e saem inteiros, respeitam limites e somem junto com a anotação', async () => {
  const note = await saveNote({ title: 'Documentos', body: '' }, db);
  const content = Buffer.from('conteúdo de teste com acento e ção');
  const file = await attach(note.id, 'recibo.txt', content);
  assert.equal(file.size, content.length);
  const saved = await readNoteFile({ file: file.id }, db);
  assert.equal(Buffer.from(saved.content, 'base64').toString(), content.toString());
  assert.equal((await readNote({ note: note.id }, db)).files.length, 1);
  assert.equal((await listNotes({ search: 'Documentos' }, db)).notes[0].fileCount, 1);

  await assert.rejects(attach(note.id, 'grande.bin', Buffer.alloc(MAX_FILE_BYTES + 1)), /5 MB/);
  await assert.rejects(attach(randomUUID(), 'orfao.txt', content), /não encontrada/);
  await assert.rejects(
    addNoteFile({ note: note.id, name: 'x', type: 'texto', content: 'AAA' }, db),
    /inválido/,
  );
  for (let i = 1; i < MAX_FILES_PER_NOTE; i++) await attach(note.id, `extra-${i}.txt`, content);
  await assert.rejects(attach(note.id, 'passou.txt', content), /até 10 arquivos/);

  await deleteNoteFile({ file: file.id }, db);
  assert.equal((await readNote({ note: note.id }, db)).files.length, MAX_FILES_PER_NOTE - 1);
  await assert.rejects(readNoteFile({ file: file.id }, db), /não encontrado/);

  await deleteNote({ note: note.id }, db);
  await assert.rejects(readNote({ note: note.id }, db), /não encontrada/);
  const left = await db.query<{ count: string }>('SELECT count(*) FROM agenda_note_files');
  assert.equal(Number(left.rows[0].count), 0);
});

test('a lista é paginada e a mais recente vem primeiro', async () => {
  for (let i = 0; i < 22; i++) await saveNote({ title: `Nota ${i}`, body: `corpo ${i}` }, db);
  const first = await listNotes({}, db);
  assert.equal(first.notes.length, 20);
  assert.equal(first.total, 23);
  assert.equal(first.notes[0].title, 'Nota 21');
  assert.equal((await listNotes({ page: 2 }, db)).notes.length, 3);
});
