import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { z } from 'zod';
import { db, type Database, type Sql } from './db';
import { commandsSchema, DomainError, localDate, type Command } from './domain';
import type { PublicLlmProvider, SaveLlmProviderInput } from './llm-types';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_ATTEMPTS = 4;
const MAX_OUTPUT_TOKENS = 2048;
const MAX_RESPONSE_BYTES = 1024 * 1024;
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
type Config = Omit<SaveLlmProviderInput, 'id' | 'apiKey'>;
interface ProviderRow {
  id: string;
  config: Config;
  encrypted_key: string;
  cooldown_until: Date | string | null;
  last_error: string | null;
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  blocked.addSubnet(address, prefix, 'ipv6');
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
export function validateApiUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DomainError('Informe uma URL HTTPS válida para a API.', 400);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443') ||
    !host ||
    (isIP(host)
      ? !isPublicAddress(host)
      : !host.includes('.') ||
        /(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(host) ||
        host.endsWith('.'))
  ) {
    throw new DomainError(
      'Use uma URL HTTPS pública, sem credenciais, parâmetros ou porta alternativa.',
      400,
    );
  }
  return url;
}
function encryptionKey(): Buffer {
  const value = process.env.LLM_ENCRYPTION_KEY ?? '';
  const key = /^[a-f\d]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : /^[A-Za-z0-9+/]{43}=$/.test(value)
      ? Buffer.from(value, 'base64')
      : Buffer.alloc(0);
  if (key.length !== 32)
    throw new DomainError(
      'Configure LLM_ENCRYPTION_KEY no servidor: 32 bytes em hexadecimal ou base64.',
      503,
    );
  return key;
}
function encryptKey(value: string, id: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(id));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}
function decryptKey(value: string, id: string): string {
  const key = encryptionKey();
  try {
    const [version, iv, tag, encrypted] = value.split('.');
    if (version !== 'v1') throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    cipher.setAAD(Buffer.from(id));
    cipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      cipher.update(Buffer.from(encrypted, 'base64')),
      cipher.final(),
    ]).toString('utf8');
  } catch {
    throw new DomainError(
      'Não foi possível abrir a chave da IA. Confira LLM_ENCRYPTION_KEY ou cadastre novamente a chave.',
      503,
    );
  }
}
const toIso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);
export async function listProviders(
  database?: Database,
): Promise<{ providers: PublicLlmProvider[] }> {
  database ??= await db();
  const { rows } = await database.query<
    Omit<ProviderRow, 'encrypted_key'> & { key_set: boolean; requests: number; tokens: string }
  >(
    `SELECT p.id,p.config,p.cooldown_until,p.last_error,(p.encrypted_key <> '') AS key_set,
       COALESCE(u.requests,0) AS requests,COALESCE(u.tokens,0) AS tokens
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

// DNS is checked inside the socket lookup and its validated address is pinned to that
// connection. Redirects are never followed; a second DNS lookup cannot rebind the host.
const secureFetch = (url: string, init: RequestInit): Promise<Response> =>
  new Promise((resolve, reject) => {
    validateApiUrl(url);
    const req = request(
      url,
      {
        method: 'POST',
        headers: init.headers as Record<string, string>,
        signal: init.signal ?? undefined,
        lookup: (hostname, options, callback) => {
          lookup(hostname, { all: true }).then(
            (addresses) => {
              if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) {
                callback(new Error('Endereço privado bloqueado.'), '', 4);
                return;
              }
              if (options.all) callback(null, addresses);
              else callback(null, addresses[0].address, addresses[0].family);
            },
            () => callback(new Error('Falha de DNS da API.'), '', 4),
          );
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) req.destroy(new Error('Resposta da IA excede o limite.'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers))
            if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
          const status = res.statusCode ?? 502;
          resolve(
            new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), {
              status,
              headers,
            }),
          );
        });
      },
    );
    req.on('error', reject);
    req.end(init.body);
  });

async function reserve(database: Database, id: string, day: string, estimate: number, now: Date) {
  return database.transaction(async (tx) => {
    const provider = (
      await tx.query<ProviderRow>('SELECT * FROM agenda_llm_providers WHERE id=$1 FOR UPDATE', [id])
    ).rows[0];
    if (
      !provider ||
      !provider.config.enabled ||
      (provider.cooldown_until && new Date(provider.cooldown_until) > now)
    )
      return null;
    await tx.query(
      'INSERT INTO agenda_llm_usage (provider_id,day) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [id, day],
    );
    await tx.query(
      'UPDATE agenda_llm_usage SET reserved_tokens=0 WHERE provider_id=$1 AND day=$2 AND reserved_until <= $3',
      [id, day, now.toISOString()],
    );
    const usage = (
      await tx.query<{ requests: number; tokens: string; reserved_tokens: string }>(
        'SELECT * FROM agenda_llm_usage WHERE provider_id=$1 AND day=$2 FOR UPDATE',
        [id, day],
      )
    ).rows[0];
    // Reservations prevent simultaneous requests from all spending the same remaining
    // token allowance. They are estimates; the final charge uses the API metadata.
    if (
      usage.requests >= provider.config.dailyRequestLimit ||
      (provider.config.dailyTokenLimit > 0 &&
        Number(usage.tokens) + Number(usage.reserved_tokens) >= provider.config.dailyTokenLimit)
    )
      return null;
    await tx.query(
      'UPDATE agenda_llm_usage SET requests=requests+1,reserved_tokens=reserved_tokens+$3,reserved_until=$4 WHERE provider_id=$1 AND day=$2',
      [id, day, estimate, new Date(now.getTime() + 120000).toISOString()],
    );
    return provider;
  });
}
async function settle(tx: Sql, id: string, day: string, estimate: number, tokens: number) {
  await tx.query(
    'UPDATE agenda_llm_usage SET reserved_tokens=GREATEST(0,reserved_tokens-$3),tokens=tokens+$4 WHERE provider_id=$1 AND day=$2',
    [id, day, estimate, tokens],
  );
}
async function markError(
  database: Database,
  id: string,
  message: string,
  milliseconds: number,
  now: Date,
) {
  await database.query(
    'UPDATE agenda_llm_providers SET last_error=$2,cooldown_until=$3 WHERE id=$1',
    [id, message, new Date(now.getTime() + milliseconds).toISOString()],
  );
}
function retryDelay(value: string | null, now: Date, fallback: number) {
  if (!value) return fallback;
  const numeric = /^\d+(?:\.\d+)?$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - now.getTime();
  return Number.isFinite(numeric) ? Math.max(1000, Math.min(86400000, numeric)) : fallback;
}
function tokenUsage(result: Record<string, any> | null, kind: Config['kind'], estimate: number) {
  const value =
    kind === 'gemini' ? result?.usageMetadata?.totalTokenCount : result?.usage?.total_tokens;
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 1000000000
    ? value
    : estimate;
}
export interface LlmRequestOptions {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  now?: Date;
}
export async function generateCommands(
  system: string,
  text: string,
  database: Database,
  options: LlmRequestOptions = {},
): Promise<Command[] | null> {
  const now = options.now ?? new Date();
  const day = localDate(now);
  const candidates = (
    await database.query<{
      id: string;
    }>(`SELECT id FROM agenda_llm_providers WHERE (config->>'enabled')::boolean
    ORDER BY (config->>'priority')::integer,created_at,id`)
  ).rows;
  if (!candidates.length) return null;
  // Check encryption once, so an invalid server secret isn't mistaken for quota exhaustion.
  encryptionKey();
  const estimate = Buffer.byteLength(system + text, 'utf8') + MAX_OUTPUT_TOKENS;
  const deadline = Date.now() + 85000;
  let attempts = 0;
  for (const candidate of candidates) {
    if (attempts >= MAX_ATTEMPTS || Date.now() >= deadline) break;
    const provider = await reserve(database, candidate.id, day, estimate, now);
    if (!provider) continue;
    attempts++;
    let response: Response;
    try {
      const apiKey = decryptKey(provider.encrypted_key, provider.id);
      const { config } = provider;
      const url =
        config.kind === 'gemini'
          ? `${GEMINI_URL}/${encodeURIComponent(config.model.replace(/^models\//, ''))}:generateContent`
          : config.apiUrl;
      validateApiUrl(url);
      const body =
        config.kind === 'gemini'
          ? {
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: 'user', parts: [{ text }] }],
              generationConfig: {
                temperature: 0,
                responseMimeType: 'application/json',
                maxOutputTokens: MAX_OUTPUT_TOKENS,
              },
            }
          : {
              model: config.model,
              temperature: 0,
              max_tokens: MAX_OUTPUT_TOKENS,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: text },
              ],
            };
      response = await (options.fetch ?? secureFetch)(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(config.kind === 'gemini'
            ? { 'x-goog-api-key': apiKey }
            : { Authorization: `Bearer ${apiKey}` }),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(1, Math.min(20000, deadline - Date.now()))),
      });
    } catch (error) {
      await settle(
        database,
        provider.id,
        day,
        estimate,
        error instanceof DomainError ? 0 : estimate,
      );
      if (error instanceof DomainError) throw error;
      await markError(
        database,
        provider.id,
        'Falha de conexão ou tempo esgotado na API.',
        60000,
        now,
      );
      continue;
    }
    if (!response.ok) {
      await settle(database, provider.id, day, estimate, 0);
      const status = response.status;
      const message =
        status === 429
          ? 'Limite de requisições ou tokens atingido na API.'
          : status === 402
            ? 'Créditos esgotados na API.'
            : status === 401 || status === 403
              ? 'Chave inválida ou sem permissão. Confira a credencial e o modelo.'
              : status >= 500 || status === 408
                ? 'API temporariamente indisponível.'
                : 'A API recusou a configuração. Confira modelo e URL.';
      const fallback =
        status === 401 || status === 403 || status === 402
          ? 86400000
          : status === 429
            ? 3600000
            : 60000;
      await markError(
        database,
        provider.id,
        message,
        retryDelay(response.headers.get('retry-after'), now, fallback),
        now,
      );
      continue;
    }
    let result: Record<string, any> | null;
    try {
      result = await response.json();
    } catch {
      result = null;
    }
    // Accounting errors must propagate as database failures, never as invalid model
    // output, and must not trigger a second charge of the same request.
    await settle(
      database,
      provider.id,
      day,
      estimate,
      tokenUsage(result, provider.config.kind, estimate),
    );
    let parsed: Command[];
    try {
      const output =
        provider.config.kind === 'gemini'
          ? result?.candidates?.[0]?.content?.parts
              ?.filter((part: { thought?: boolean }) => !part.thought)
              .map((part: { text?: string }) => part.text ?? '')
              .join('')
          : result?.choices?.[0]?.message?.content;
      if (typeof output !== 'string') throw new Error();
      parsed = commandsSchema.parse(JSON.parse(output).commands);
    } catch {
      await markError(
        database,
        provider.id,
        'A IA retornou comandos em formato inválido.',
        60000,
        now,
      );
      // Trying a different model here could change the interpretation of a destructive
      // request. Nothing is executed unless a single response validates completely.
      throw new DomainError(
        'A IA retornou um formato inválido. Nenhuma alteração foi feita; reformule o pedido.',
        422,
      );
    }
    await database.query(
      'UPDATE agenda_llm_providers SET last_error=NULL,cooldown_until=NULL WHERE id=$1',
      [provider.id],
    );
    return parsed;
  }
  throw new DomainError(
    'As IAs configuradas estão sem cota ou indisponíveis. Nenhuma alteração foi feita. Confira as IAs em Configurações ou use os comandos básicos.',
    503,
  );
}
