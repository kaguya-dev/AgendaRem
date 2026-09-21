import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, type Database } from '../src/lib/db';
import { emptyState, DomainError, localDate } from '../src/lib/domain';
import { interpret } from '../src/lib/interpreter';
import {
  deleteProvider,
  generateCommands,
  isPublicAddress,
  listProviders,
  resetProvider,
  saveProvider,
  validateApiUrl,
  type LlmRequestOptions,
} from '../src/lib/llm';
import type { SaveLlmProviderInput } from '../src/lib/llm-types';

let database: Database;
const config = (overrides: Partial<SaveLlmProviderInput> = {}): SaveLlmProviderInput => ({
  name: 'IA principal',
  kind: 'compatible',
  model: 'example-model',
  apiUrl: 'https://api.example.com/v1/chat/completions',
  apiKey: 'secret-first-provider',
  priority: 1,
  enabled: true,
  dailyRequestLimit: 100,
  dailyTokenLimit: 0,
  ...overrides,
});
const success = (tokens = 31) =>
  Response.json({
    choices: [
      {
        message: {
          content: JSON.stringify({ commands: [{ op: 'create_task', title: 'Estudar' }] }),
        },
      },
    ],
    usage: { total_tokens: tokens },
  });
const fail = (status: number, headers?: Record<string, string>) =>
  Response.json({ error: 'Do not expose secret-first-provider' }, { status, headers });
before(async () => {
  process.env.LLM_ENCRYPTION_KEY = 'a'.repeat(64);
  database = await createDatabase();
});
beforeEach(async () => {
  await database.query('DELETE FROM agenda_llm_providers');
});
after(async () => {
  await database.close();
});

test('configurações persistem sem devolver chave, chave vazia preserva e a nova chave substitui', async () => {
  const saved = await saveProvider(config(), database);
  const provider = saved.providers[0];
  assert.equal(provider.keySet, true);
  assert.ok(!JSON.stringify(saved).includes('secret-first-provider'));
  const stored = JSON.stringify((await database.query('SELECT * FROM agenda_llm_providers')).rows);
  assert.ok(!stored.includes('secret-first-provider'));
  assert.ok(stored.includes('v1.'));
  await saveProvider(config({ id: provider.id, name: 'Renomeada', apiKey: '' }), database);
  const usedKeys: string[] = [];
  const sender: LlmRequestOptions['fetch'] = async (_url, init) => {
    usedKeys.push(new Headers(init.headers).get('authorization')!);
    return success();
  };
  await generateCommands('system', 'message', database, { fetch: sender });
  await saveProvider(config({ id: provider.id, apiKey: 'replacement-secret' }), database);
  await generateCommands('system', 'message', database, { fetch: sender });
  assert.deepEqual(usedKeys, ['Bearer secret-first-provider', 'Bearer replacement-secret']);
  await deleteProvider(provider.id, database);
  assert.equal((await listProviders(database)).providers.length, 0);
  assert.equal((await database.query('SELECT * FROM agenda_llm_usage')).rows.length, 0);
});

test('chave de criptografia inválida impede criação e nunca grava segredo em texto', async () => {
  process.env.LLM_ENCRYPTION_KEY = 'bad';
  try {
    await assert.rejects(saveProvider(config(), database), /LLM_ENCRYPTION_KEY/);
    assert.equal((await listProviders(database)).providers.length, 0);
  } finally {
    process.env.LLM_ENCRYPTION_KEY = 'a'.repeat(64);
  }
});

test('validação rejeita chaves ausentes, limites inválidos, URL insegura e campos inesperados', async () => {
  for (const invalid of [
    config({ apiKey: '' }),
    config({ dailyRequestLimit: 0 }),
    config({ dailyTokenLimit: -1 }),
    config({ apiUrl: 'http://api.example.com' }),
    config({ apiUrl: 'https://127.0.0.1/v1' }),
    config({ apiUrl: 'https://user:secret@api.example.com/v1' }),
    { ...config(), encrypted_key: 'untrusted' },
  ])
    await assert.rejects(saveProvider(invalid, database), DomainError);
  assert.equal((await listProviders(database)).providers.length, 0);
  for (const value of [
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://10.1.1.1/',
    'https://169.254.169.254/',
    'https://metadata.google.internal/',
    'https://localhost/',
    'https://127.1/',
    'https://2130706433/',
    'https://api.example.com/?key=secret',
    'https://api.example.com:8443/v1',
    'https://192.168.1.1/',
  ])
    assert.throws(() => validateApiUrl(value));
  for (const address of [
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '2002:7f00:1::',
    '2001:db8::1',
    '100.64.0.1',
    '192.0.0.1',
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2001:4860:4860::8888'), true);
});

test('429 troca por prioridade, respeita Retry-After e não divulga corpo de erro', async () => {
  const primary = (await saveProvider(config(), database)).providers[0];
  await saveProvider(config({ name: 'Reserva', priority: 2, apiKey: 'backup-key' }), database);
  const keys: string[] = [];
  const sender: LlmRequestOptions['fetch'] = async (_url, init) => {
    const key = new Headers(init.headers).get('authorization')!;
    keys.push(key);
    return key.includes('secret-first') ? fail(429, { 'retry-after': '3600' }) : success(47);
  };
  const result = await generateCommands('system', 'message', database, { fetch: sender });
  assert.deepEqual(result, [{ op: 'create_task', title: 'Estudar' }]);
  const status = (await listProviders(database)).providers;
  assert.equal(status[0].requestsToday, 1);
  assert.match(status[0].lastError!, /Limite/);
  assert.ok(new Date(status[0].cooldownUntil!).getTime() > Date.now() + 3500000);
  assert.equal(status[1].tokensToday, 47);
  assert.ok(!JSON.stringify(status).includes('secret-first-provider'));
  await generateCommands('system', 'message', database, { fetch: sender });
  assert.equal(keys.filter((key) => key.includes('secret-first')).length, 1);
  await resetProvider(primary.id, database);
  const reset = (await listProviders(database)).providers[0];
  assert.equal(reset.cooldownUntil, null);
  assert.equal(reset.requestsToday, 1);
});

test('limites locais de requests e tokens pulam provedores antes de enviar e renovam no dia seguinte', async () => {
  await saveProvider(config({ dailyRequestLimit: 1 }), database);
  await saveProvider(
    config({ name: 'Token budget', priority: 2, apiKey: 'token-budget-key', dailyTokenLimit: 10 }),
    database,
  );
  await saveProvider(config({ name: 'Fallback', priority: 3, apiKey: 'last-key' }), database);
  const used: string[] = [];
  const sender: LlmRequestOptions['fetch'] = async (_url, init) => {
    used.push(new Headers(init.headers).get('authorization')!);
    return success(31);
  };
  for (let i = 0; i < 3; i++)
    await generateCommands('system', 'message', database, { fetch: sender });
  assert.deepEqual(used, [
    'Bearer secret-first-provider',
    'Bearer token-budget-key',
    'Bearer last-key',
  ]);
  await generateCommands('system', 'message', database, {
    fetch: sender,
    now: new Date(Date.now() + 86400000),
  });
  assert.equal(used[3], 'Bearer secret-first-provider');
});

test('reservas transacionais impedem exceder o limite de requisições em chamadas simultâneas', async () => {
  await saveProvider(config({ dailyRequestLimit: 1 }), database);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const sender: LlmRequestOptions['fetch'] = async () => {
    calls++;
    started();
    await gate;
    return success();
  };
  const first = generateCommands('system', 'message', database, { fetch: sender });
  await ready;
  await assert.rejects(
    generateCommands('system', 'second', database, { fetch: sender }),
    /sem cota ou indisponíveis/,
  );
  release();
  await first;
  assert.equal(calls, 1);
});

test('falhas de rede, crédito, chave inválida e 5xx permitem a próxima IA e guardam erros seguros', async () => {
  for (const status of [0, 402, 401, 403, 503]) {
    await database.query('DELETE FROM agenda_llm_providers');
    await saveProvider(config(), database);
    await saveProvider(config({ name: 'Reserva', priority: 2 }), database);
    let calls = 0;
    const result = await generateCommands('system', 'message', database, {
      fetch: async () => {
        if (++calls === 1) {
          if (status === 0) throw new Error('secret network error');
          return fail(status);
        }
        return success();
      },
    });
    assert.equal(result?.[0].op, 'create_task');
    const providers = (await listProviders(database)).providers;
    assert.ok(providers[0].lastError);
    assert.ok(!providers[0].lastError!.includes('secret'));
    if (status === 401 || status === 403) assert.match(providers[0].lastError!, /Chave inválida/);
  }
});

test('resposta JSON ou comandos inválidos interrompem sem tentar outra IA nem alterar agenda', async () => {
  await saveProvider(config(), database);
  await saveProvider(config({ name: 'Reserva', priority: 2 }), database);
  for (const invalid of ['not JSON', JSON.stringify({ commands: [{ op: 'delete_all_tasks' }] })]) {
    for (const item of (await listProviders(database)).providers)
      await resetProvider(item.id, database);
    let calls = 0;
    await assert.rejects(
      generateCommands('system', 'message', database, {
        fetch: async () => {
          calls++;
          return Response.json({
            choices: [{ message: { content: invalid } }],
            usage: { total_tokens: 8 },
          });
        },
      }),
      (error: unknown) => error instanceof DomainError && error.status === 422,
    );
    assert.equal(calls, 1);
  }
  assert.equal((await database.query('SELECT * FROM agenda_tasks')).rows.length, 0);
});

test('Gemini usa chave no cabeçalho, lê metadados e ignora partes de raciocínio', async () => {
  await saveProvider(
    config({ kind: 'gemini', model: 'models/gemini-example', apiUrl: '' }),
    database,
  );
  await generateCommands('system prompt', 'message', database, {
    fetch: async (url, init) => {
      assert.equal(
        url,
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-example:generateContent',
      );
      assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'secret-first-provider');
      assert.equal(init.redirect, 'error');
      assert.equal(JSON.parse(String(init.body)).systemInstruction.parts[0].text, 'system prompt');
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: 'internal thought' },
                { text: '{"commands":[{"op":"help"}]}' },
              ],
            },
          },
        ],
        usageMetadata: { totalTokenCount: 55 },
      });
    },
  });
  assert.equal((await listProviders(database)).providers[0].tokensToday, 55);
});

test('todos indisponíveis falham com mensagem segura e tentativas limitadas', async () => {
  for (let i = 0; i < 6; i++)
    await saveProvider(config({ name: `IA ${i}`, priority: i }), database);
  let calls = 0;
  await assert.rejects(
    generateCommands('system', 'message', database, {
      fetch: async () => {
        calls++;
        return fail(429);
      },
    }),
    /Nenhuma alteração/,
  );
  assert.equal(calls, 4);
  assert.equal((await database.query('SELECT * FROM agenda_tasks')).rows.length, 0);
});

test('comandos básicos funcionam sem configuração e não consomem cota', async () => {
  const commands = await interpret(
    emptyState(),
    'Anota: Comprar pilhas',
    'web',
    new Date(),
    database,
  );
  assert.equal(commands[0].op, 'create_task');
  const fallback = await interpret(
    emptyState(),
    'Um pedido livre desconhecido',
    'web',
    new Date(),
    database,
  );
  assert.equal(fallback[0].op, 'clarify');
  assert.equal((await database.query('SELECT * FROM agenda_llm_usage')).rows.length, 0);
});

test('reservas de tokens abandonadas expiram e não bloqueiam o provedor pelo resto do dia', async () => {
  const provider = (await saveProvider(config({ dailyTokenLimit: 100 }), database)).providers[0];
  await database.query(
    'INSERT INTO agenda_llm_usage (provider_id,day,requests,reserved_tokens,reserved_until) VALUES ($1,$2,1,1000,$3)',
    [provider.id, localDate(new Date()), new Date(Date.now() - 1000).toISOString()],
  );
  const commands = await generateCommands('system', 'message', database, {
    fetch: async () => success(),
  });
  assert.equal(commands?.[0].op, 'create_task');
});
