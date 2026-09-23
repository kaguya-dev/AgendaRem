import { z } from 'zod';

// Anotação solta: um título e um texto longo, sem prazo, grupo ou status. O que precisa de
// cobrança vira tarefa; aqui fica o que só precisa ser guardado e reencontrado.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_NOTE = 10;
export const noteSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(20000),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const noteFileSchema = z
  .object({
    id: z.string().uuid(),
    noteId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    type: z.string().trim().min(1).max(120),
    size: z.number().int().positive().max(MAX_FILE_BYTES),
    createdAt: z.string().datetime(),
  })
  .strict();
export type Note = z.infer<typeof noteSchema>;
export type NoteFile = z.infer<typeof noteFileSchema>;
export type NoteWithFiles = Note & { files: NoteFile[] };
export type NotesPage = { notes: (Note & { fileCount: number })[]; total: number; page: number };
