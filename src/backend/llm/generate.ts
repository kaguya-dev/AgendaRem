import type { z } from 'zod';
import { type Database } from '../db';
import { commandsSchema, DomainError, localDate, type Command } from '../domain';
import { decryptKey, encryptionKey } from './crypto';
import { GEMINI_URL, type ProviderRow } from './providers';
import {
  estimateTokens,
  markError,
  pauseReason,
  reserve,
  retryDelay,
  settle,
  tokenUsage,
} from './usage';
import { secureFetch, validateApiUrl } from './ssrf';

const MAX_ATTEMPTS = 4;
const MAX_OUTPUT_TOKENS = 2048;

// Names the field and the kind of problem, so a rejected answer can be diagnosed from the panel.
// Uses only the issue's structure, never its message: zod quotes the offending value, and that
// value comes from the model, which may be repeating the person's own text.
function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => {
      const [index, ...rest] = issue.path;
      const where = typeof index === 'number' ? `ação ${index + 1}` : 'lista de ações';
      const field = rest.length ? `, campo ${rest.join('.')}` : '';
      const keys = (issue as { keys?: string[] }).keys;
      if (issue.code === 'unrecognized_keys')
        return `${where}: campo não previsto ${keys?.join(', ')}`;
      if (issue.code === 'invalid_value') return `${where}${field}: valor fora dos aceitos`;
      if (issue.code === 'invalid_type') return `${where}${field}: faltando ou de tipo errado`;
      if (issue.code === 'too_big' || issue.code === 'too_small')
        return `${where}${field}: fora do tamanho permitido`;
      return `${where}${field}: ${issue.code}`;
    })
    .join('; ');
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
  const started = Date.now();
  const clock = () => new Date(now.getTime() + Date.now() - started);
  const candidates = (
    await database.query<{
      id: string;
      name: string;
    }>(`SELECT id,config->>'name' AS name FROM agenda_llm_providers WHERE (config->>'enabled')::boolean
    ORDER BY (config->>'priority')::integer,created_at,id`)
  ).rows;
  if (!candidates.length) return null;
  // Check encryption once, so an invalid server secret isn't mistaken for quota exhaustion.
  encryptionKey();
  const estimate = estimateTokens(system + text) + MAX_OUTPUT_TOKENS;
  const deadline = Date.now() + 85000;
  let attempts = 0;
  const failures: string[] = [];
  let stoppedEarly = false;
  for (const candidate of candidates) {
    if (attempts >= MAX_ATTEMPTS || Date.now() >= deadline) {
      stoppedEarly = true;
      break;
    }
    const day = localDate(clock());
    const reservation = await reserve(database, candidate.id, day, estimate, clock());
    if (!reservation.provider) {
      failures.push(`${candidate.name}: ${reservation.reason}`);
      continue;
    }
    const provider = reservation.provider;
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
        signal: AbortSignal.timeout(Math.max(1, Math.min(45000, deadline - Date.now()))),
      });
    } catch (error) {
      await settle(database, provider.id, day, estimate, {
        tokens: 0,
        source: error instanceof DomainError ? 'rejected' : 'unconfirmed',
      });
      if (error instanceof DomainError) throw error;
      const timedOut =
        error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
      const message = timedOut
        ? 'A API demorou além do tempo de espera. Não foi possível confirmar o consumo de tokens.'
        : 'Falha de conexão com a API. Não foi possível confirmar o consumo de tokens.';
      const failedAt = clock();
      const until = await markError(database, provider.id, message, 60000, failedAt);
      failures.push(
        `${candidate.name}: ${pauseReason({ ...provider, last_error: message, cooldown_until: until }, failedAt)}`,
      );
      continue;
    }
    if (!response.ok) {
      await settle(database, provider.id, day, estimate, { tokens: 0, source: 'rejected' });
      const status = response.status;
      const message =
        status === 429
          ? 'A API limitou as chamadas (HTTP 429). Pode ser um limite por minuto ou por dia; isso não confirma que seu saldo de tokens acabou.'
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
            ? 60000
            : 60000;
      const failedAt = clock();
      let retryAfter = response.headers.get('retry-after');
      // Gemini can return RetryInfo in the JSON body instead of an HTTP header.
      // Read only the structured duration; never expose the upstream error text.
      if (!retryAfter && status === 429) {
        try {
          const body = await response.json();
          const details = body?.error?.details;
          const retry = Array.isArray(details)
            ? details.find(
                (d: { '@type'?: string }) =>
                  d?.['@type'] === 'type.googleapis.com/google.rpc.RetryInfo',
              )
            : null;
          if (typeof retry?.retryDelay === 'string' && /^\d+(?:\.\d+)?s$/.test(retry.retryDelay))
            retryAfter = retry.retryDelay.slice(0, -1);
        } catch {
          /* The status alone remains sufficient for safe fallback. */
        }
      }
      const until = await markError(
        database,
        provider.id,
        message,
        retryDelay(retryAfter, failedAt, fallback),
        failedAt,
      );
      failures.push(
        `${candidate.name}: ${pauseReason({ ...provider, last_error: message, cooldown_until: until }, failedAt)}`,
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
      tokenUsage(result, provider.config.kind, system + text),
    );
    let parsed: Command[];
    // Says which step failed, so the panel can point at the real cause instead of a generic
    // "formato inválido". Never carries the model's own text: it can echo personal data.
    let failure = 'A IA retornou comandos em formato inválido.';
    try {
      const output =
        provider.config.kind === 'gemini'
          ? result?.candidates?.[0]?.content?.parts
              ?.filter((part: { thought?: boolean }) => !part.thought)
              .map((part: { text?: string }) => part.text ?? '')
              .join('')
          : result?.choices?.[0]?.message?.content;
      if (typeof output !== 'string' || !output.trim()) {
        failure = 'A IA respondeu sem texto. Confira se o modelo existe e aceita responder JSON.';
        throw new Error();
      }
      // Models often wrap the object in ```json fences or add a sentence around it. Take the
      // outermost object; the schema below still decides whether its content is acceptable.
      const object = output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1);
      let data: unknown;
      try {
        data = JSON.parse(object);
      } catch {
        failure = 'A IA respondeu em texto, não em JSON. Esse modelo pode não suportar JSON.';
        throw new Error();
      }
      const commands = (data as { commands?: unknown })?.commands;
      if (!Array.isArray(commands)) {
        failure = 'A IA respondeu em JSON, mas sem a lista de ações esperada.';
        throw new Error();
      }
      const checked = commandsSchema.safeParse(commands);
      if (!checked.success) {
        failure = `A IA montou os comandos fora do formato: ${describe(checked.error)}.`;
        throw new Error();
      }
      parsed = checked.data;
    } catch {
      await markError(database, provider.id, failure, 60000, clock());
      // Trying a different model here could change the interpretation of a destructive
      // request. Nothing is executed unless a single response validates completely.
      throw new DomainError(`${failure} Nenhuma alteração foi feita.`, 422);
    }
    await database.query(
      'UPDATE agenda_llm_providers SET last_error=NULL,cooldown_until=NULL WHERE id=$1',
      [provider.id],
    );
    return parsed;
  }
  throw new DomainError(
    `Nenhuma alteração foi feita.\n${failures.join('\n')}${stoppedEarly ? '\nO limite de tentativas ou de tempo desta mensagem foi alcançado; nem todos os modelos foram consultados.' : ''}`,
    503,
  );
}
