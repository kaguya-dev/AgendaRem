import { z } from 'zod';
import {
  authenticated,
  cookie,
  cronAuth,
  sameOrigin,
  sessionToken,
  verifyPassword,
} from '@/backend/auth';
import { db, consumeLimit } from '@/backend/db';
import { DomainError } from '@/backend/domain';
import { chat, cleanup, clearChat, panelAction, snapshot } from '@/backend/service';
import { deleteProvider, listProviders, resetProvider, saveProvider } from '@/backend/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const reply = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
async function read(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > 65536)
    throw new DomainError('Requisição muito grande.', 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 65536) throw new DomainError('Requisição muito grande.', 413);
  return raw;
}
async function handler(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const path = (await context.params).path.join('/');
    const method = request.method;
    if (path === 'health' && method === 'GET') return reply({ ok: true });
    if (path === 'auth' && method === 'GET')
      return reply({ authenticated: authenticated(request) });
    if (path === 'cron/cleanup' && method === 'GET') {
      cronAuth(request);
      return reply(await cleanup());
    }
    if (path === 'login' && method === 'POST') {
      sameOrigin(request);
      const body = z
        .object({ password: z.string().min(1).max(256) })
        .parse(JSON.parse(await read(request)));
      if (!(await consumeLimit(await db(), 'panel-login', 15, 15 * 60000)))
        throw new DomainError('Muitas tentativas. Aguarde 15 minutos.', 429);
      if (!verifyPassword(body.password)) throw new DomainError('Senha incorreta.', 401);
      return reply({ ok: true }, 200, { 'Set-Cookie': cookie(sessionToken(), 7 * 86400) });
    }
    if (!authenticated(request)) throw new DomainError('Entre para continuar.', 401);
    if (method === 'GET' && path === 'state') return reply(await snapshot());
    if (method === 'GET' && path === 'llm-providers') return reply(await listProviders());
    if (method !== 'POST') throw new DomainError('Rota não encontrada.', 404);
    sameOrigin(request);
    if (path === 'logout') return reply({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
    const body = JSON.parse(await read(request));
    if (path === 'actions') {
      const value = z.object({ commands: z.unknown(), requestId: z.string().uuid() }).parse(body);
      return reply(await panelAction(value.commands, value.requestId));
    }
    if (path === 'chat') {
      const value = z
        .object({ text: z.string().trim().min(1).max(6000), requestId: z.string().uuid() })
        .parse(body);
      return reply(await chat(value.text, value.requestId));
    }
    if (path === 'chat/clear') return reply(await clearChat());
    if (path === 'llm-providers') return reply(await saveProvider(body));
    if (path === 'llm-providers/delete' || path === 'llm-providers/reset') {
      const { id } = z.object({ id: z.string().uuid() }).parse(body);
      return reply(path.endsWith('/delete') ? await deleteProvider(id) : await resetProvider(id));
    }
    throw new DomainError('Rota não encontrada.', 404);
  } catch (error) {
    if (error instanceof DomainError) return reply({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return reply(
        {
          error: 'Dados inválidos. Confira os campos.',
          details: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
        400,
      );
    if (error instanceof SyntaxError) return reply({ error: 'JSON inválido.' }, 400);
    console.error('AgendaMagno API failure:', error instanceof Error ? error.name : 'UnknownError');
    return reply(
      {
        error:
          'Não foi possível concluir a operação. Verifique a configuração e a conexão com o banco.',
      },
      500,
    );
  }
}
export const GET = handler;
export const POST = handler;
