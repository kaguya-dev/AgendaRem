import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, db, loadState, type Database } from '../src/backend/db';
import { chat, cleanup, panelAction, snapshot } from '../src/backend/service';
import { authenticated, sessionToken, cronAuth, sameOrigin, cookie } from '../src/backend/auth';

let database: Database;
before(async () => {
  database = await createDatabase();
});
after(async () => {
  await database.close();
});

test('conversa web executa sem worker e repetir requestId não duplica a tarefa', async () => {
  const first = await chat('Anota: Mensagem única', 'web-1', database);
  assert.equal(first.status, 'done');
  assert.match(first.reply!, /Mensagem única/);
  assert.deepEqual(await chat('Anota: Mensagem única', 'web-1', database), first);
  assert.equal((await loadState(database)).tasks.length, 1);
  await assert.rejects(chat('Anota: Outro texto', 'web-1', database), /outra mensagem/);
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
test('pedidos concorrentes não consomem IA nem deixam fila dependente de worker', async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const first = chat('Primeiro pedido', 'serial-1', database, async () => {
    started();
    await gate;
    return [{ op: 'create_task', title: 'Primeiro' }];
  });
  await ready;
  assert.equal((await chat('Primeiro pedido', 'serial-1', database)).status, 'processing');
  await assert.rejects(chat('Anota: Segundo', 'serial-2', database), /outro pedido/);
  release();
  assert.equal((await first).status, 'done');
  assert.equal((await chat('Anota: Segundo', 'serial-2', database)).status, 'done');
});
test('mudança no painel durante interpretação evita execução sobre contexto antigo', async () => {
  const result = await chat('Algo', 'race', database, async () => {
    await panelAction([{ op: 'create_task', title: 'Edição concorrente' }], 'concurrent', database);
    return [{ op: 'create_task', title: 'Contexto antigo' }];
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error!, /dados mudaram/);
  assert.equal(
    (await loadState(database)).tasks.some((t) => t.title === 'Contexto antigo'),
    false,
  );
});
test('falha de interpretação não aplica ações e novo pedido funciona imediatamente', async () => {
  const before = (await loadState(database)).tasks.length;
  const failed = await chat('Pedido com erro', 'failed-1', database, async () => {
    throw new Error('secret upstream response');
  });
  assert.equal(failed.status, 'failed');
  assert.doesNotMatch(failed.error!, /secret/);
  assert.equal((await loadState(database)).tasks.length, before);
  assert.equal((await chat('Ajuda', 'failed-2', database)).status, 'done');
});
test('execução de várias ações é atômica quando uma delas é inválida', async () => {
  const result = await chat('Pedido inválido', 'invalid-actions', database, async () => [
    { op: 'create_task', title: 'Não deve existir' },
    { op: 'complete_task', task: '#999999' },
  ]);
  assert.equal(result.status, 'failed');
  assert.equal(
    (await loadState(database)).tasks.some((t) => t.title === 'Não deve existir'),
    false,
  );
});
test('interrupção de função expira no próximo acesso e não bloqueia o assistente', async () => {
  await database.query(`INSERT INTO agenda_messages(id,external_id,channel,body,status,lease_token,lease_until)
    VALUES('crashed','web:crashed','web','Anota: interrompida','processing','lost',now()-interval '1 minute')`);
  const state = await snapshot(database);
  const stale = state.messages.find((m) => m.id === 'crashed');
  assert.equal(stale?.status, 'failed');
  assert.equal((await chat('Ajuda', 'after-crash', database)).status, 'done');
});
test('desfazer usa a ordem de operações persistida, não a ordem dos IDs', async () => {
  await panelAction([{ op: 'create_task', title: 'Última criação' }], 'undo-create', database);
  const id = (await loadState(database)).tasks.find((t) => t.title === 'Última criação')!.id;
  await panelAction([{ op: 'complete_task', task: `#${id}` }], 'undo-complete', database);
  await panelAction([{ op: 'undo' }], 'undo', database);
  assert.equal((await loadState(database)).tasks.find((t) => t.id === id)!.trashedAt, null);
});
test('abrir painel limpa tarefas vencidas mesmo sem cron', async () => {
  await panelAction([{ op: 'create_task', title: 'Expirada' }], 'expired-create', database);
  const task = (await loadState(database)).tasks.find((t) => t.title === 'Expirada')!;
  await panelAction([{ op: 'complete_task', task: `#${task.id}` }], 'expired-complete', database);
  await database.query(
    `UPDATE agenda_tasks SET data=jsonb_set(data,'{purgeAt}',to_jsonb($2::text)) WHERE id=$1`,
    [String(task.id), '2000-01-01T00:00:00.000Z'],
  );
  assert.equal(
    (await snapshot(database)).tasks.some((t) => t.id === task.id),
    false,
  );
});
test('limpeza conserva IDs de deduplicação e retira conteúdo pessoal após retenção', async () => {
  await panelAction([{ op: 'complete_task', task: '#1' }], 'complete-purge', database);
  const at = new Date((await loadState(database)).tasks.find((t) => t.id === 1)!.purgeAt!);
  await cleanup(database, new Date(at.getTime() + 1000));
  assert.equal(
    (await loadState(database)).tasks.some((t) => t.id === 1),
    false,
  );
  const prior = await chat('Anota: Mensagem única', 'web-1', database);
  assert.equal(prior.status, 'done');
  assert.equal(prior.reply, null);
  assert.equal(
    (await loadState(database)).tasks.some((t) => t.title === 'Mensagem única'),
    false,
  );
});
test('sessão adulterada e expirada são recusadas', () => {
  process.env.SESSION_SECRET = 's'.repeat(32);
  const token = sessionToken();
  const request = (value: string) =>
    new Request('http://localhost', { headers: { cookie: `agenda_session=${value}` } });
  assert.equal(authenticated(request(token)), true);
  assert.equal(authenticated(request(`${token}bad`)), false);
  assert.equal(authenticated(request(sessionToken(0))), false);
});
test('cron exige segredo e mutações do painel exigem origem exata', () => {
  process.env.CRON_SECRET = 'i'.repeat(32);
  process.env.APP_URL = 'http://localhost:3000';
  assert.throws(() => cronAuth(new Request('http://localhost')), /autorizado/);
  assert.doesNotThrow(() =>
    cronAuth(
      new Request('http://localhost', {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }),
    ),
  );
  assert.throws(
    () => sameOrigin(new Request('http://localhost', { headers: { origin: 'https://evil.test' } })),
    /Origem/,
  );
  assert.doesNotThrow(() =>
    sameOrigin(new Request('http://localhost', { headers: { origin: 'http://localhost:3000' } })),
  );
});
test('Vercel bloqueia banco local efêmero e usa cookie Secure', () => {
  const oldVercel = process.env.VERCEL;
  const oldMode = process.env.DATABASE_MODE;
  process.env.VERCEL = '1';
  process.env.DATABASE_MODE = 'local';
  try {
    assert.throws(() => db(), /Na Vercel/);
    assert.match(cookie('token', 60), /; Secure/);
  } finally {
    if (oldVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = oldVercel;
    if (oldMode === undefined) delete process.env.DATABASE_MODE;
    else process.env.DATABASE_MODE = oldMode;
  }
});
