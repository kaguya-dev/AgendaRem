import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createDatabase, loadState, type Database } from '../src/lib/db';
import {
  cleanup,
  dispatchNext,
  enqueue,
  panelAction,
  processNext,
  receiveWaha,
} from '../src/lib/service';
import {
  authenticated,
  sessionToken,
  verifyWebhook,
  internalAuth,
  sameOrigin,
} from '../src/lib/auth';

let database: Database;
before(async () => {
  database = await createDatabase();
  process.env.LLM_PROVIDER = 'none';
  process.env.WHATSAPP_ALLOWED_CHAT_ID = '557100000000@c.us';
  process.env.WAHA_SESSION = 'default';
});
after(async () => {
  await database.close();
});
test('webhook repetido persiste uma mensagem e executa uma única criação', async () => {
  const payload = {
    event: 'message',
    session: 'default',
    payload: {
      id: 'msg-1',
      from: '557100000000@c.us',
      fromMe: false,
      body: 'Anota: Mensagem única',
      timestamp: Date.now() / 1000,
    },
  };
  await receiveWaha(payload, database);
  const duplicate = await receiveWaha(payload, database);
  assert.equal(duplicate.duplicate, true);
  assert.equal((await processNext(undefined, database)).processed, true);
  assert.equal((await processNext(undefined, database)).processed, false);
  assert.equal((await loadState(database)).tasks.length, 1);
  assert.equal((await database.query('SELECT * FROM agenda_outbox')).rows.length, 1);
});
test('eventos próprios, outro remetente, mídia e sessão errada são ignorados', async () => {
  const base = {
    event: 'message',
    session: 'default',
    payload: { id: 'ignored', from: '557100000000@c.us', fromMe: false, body: 'Anota: Não salvar' },
  };
  for (const event of [
    { ...base, session: 'other' },
    { ...base, event: 'message.any' },
    { ...base, payload: { ...base.payload, fromMe: true } },
    { ...base, payload: { ...base.payload, from: 'intruder@c.us' } },
    { ...base, payload: { ...base.payload, hasMedia: true } },
  ])
    assert.equal((await receiveWaha(event, database)).ignored, true);
  assert.equal((await database.query('SELECT * FROM agenda_messages')).rows.length, 1);
});
test('ações do painel têm idempotência e conflito de versão', async () => {
  await panelAction([{ op: 'create_task', title: 'Painel' }], 'request-1', database);
  await panelAction([{ op: 'create_task', title: 'Painel' }], 'request-1', database);
  assert.equal((await loadState(database)).tasks.length, 2);
  await assert.rejects(
    panelAction(
      [{ op: 'update_task', task: '#2', title: 'Errado', expectedVersion: 90 }],
      'request-2',
      database,
    ),
    /outra tela/,
  );
});
test('fila serializa a conversa enquanto a interpretação está em andamento', async () => {
  await enqueue('serial:1', 'serial', 'Anota: Primeiro', new Date(), database);
  await enqueue('serial:2', 'serial', 'Anota: Segundo', new Date(), database);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const first = processNext('serial', database, async () => {
    started();
    await gate;
    return [{ op: 'create_task', title: 'Primeiro' }];
  });
  await ready;
  assert.equal((await processNext('serial', database)).processed, false);
  release();
  await first;
  assert.equal((await processNext('serial', database)).processed, true);
});
test('mudança no painel durante interpretação evita execução sobre contexto antigo', async () => {
  await enqueue('race', 'race', 'Algo', new Date(), database);
  const result = await processNext('race', database, async () => {
    await panelAction([{ op: 'create_task', title: 'Edição concorrente' }], 'concurrent', database);
    return [{ op: 'create_task', title: 'Contexto antigo' }];
  });
  assert.equal(result.processed, false);
  assert.ok('error' in result);
  assert.match(result.error, /dados mudaram/);
  assert.equal(
    (await loadState(database)).tasks.some((t) => t.title === 'Contexto antigo'),
    false,
  );
});
test('desfazer usa a ordem de operações persistida, não a ordem dos IDs', async () => {
  await panelAction([{ op: 'create_task', title: 'Última criação' }], 'undo-create', database);
  const before = await loadState(database);
  const id = before.tasks.find((t) => t.title === 'Última criação')!.id;
  await panelAction([{ op: 'complete_task', task: `#${id}` }], 'undo-complete', database);
  await panelAction([{ op: 'undo' }], 'undo', database);
  const after = await loadState(database);
  assert.equal(after.tasks.find((t) => t.id === id)!.trashedAt, null);
});
test('timeout de envio fica incerto e não é reenviado automaticamente', async () => {
  process.env.WAHA_URL = 'http://waha.test';
  process.env.WAHA_API_KEY = 'test-key';
  let calls = 0;
  const sender: typeof fetch = async () => {
    calls++;
    throw new Error('timeout');
  };
  const first = await dispatchNext(database, sender);
  assert.equal(first.status, 'uncertain');
  const second = await dispatchNext(database, sender);
  assert.equal(second.sent, false);
  assert.equal(calls, 1);
  assert.equal(
    (await loadState(database)).tasks.filter((t) => t.title === 'Mensagem única').length,
    1,
  );
});
test('limpeza usa o mesmo banco transacional e preserva os IDs de deduplicação', async () => {
  await panelAction([{ op: 'complete_task', task: '#1' }], 'complete-purge', database);
  const state = await loadState(database);
  const at = new Date(state.tasks.find((t) => t.id === 1)!.purgeAt!);
  await cleanup(database, new Date(at.getTime() + 1000));
  assert.equal(
    (await loadState(database)).tasks.some((t) => t.id === 1),
    false,
  );
  assert.equal(
    await enqueue(
      'waha:default:msg-1',
      'whatsapp:557100000000@c.us',
      'Anota: Mensagem única',
      new Date(),
      database,
    ),
    null,
  );
});
test('assinatura HMAC verifica o corpo original; sessão adulterada e expirada são recusadas', () => {
  process.env.WAHA_WEBHOOK_SECRET = 'x'.repeat(32);
  const raw = '{"event":"message"}';
  const sig = createHmac('sha512', process.env.WAHA_WEBHOOK_SECRET).update(raw).digest('hex');
  assert.equal(verifyWebhook(raw, sig), true);
  assert.equal(verifyWebhook(raw + ' ', sig), false);
  assert.equal(verifyWebhook(raw, null), false);
  process.env.SESSION_SECRET = 's'.repeat(32);
  const token = sessionToken();
  assert.equal(
    authenticated(
      new Request('http://localhost', { headers: { cookie: `agenda_session=${token}` } }),
    ),
    true,
  );
  assert.equal(
    authenticated(
      new Request('http://localhost', { headers: { cookie: `agenda_session=${token}bad` } }),
    ),
    false,
  );
  assert.equal(
    authenticated(
      new Request('http://localhost', { headers: { cookie: `agenda_session=${sessionToken(0)}` } }),
    ),
    false,
  );
});
test('API interna exige token e mutações do painel exigem origem exata', () => {
  process.env.INTERNAL_API_TOKEN = 'i'.repeat(32);
  process.env.APP_URL = 'http://localhost:3000';
  assert.throws(() => internalAuth(new Request('http://localhost')), /autorizado/);
  assert.doesNotThrow(() =>
    internalAuth(
      new Request('http://localhost', {
        headers: { authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}` },
      }),
    ),
  );
  assert.throws(
    () => sameOrigin(new Request('http://localhost', { headers: { origin: 'https://evil.test' } })),
    /Origem/,
  );
});
