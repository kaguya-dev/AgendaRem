import { type Database, type Sql } from '../db';
import type { Config, ProviderRow } from './providers';

const number = (value: number) => value.toLocaleString('pt-BR');
export function pauseReason(provider: ProviderRow, now: Date): string {
  const seconds = Math.max(
    1,
    Math.ceil((new Date(provider.cooldown_until!).getTime() - now.getTime()) / 1000),
  );
  const wait = seconds < 60 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
  return `${provider.last_error ?? 'Modelo temporariamente pausado.'} Nova tentativa em ${wait}; você também pode usar “Liberar tentativa” em Modelos de IA.`;
}
export async function reserve(
  database: Database,
  id: string,
  day: string,
  estimate: number,
  now: Date,
): Promise<{ provider: ProviderRow; reason?: never } | { provider: null; reason: string }> {
  return database.transaction(async (tx) => {
    const provider = (
      await tx.query<ProviderRow>('SELECT * FROM agenda_llm_providers WHERE id=$1 FOR UPDATE', [id])
    ).rows[0];
    if (!provider || !provider.config.enabled)
      return { provider: null, reason: 'Modelo removido ou desativado.' };
    if (provider.cooldown_until && new Date(provider.cooldown_until) > now)
      return { provider: null, reason: pauseReason(provider, now) };
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
    if (usage.requests >= provider.config.dailyRequestLimit)
      return {
        provider: null,
        reason: `Limite diário de chamadas do app atingido (${number(usage.requests)}/${number(provider.config.dailyRequestLimit)}). Ajuste esse limite em Modelos de IA ou aguarde a virada do dia em Brasília.`,
      };
    if (
      provider.config.dailyTokenLimit > 0 &&
      Number(usage.tokens) >= provider.config.dailyTokenLimit
    )
      return {
        provider: null,
        reason: `Limite diário de tokens do app atingido (${number(Number(usage.tokens))}/${number(provider.config.dailyTokenLimit)}). Esse controle local não consulta o saldo da API. Ajuste-o em Modelos de IA ou aguarde a virada do dia em Brasília.`,
      };
    if (
      provider.config.dailyTokenLimit > 0 &&
      Number(usage.tokens) + Number(usage.reserved_tokens) >= provider.config.dailyTokenLimit
    )
      return {
        provider: null,
        reason:
          'Há tokens reservados para um pedido em andamento. Aguarde sua conclusão; essa reserva não é consumo confirmado.',
      };
    await tx.query(
      'UPDATE agenda_llm_usage SET requests=requests+1,reserved_tokens=reserved_tokens+$3,reserved_until=$4 WHERE provider_id=$1 AND day=$2',
      [id, day, estimate, new Date(now.getTime() + 120000).toISOString()],
    );
    return { provider };
  });
}
export type TokenCharge = {
  tokens: number;
  source: 'reported' | 'estimated' | 'unconfirmed' | 'rejected';
};
export async function settle(
  tx: Sql,
  id: string,
  day: string,
  estimate: number,
  charge: TokenCharge,
) {
  await tx.query(
    `UPDATE agenda_llm_usage SET reserved_tokens=GREATEST(0,reserved_tokens-$3),tokens=tokens+$4,
     reported_tokens=reported_tokens+$5,estimated_tokens=estimated_tokens+$6,
     unconfirmed_requests=unconfirmed_requests+$7 WHERE provider_id=$1 AND day=$2`,
    [
      id,
      day,
      estimate,
      charge.tokens,
      charge.source === 'reported' ? charge.tokens : 0,
      charge.source === 'estimated' ? charge.tokens : 0,
      charge.source === 'unconfirmed' ? 1 : 0,
    ],
  );
}
export async function markError(
  database: Database,
  id: string,
  message: string,
  milliseconds: number,
  now: Date,
) {
  const until = new Date(now.getTime() + milliseconds).toISOString();
  await database.query(
    'UPDATE agenda_llm_providers SET last_error=$2,cooldown_until=$3 WHERE id=$1',
    [id, message, until],
  );
  return until;
}
export function retryDelay(value: string | null, now: Date, fallback: number) {
  if (!value) return fallback;
  const numeric = /^\d+(?:\.\d+)?$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - now.getTime();
  return Number.isFinite(numeric) ? Math.max(1000, Math.min(86400000, numeric)) : fallback;
}
// Approximation for text only, not the provider's tokenizer. Never present this as measured usage.
export const estimateTokens = (text: string) => Math.ceil(Buffer.byteLength(text, 'utf8') / 3);
export function tokenUsage(
  result: Record<string, any> | null,
  kind: Config['kind'],
  input: string,
): TokenCharge {
  const value =
    kind === 'gemini' ? result?.usageMetadata?.totalTokenCount : result?.usage?.total_tokens;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000000000)
    return { tokens: value, source: 'reported' };
  // An unreadable or absent response gives no basis for asserting tokens were consumed.
  if (!result) return { tokens: 0, source: 'unconfirmed' };
  return { tokens: estimateTokens(input + JSON.stringify(result)), source: 'estimated' };
}
