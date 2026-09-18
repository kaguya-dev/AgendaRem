import { after } from 'next/server';
import { z } from 'zod';
import {
  authenticated,
  cookie,
  internalAuth,
  sameOrigin,
  sessionToken,
  verifyPassword,
  verifyWebhook,
} from '@/lib/auth';
import { db, consumeLimit } from '@/lib/db';
import { DomainError } from '@/lib/domain';
import {
  cleanup,
  dispatchNext,
  nudge,
  panelAction,
  processNext,
  receiveWaha,
  retry,
  simulate,
  snapshot,
} from '@/lib/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
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
    if (path === 'waha' && method === 'POST') {
      const raw = await read(request);
      if (!verifyWebhook(raw, request.headers.get('x-webhook-hmac')))
        throw new DomainError('Assinatura inválida.', 401);
      const result = await receiveWaha(JSON.parse(raw));
      if ('received' in result) after(nudge);
      return reply(result);
    }
    if (path.startsWith('internal/')) {
      internalAuth(request);
      if (method !== 'POST') throw new DomainError('Método não permitido.', 405);
      if (path === 'internal/process') return reply(await processNext());
      if (path === 'internal/dispatch') return reply(await dispatchNext());
      if (path === 'internal/cleanup') return reply(await cleanup());
      throw new DomainError('Rota não encontrada.', 404);
    }
    if (!authenticated(request)) throw new DomainError('Entre para continuar.', 401);
    if (method === 'GET' && path === 'state') return reply(await snapshot());
    if (method !== 'POST') throw new DomainError('Rota não encontrada.', 404);
    sameOrigin(request);
    if (path === 'logout') return reply({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
    const body = JSON.parse(await read(request));
    if (path === 'actions') {
      const value = z.object({ commands: z.unknown(), requestId: z.string().uuid() }).parse(body);
      return reply(await panelAction(value.commands, value.requestId));
    }
    if (path === 'simulate') {
      const value = z
        .object({ text: z.string().trim().min(1).max(6000), requestId: z.string().uuid() })
        .parse(body);
      return reply(await simulate(value.text, value.requestId));
    }
    if (path === 'retry') {
      const value = z
        .object({
          id: z.string().uuid(),
          kind: z.enum(['message', 'delivery']),
          confirmUncertain: z.boolean().optional(),
        })
        .parse(body);
      const result = await retry(value.id, value.kind, value.confirmUncertain);
      after(nudge);
      return reply(result);
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
