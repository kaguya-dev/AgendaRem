import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, loadState, saveState, lock, consumeLimit, type Database } from './db';
import { DomainError, execute, purge, type State } from './domain';
import { interpret } from './interpreter';

interface Message {
  id: string;
  external_id: string;
  channel: string;
  body: string;
  reply: string | null;
  status: string;
  attempts: number;
  lease_token: string;
  created_at: Date | string;
  error: string | null;
}
export async function snapshot(database?: Database) {
  const databaseToUse = database ?? (await db());
  return databaseToUse.transaction(async (tx) => {
    await lock(tx);
    const state = await loadState(tx);
    const messages = (
      await tx.query(
        'SELECT id,channel,body,reply,status,error,created_at FROM agenda_messages ORDER BY received_at DESC LIMIT 30',
      )
    ).rows;
    const deliveries = (
      await tx.query(
        'SELECT id,status,error,attempts,created_at FROM agenda_outbox WHERE status <> $1 ORDER BY created_at DESC LIMIT 20',
        ['sent'],
      )
    ).rows;
    return {
      tasks: state.tasks,
      groups: state.groups,
      history: state.history,
      settings: state.settings,
      messages,
      deliveries,
      storage: process.env.DATABASE_MODE === 'local' ? 'local' : 'neon',
      llm: process.env.LLM_PROVIDER ?? 'none',
      whatsappConfigured: Boolean(
        process.env.WHATSAPP_ALLOWED_CHAT_ID &&
        process.env.WAHA_WEBHOOK_SECRET &&
        process.env.WAHA_API_KEY,
      ),
    };
  });
}
export async function panelAction(commands: unknown, requestId: string, database?: Database) {
  const databaseToUse = database ?? (await db());
  return databaseToUse.transaction(async (tx) => {
    await lock(tx);
    const prior = (
      await tx.query<Message>('SELECT * FROM agenda_messages WHERE external_id=$1', [
        `panel:${requestId}`,
      ])
    ).rows[0];
    if (prior) return { reply: prior.reply, clarification: prior.status === 'clarification' };
    const before = await loadState(tx);
    const result = execute(before, commands, 'panel');
    await saveState(tx, before, result.state);
    await tx.query(
      'INSERT INTO agenda_messages(id,external_id,channel,reply,status) VALUES($1,$2,$3,$4,$5)',
      [
        randomUUID(),
        `panel:${requestId}`,
        'panel',
        result.reply,
        result.clarification ? 'clarification' : 'done',
      ],
    );
    return { reply: result.reply, clarification: result.clarification };
  });
}
export async function enqueue(
  externalId: string,
  channel: string,
  text: string,
  at = new Date(),
  database?: Database,
) {
  const databaseToUse = database ?? (await db());
  const id = randomUUID();
  const result = await databaseToUse.query<{ id: string }>(
    'INSERT INTO agenda_messages(id,external_id,channel,body,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(external_id) DO NOTHING RETURNING id',
    [id, externalId, channel, text, at.toISOString()],
  );
  return result.rows[0]?.id ?? null;
}
export async function nudge() {
  const url = process.env.N8N_PROCESS_WEBHOOK_URL;
  const token = process.env.N8N_WEBHOOK_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'X-Agenda-Token': token, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    /* Durable queue is picked up by n8n's minute schedule. */
  }
}
const eventSchema = z.object({
  event: z.string(),
  session: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export async function receiveWaha(input: unknown, database?: Database) {
  const event = eventSchema.parse(input);
  const databaseToUse = database ?? (await db());
  if (event.session !== (process.env.WAHA_SESSION ?? 'default')) return { ignored: true };
  if (event.event === 'session.status') {
    const status = z
      .enum(['STOPPED', 'STARTING', 'SCAN_QR_CODE', 'WORKING', 'FAILED'])
      .safeParse(event.payload.status);
    if (status.success)
      await databaseToUse.transaction(async (tx) => {
        await lock(tx);
        const before = await loadState(tx);
        const after = structuredClone(before);
        after.settings.whatsappStatus = status.data;
        after.settings.whatsappUpdatedAt = new Date().toISOString();
        await saveState(tx, before, after);
      });
    return { received: true };
  }
  const allowed = process.env.WHATSAPP_ALLOWED_CHAT_ID;
  const p = event.payload;
  if (
    event.event !== 'message' ||
    p.fromMe !== false ||
    !allowed ||
    p.from !== allowed ||
    /@g\.us$|@newsletter$|@broadcast$/.test(allowed)
  )
    return { ignored: true };
  if (
    p.hasMedia === true ||
    typeof p.body !== 'string' ||
    !p.body.trim() ||
    p.body.length > 6000 ||
    typeof p.id !== 'string' ||
    p.id.length > 500
  )
    return { ignored: true };
  const seconds = typeof p.timestamp === 'number' ? p.timestamp : Date.now() / 1000;
  const at = new Date(seconds * 1000);
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 300000)
    throw new DomainError('Data da mensagem inválida.');
  const id = await enqueue(
    `waha:${event.session}:${p.id}`,
    `whatsapp:${allowed}`,
    p.body,
    at,
    databaseToUse,
  );
  return { received: true, duplicate: id === null };
}
export async function processNext(channel?: string, database?: Database, interpreter = interpret) {
  const databaseToUse = database ?? (await db());
  const token = randomUUID();
  const claimed = await databaseToUse.transaction(async (tx) => {
    await lock(tx);
    const candidate = (
      await tx.query<Message>(
        `SELECT m.* FROM agenda_messages m
      WHERE (m.status='pending' OR (m.status='processing' AND m.lease_until < now()))
      AND m.next_attempt_at <= now() AND ($1::text IS NULL OR m.channel=$1)
      AND NOT EXISTS (SELECT 1 FROM agenda_messages p WHERE p.channel=m.channel AND p.id<>m.id AND
        ((p.status='processing' AND p.lease_until>=now()) OR (p.status IN ('pending','processing') AND (p.received_at,p.id)<(m.received_at,m.id))))
      ORDER BY m.received_at,m.id LIMIT 1`,
        [channel ?? null],
      )
    ).rows[0];
    if (!candidate) return null;
    await tx.query(
      "UPDATE agenda_messages SET status='processing',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '90 seconds',updated_at=now() WHERE id=$1",
      [candidate.id, token],
    );
    return { message: candidate, state: await loadState(tx) };
  });
  if (!claimed) return { processed: false };
  const { message, state } = claimed;
  try {
    const commands = await interpreter(
      state,
      message.body,
      message.channel,
      new Date(message.created_at),
      async () => {
        const limit = Math.max(1, Math.min(10000, Number(process.env.LLM_DAILY_LIMIT) || 100));
        return consumeLimit(
          databaseToUse,
          `llm:${new Date().toISOString().slice(0, 10)}`,
          limit,
          86400000,
        );
      },
    );
    return await databaseToUse.transaction(async (tx) => {
      await lock(tx);
      const current = (
        await tx.query<Message>(
          "SELECT * FROM agenda_messages WHERE id=$1 AND status='processing' AND lease_token=$2",
          [message.id, token],
        )
      ).rows[0];
      if (!current) return { processed: false };
      const before = await loadState(tx);
      if (before.settings.revision !== state.settings.revision)
        throw new DomainError(
          'Os dados mudaram durante a interpretação. O pedido será tentado novamente.',
          503,
        );
      let next = before;
      let reply: string;
      let clarification = false;
      try {
        const result = execute(before, commands, message.channel);
        next = result.state;
        reply = result.reply;
        clarification = result.clarification;
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        reply = error.message;
      }
      await saveState(tx, before, next);
      await tx.query(
        'UPDATE agenda_messages SET status=$2,reply=$3,lease_token=NULL,lease_until=NULL,error=NULL,updated_at=now() WHERE id=$1',
        [message.id, clarification ? 'clarification' : 'done', reply],
      );
      if (message.channel.startsWith('whatsapp:'))
        await tx.query(
          'INSERT INTO agenda_outbox(id,message_id,chat_id,body) VALUES($1,$2,$3,$4) ON CONFLICT(message_id) DO NOTHING',
          [randomUUID(), message.id, message.channel.slice(9), reply],
        );
      return { processed: true, id: message.id, reply, clarification };
    });
  } catch (error) {
    const safe =
      error instanceof DomainError
        ? error.message
        : 'Não foi possível processar o pedido. Nenhuma alteração foi confirmada.';
    const failed =
      message.channel === 'simulator' ||
      message.attempts + 1 >= 3 ||
      error instanceof z.ZodError ||
      (error instanceof DomainError && error.status < 500);
    await databaseToUse.query(
      "UPDATE agenda_messages SET status=$3,error=$4,lease_token=NULL,lease_until=NULL,next_attempt_at=now()+interval '1 minute',updated_at=now() WHERE id=$1 AND lease_token=$2",
      [message.id, token, failed ? 'failed' : 'pending', safe],
    );
    return { processed: false, id: message.id, error: safe };
  }
}
export async function simulate(text: string, requestId: string) {
  const database = await db();
  await enqueue(`simulator:${requestId}`, 'simulator', text, new Date(), database);
  await processNext('simulator', database);
  const message = (
    await database.query<Message>('SELECT * FROM agenda_messages WHERE external_id=$1', [
      `simulator:${requestId}`,
    ])
  ).rows[0];
  return { id: message.id, reply: message.reply, status: message.status, error: message.error };
}
interface Delivery {
  id: string;
  message_id: string;
  chat_id: string;
  body: string;
  attempts: number;
}
export async function dispatchNext(database?: Database, sender = fetch) {
  const databaseToUse = database ?? (await db());
  if (!process.env.WAHA_API_KEY || !process.env.WAHA_URL || !process.env.WHATSAPP_ALLOWED_CHAT_ID)
    return { sent: false, reason: 'WhatsApp não configurado.' };
  const token = randomUUID();
  const item = await databaseToUse.transaction(async (tx) => {
    await lock(tx);
    // A crashed sender may have delivered. Never automatically send that item again.
    await tx.query(
      "UPDATE agenda_outbox SET status='uncertain',error='Envio interrompido; confira no WhatsApp antes de reenviar.',updated_at=now() WHERE status='sending' AND lease_until<now()",
    );
    const row = (
      await tx.query<Delivery>(`SELECT o.* FROM agenda_outbox o WHERE o.status='pending' AND o.next_attempt_at<=now()
      AND NOT EXISTS (SELECT 1 FROM agenda_outbox p WHERE p.chat_id=o.chat_id AND p.id<>o.id
        AND (p.status='sending' OR (p.status='pending' AND (p.created_at,p.id)<(o.created_at,o.id))))
      ORDER BY o.created_at,o.id LIMIT 1`)
    ).rows[0];
    if (!row) return null;
    if (row.chat_id !== process.env.WHATSAPP_ALLOWED_CHAT_ID) {
      await tx.query(
        "UPDATE agenda_outbox SET status='failed',error='Conversa não autorizada.' WHERE id=$1",
        [row.id],
      );
      return null;
    }
    await tx.query(
      "UPDATE agenda_outbox SET status='sending',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '45 seconds',updated_at=now() WHERE id=$1",
      [row.id, token],
    );
    return row;
  });
  if (!item) return { sent: false };
  let status = 'uncertain';
  let error: string | null = 'Entrega incerta. Confira o WhatsApp antes de reenviar.';
  let providerId: string | null = null;
  try {
    const response = await sender(`${process.env.WAHA_URL.replace(/\/$/, '')}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': process.env.WAHA_API_KEY },
      body: JSON.stringify({
        session: process.env.WAHA_SESSION ?? 'default',
        chatId: item.chat_id,
        text: item.body,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) {
      status = 'sent';
      error = null;
      try {
        const result = await response.json();
        providerId = typeof result.id === 'string' ? result.id : (result.id?._serialized ?? null);
      } catch {
        /* Successful HTTP status is enough to prevent a duplicate send. */
      }
    } else if ([400, 401, 403, 404, 422, 429].includes(response.status)) {
      status = item.attempts + 1 >= 5 ? 'failed' : 'pending';
      error = `WAHA recusou o envio (HTTP ${response.status}). Verifique a sessão e as credenciais.`;
    }
  } catch {
    /* Network failures have uncertain delivery semantics. */
  }
  await databaseToUse.query(
    "UPDATE agenda_outbox SET status=$3,error=$4,provider_id=$5,lease_token=NULL,lease_until=NULL,next_attempt_at=now()+interval '1 minute',updated_at=now() WHERE id=$1 AND lease_token=$2",
    [item.id, token, status, error, providerId],
  );
  return { sent: status === 'sent', status, id: item.id };
}
export async function cleanup(database?: Database, now = new Date()) {
  const databaseToUse = database ?? (await db());
  return databaseToUse.transaction(async (tx) => {
    await lock(tx);
    const before = await loadState(tx);
    const result = purge(before, now);
    await saveState(tx, before, result.state);
    // Retain technical deduplication IDs, purge personal message logs after 30 days.
    const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString();
    await tx.query(
      "UPDATE agenda_messages SET body=NULL,reply=NULL,error=NULL WHERE received_at<$1 AND status IN ('done','clarification','failed')",
      [cutoff],
    );
    await tx.query(
      "UPDATE agenda_outbox SET body=NULL,error=NULL WHERE created_at<$1 AND status IN ('sent','failed','uncertain')",
      [cutoff],
    );
    await tx.query('DELETE FROM agenda_limits WHERE expires_at<$1', [now.toISOString()]);
    return { removed: result.removed.length };
  });
}
export async function retry(id: string, kind: 'message' | 'delivery', confirmUncertain = false) {
  const database = await db();
  const result = await database.transaction(async (tx) => {
    await lock(tx);
    const table = kind === 'message' ? 'agenda_messages' : 'agenda_outbox';
    const row = (
      await tx.query<{ status: string; body: string | null; channel?: string }>(
        `SELECT status,body${kind === 'message' ? ',channel' : ''} FROM ${table} WHERE id=$1`,
        [id],
      )
    ).rows[0];
    if (!row || !row.body)
      throw new DomainError('Pedido indisponível ou conteúdo já removido pela retenção.');
    if (!['failed', 'uncertain'].includes(row.status))
      throw new DomainError('Esse pedido não precisa de nova tentativa.');
    if (row.status === 'uncertain' && !confirmUncertain)
      throw new DomainError(
        'Confirme que verificou o WhatsApp antes de reenviar uma entrega incerta.',
      );
    await tx.query(
      `UPDATE ${table} SET status='pending',attempts=0,next_attempt_at=now(),error=NULL,updated_at=now() WHERE id=$1`,
      [id],
    );
    return { queued: true, channel: row.channel };
  });
  if (result.channel === 'simulator') await processNext('simulator', database);
  return { queued: true };
}
