import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db, type Database } from '../db';
import { DomainError, localDate } from '../domain';
import type { PublicLlmProvider, SaveLlmProviderInput } from '../llm-types';
import { encryptKey } from './crypto';
import { validateApiUrl } from './ssrf';

export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const configurationSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(['gemini', 'compatible']),
    model: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[a-zA-Z0-9_.:/-]+$/),
    apiUrl: z.string().trim().max(2048),
    priority: z.number().int().min(0).max(1000),
    enabled: z.boolean(),
    dailyRequestLimit: z.number().int().min(1).max(100000),
    dailyTokenLimit: z.number().int().min(0).max(1000000000),
    apiKey: z
      .string()
      .trim()
      .max(4096)
      .refine((value) => !/[\x00-\x20\x7f]/.test(value))
      .optional(),
  })
  .strict();
export type Config = Omit<SaveLlmProviderInput, 'id' | 'apiKey'>;
export interface ProviderRow {
  id: string;
  config: Config;
  encrypted_key: string;
  cooldown_until: Date | string | null;
  last_error: string | null;
}

const toIso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);
export async function listProviders(
  database?: Database,
): Promise<{ providers: PublicLlmProvider[] }> {
  database ??= await db();
  const { rows } = await database.query<
    Omit<ProviderRow, 'encrypted_key'> & {
      key_set: boolean;
      requests: number;
      tokens: string;
      reported_tokens: string;
      estimated_tokens: string;
      unconfirmed_requests: number;
    }
  >(
    `SELECT p.id,p.config,p.cooldown_until,p.last_error,(p.encrypted_key <> '') AS key_set,
       COALESCE(u.requests,0) AS requests,COALESCE(u.tokens,0) AS tokens,
       COALESCE(u.reported_tokens,0) AS reported_tokens,
       COALESCE(u.estimated_tokens,0) AS estimated_tokens,
       COALESCE(u.unconfirmed_requests,0) AS unconfirmed_requests
     FROM agenda_llm_providers p LEFT JOIN agenda_llm_usage u ON u.provider_id=p.id AND u.day=$1
     ORDER BY (p.config->>'priority')::integer,p.created_at,p.id`,
    [localDate(new Date())],
  );
  return {
    providers: rows.map((row) => ({
      ...row.config,
      id: row.id,
      keySet: row.key_set,
      requestsToday: Number(row.requests),
      tokensToday: Number(row.tokens),
      reportedTokensToday: Number(row.reported_tokens),
      estimatedTokensToday: Number(row.estimated_tokens),
      legacyTokensToday: Math.max(
        0,
        Number(row.tokens) - Number(row.reported_tokens) - Number(row.estimated_tokens),
      ),
      unconfirmedRequestsToday: Number(row.unconfirmed_requests),
      cooldownUntil: toIso(row.cooldown_until),
      lastError: row.last_error,
    })),
  };
}
export async function saveProvider(input: unknown, database?: Database) {
  const parsed = configurationSchema.safeParse(input);
  if (!parsed.success)
    throw new DomainError(
      'Configuração de IA inválida. Confira nome, modelo, prioridade e limites.',
      400,
    );
  const { id: suppliedId, apiKey, ...config } = parsed.data;
  config.apiUrl = config.kind === 'gemini' ? GEMINI_URL : validateApiUrl(config.apiUrl).toString();
  const id = suppliedId ?? randomUUID();
  database ??= await db();
  await database.transaction(async (tx) => {
    // Serialize additions so the size limit also holds for concurrent saves.
    await tx.query('SELECT id FROM agenda_meta WHERE id=1 FOR UPDATE');
    const existing = (
      await tx.query<ProviderRow>('SELECT * FROM agenda_llm_providers WHERE id=$1 FOR UPDATE', [id])
    ).rows[0];
    if (suppliedId && !existing) throw new DomainError('Provedor de IA não encontrado.', 404);
    if (!existing && !apiKey)
      throw new DomainError('Informe a chave da API para cadastrar a IA.', 400);
    if (
      !existing &&
      Number(
        (await tx.query<{ count: string }>('SELECT count(*) FROM agenda_llm_providers')).rows[0]
          .count,
      ) >= 20
    )
      throw new DomainError('Cadastre no máximo 20 provedores de IA.', 400);
    const encrypted = apiKey ? encryptKey(apiKey, id) : existing.encrypted_key;
    await tx.query(
      `INSERT INTO agenda_llm_providers (id,config,encrypted_key) VALUES ($1,$2::jsonb,$3)
      ON CONFLICT(id) DO UPDATE SET config=excluded.config,encrypted_key=excluded.encrypted_key,
      cooldown_until=NULL,last_error=NULL`,
      [id, JSON.stringify(config), encrypted],
    );
  });
  return listProviders(database);
}
function validId(id: unknown): string {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) throw new DomainError('Identificador de IA inválido.', 400);
  return parsed.data;
}
export async function deleteProvider(id: unknown, database?: Database) {
  database ??= await db();
  const result = await database.query('DELETE FROM agenda_llm_providers WHERE id=$1 RETURNING id', [
    validId(id),
  ]);
  if (!result.rows.length) throw new DomainError('Provedor de IA não encontrado.', 404);
  return listProviders(database);
}
export async function resetProvider(id: unknown, database?: Database) {
  database ??= await db();
  const result = await database.query(
    'UPDATE agenda_llm_providers SET cooldown_until=NULL,last_error=NULL WHERE id=$1 RETURNING id',
    [validId(id)],
  );
  if (!result.rows.length) throw new DomainError('Provedor de IA não encontrado.', 404);
  return listProviders(database);
}
