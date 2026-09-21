import { randomUUID } from 'node:crypto';
import { db, loadState, saveState, lock, type Database, type Sql } from './db';
import { DomainError, execute, purge } from './domain';
import { interpret } from './interpreter';
import { listProviders } from './llm';

interface Message {
  id: string;
  external_id: string;
  channel: string;
  body: string | null;
  reply: string | null;
  status: string;
  error: string | null;
  created_at: Date | string;
}
const interrupted = 'O processamento foi interrompido. Reenvie o pedido para tentar novamente.';

async function expireInterrupted(tx: Sql) {
  await tx.query(
    `UPDATE agenda_messages SET status='failed',error=$1,lease_token=NULL,lease_until=NULL,updated_at=now()
     WHERE channel='web' AND status='processing' AND lease_until<now()`,
    [interrupted],
  );
}
async function currentState(tx: Sql, now = new Date()) {
  const before = await loadState(tx);
  const result = purge(before, now);
  await saveState(tx, before, result.state);
  return result;
}
async function trimLogs(tx: Sql, now: Date) {
  const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString();
  await tx.query(
    `UPDATE agenda_messages SET body=NULL,reply=NULL,error=NULL
     WHERE received_at<$1 AND status IN ('done','clarification','failed')
     AND (body IS NOT NULL OR reply IS NOT NULL OR error IS NOT NULL)`,
    [cutoff],
  );
  await tx.query('DELETE FROM agenda_limits WHERE expires_at<$1', [now.toISOString()]);
}
export async function snapshot(database?: Database) {
  const connection = database ?? (await db());
  const data = await connection.transaction(async (tx) => {
    await lock(tx);
    await expireInterrupted(tx);
    const { state } = await currentState(tx);
    await trimLogs(tx, new Date());
    const messages = (
      await tx.query(
        `SELECT id,channel,body,reply,status,error,created_at FROM agenda_messages
         WHERE channel IN ('web','panel','simulator') ORDER BY received_at DESC,id DESC LIMIT 50`,
      )
    ).rows;
    return {
      tasks: state.tasks,
      groups: state.groups,
      history: state.history,
      settings: { retentionDays: state.settings.retentionDays },
      messages,
      storage: process.env.DATABASE_MODE === 'local' ? 'local' : 'neon',
    };
  });
  const { providers } = await listProviders(connection);
  return { ...data, llm: providers.some((p) => p.enabled && p.keySet) ? 'configured' : 'none' };
}
export async function panelAction(commands: unknown, requestId: string, database?: Database) {
  const connection = database ?? (await db());
  return connection.transaction(async (tx) => {
    await lock(tx);
    const prior = (
      await tx.query<Message>('SELECT * FROM agenda_messages WHERE external_id=$1', [
        `panel:${requestId}`,
      ])
    ).rows[0];
    if (prior) return { reply: prior.reply, clarification: prior.status === 'clarification' };
    const { state: before } = await currentState(tx);
    const result = execute(before, commands, 'panel');
    await saveState(tx, before, result.state);
    await tx.query(
      'INSERT INTO agenda_messages(id,external_id,channel,reply,status) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), `panel:${requestId}`, 'panel', result.reply, result.clarification ? 'clarification' : 'done'],
    );
    return { reply: result.reply, clarification: result.clarification };
  });
}
function response(message: Message) {
  return { id: message.id, reply: message.reply, status: message.status, error: message.error };
}

// The HTTP request owns its work: no worker, webhook or long-running server is required.
// The result and mutations commit together, so repeating a request never repeats its actions.
export async function chat(
  text: string,
  requestId: string,
  database?: Database,
  interpreter = interpret,
) {
  const connection = database ?? (await db());
  const token = randomUUID();
  const claimed = await connection.transaction(async (tx) => {
    await lock(tx);
    await expireInterrupted(tx);
    const existing = (
      await tx.query<Message>('SELECT * FROM agenda_messages WHERE external_id=$1', [`web:${requestId}`])
    ).rows[0];
    if (existing) {
      if (existing.body !== null && existing.body !== text)
        throw new DomainError('Este pedido já foi usado para outra mensagem.', 409);
      return { prior: existing };
    }
    const busy = await tx.query(
      "SELECT id FROM agenda_messages WHERE channel='web' AND status='processing' LIMIT 1",
    );
    if (busy.rows.length)
      throw new DomainError('O assistente está respondendo a outro pedido. Aguarde a resposta e tente novamente.', 409);
    const { state } = await currentState(tx);
    const now = new Date();
    const message: Message = {
      id: randomUUID(), external_id: `web:${requestId}`, channel: 'web', body: text,
      reply: null, error: null, status: 'processing', created_at: now,
    };
    await tx.query(
      `INSERT INTO agenda_messages(id,external_id,channel,body,status,attempts,lease_token,lease_until,created_at)
       VALUES($1,$2,'web',$3,'processing',1,$4,now()+interval '150 seconds',$5)`,
      [message.id, message.external_id, text, token, now.toISOString()],
    );
    return { message, state };
  });
  if (claimed.prior) return response(claimed.prior);
  const { message, state } = claimed;
  try {
    const commands = await interpreter(state, text, 'web', new Date(message.created_at), connection);
    return await connection.transaction(async (tx) => {
      await lock(tx);
      const active = await tx.query(
        "SELECT id FROM agenda_messages WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>=now()",
        [message.id, token],
      );
      if (!active.rows.length) throw new DomainError(interrupted, 409);
      const { state: before } = await currentState(tx);
      if (before.settings.revision !== state.settings.revision)
        throw new DomainError('Os dados mudaram durante a interpretação. Nenhuma ação deste pedido foi aplicada; reenvie a mensagem.', 409);
      const result = execute(before, commands, 'web');
      await saveState(tx, before, result.state);
      const status = result.clarification ? 'clarification' : 'done';
      await tx.query(
        'UPDATE agenda_messages SET status=$2,reply=$3,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1',
        [message.id, status, result.reply],
      );
      return { id: message.id, status, reply: result.reply, error: null };
    });
  } catch (error) {
    const safe = error instanceof DomainError
      ? error.message
      : 'Não foi possível processar o pedido. Nenhuma alteração foi confirmada.';
    await connection.query(
      `UPDATE agenda_messages SET status='failed',error=$3,lease_token=NULL,lease_until=NULL,updated_at=now()
       WHERE id=$1 AND status='processing' AND lease_token=$2`,
      [message.id, token, safe],
    );
    return { id: message.id, status: 'failed', reply: null, error: safe };
  }
}
export async function cleanup(database?: Database, now = new Date()) {
  const connection = database ?? (await db());
  return connection.transaction(async (tx) => {
    await lock(tx);
    await expireInterrupted(tx);
    const result = await currentState(tx, now);
    await trimLogs(tx, now);
    return { removed: result.removed.length };
  });
}
