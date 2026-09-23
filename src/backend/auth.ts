import { createHash, timingSafeEqual, scryptSync } from 'node:crypto';
import { DomainError } from './domain';

export const COOKIE = 'agenda_session';
export function equal(a: string, b: string) {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}
export function verifyPassword(password: string) {
  const hash = process.env.PANEL_PASSWORD_HASH;
  if (hash) {
    const [salt, expected] = hash.split(':');
    return Boolean(
      salt && expected && equal(scryptSync(password, salt, 64).toString('hex'), expected),
    );
  }
  return Boolean(process.env.PANEL_PASSWORD && equal(password, process.env.PANEL_PASSWORD));
}
export function cronAuth(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (
    !expected ||
    expected.length < 32 ||
    !equal(request.headers.get('authorization') ?? '', `Bearer ${expected}`)
  )
    throw new DomainError('Não autorizado.', 401);
}
// A Vercel serve o mesmo app por mais de um endereço: o domínio de produção, o endereço
// próprio de cada deployment e o da branch. Aceitar só o APP_URL deixava o app inacessível
// justamente pelo link que o painel da plataforma entrega, sem que nada estivesse errado.
// São endereços do próprio app, entregues pela plataforma — não abrem a porta para terceiros,
// que continuam barrados por não constarem aqui.
export function allowedOrigins(): string[] {
  const origins: string[] = [];
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    try {
      origins.push(new URL(configured).origin);
    } catch {
      /* APP_URL inválida cai no padrão local abaixo. */
    }
  }
  if (process.env.VERCEL === '1')
    for (const name of ['VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'VERCEL_BRANCH_URL']) {
      const host = process.env[name]?.trim();
      if (host && !host.includes('/')) origins.push(`https://${host}`);
    }
  return origins.length ? [...new Set(origins)] : ['http://localhost:3000'];
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const allowed = allowedOrigins();
  if (origin && allowed.includes(origin)) return;

  if (origin && process.env.VERCEL !== '1') {
    try {
      const { hostname } = new URL(origin);
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.') ||
        hostname.endsWith('.local')
      ) {
        return;
      }
    } catch {
      /* Invalid origin falls through to error below. */
    }
  }

  if (!origin || !allowed.includes(origin))
    throw new DomainError(
      `Origem da requisição não autorizada. Este app aceita pedidos de ${allowed.join(' ou ')}. Abra por um desses endereços, ou ajuste APP_URL para o endereço que você usa e publique de novo.`,
      403,
    );
}
export function cookie(value: string, maxAge: number) {
  const secure = process.env.VERCEL === '1' || (process.env.APP_URL ?? '').startsWith('https://');
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
