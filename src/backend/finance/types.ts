import { z } from 'zod';
import { dateSchema } from '../domain/types';
export const MAX_CENTS = 999_999_999_99;
export const categorySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    kind: z.enum(['income', 'expense', 'both']),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    archivedAt: z.string().datetime().nullable(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const entrySchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(['income', 'expense']),
    amountCents: z.number().int().positive().max(MAX_CENTS),
    date: dateSchema,
    description: z.string().trim().min(1).max(5000),
    categoryId: z.string().uuid(),
    source: z.enum(['panel', 'web']),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    deletedAt: z.string().datetime().nullable(),
  })
  .strict();
// Modelo de lançamento: o que se repete todo mês sem virar recorrência automática. Guarda o
// que não muda (tipo, valor, descrição, categoria) e nada de data — a data é escolhida na hora.
export const templateSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    kind: z.enum(['income', 'expense']),
    amountCents: z.number().int().positive().max(MAX_CENTS),
    description: z.string().trim().min(1).max(5000),
    categoryId: z.string().uuid(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type FinanceCategory = z.infer<typeof categorySchema>;
export type FinanceTemplate = z.infer<typeof templateSchema>;
export type FinanceEntry = z.infer<typeof entrySchema>;
export type FinanceState = {
  categories: FinanceCategory[];
  entries: FinanceEntry[];
  templates: FinanceTemplate[];
};
export type FinanceTotals = { income: number; expense: number; result: number };
export type FinanceData = {
  categories: FinanceCategory[];
  entries: FinanceEntry[];
  templates: FinanceTemplate[];
  total: number;
  page: number;
  totals: FinanceTotals;
  previous: FinanceTotals;
  byCategory: { id: string; name: string; income: number; expense: number }[];
  daily: { date: string; income: number; expense: number }[];
};
