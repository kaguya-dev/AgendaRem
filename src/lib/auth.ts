import { createHmac, createHash, timingSafeEqual, scryptSync, randomBytes } from 'node:crypto';
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
function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32)
    throw new DomainError('Execute npm run setup para configurar o acesso.', 503);
  return value;
}
export function sessionToken(now = Date.now()) {
  const data = Buffer.from(
    JSON.stringify({ exp: now + 7 * 86400000, nonce: randomBytes(16).toString('hex') }),
  ).toString('base64url');
  return `${data}.${createHmac('sha256', secret()).update(data).digest('base64url')}`;
}
export function authenticated(request: Request) {
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!token) return false;
  try {
    const [data, signature] = token.split('.');
    if (
      !data ||
      !signature ||
      !equal(signature, createHmac('sha256', secret()).update(data).digest('base64url'))
    )
      return false;
    return JSON.parse(Buffer.from(data, 'base64url').toString()).exp > Date.now();
  } catch {
    return false;
  }
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
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const allowed = new URL(process.env.APP_URL ?? 'http://localhost:3000').origin;
  if (!origin || origin !== allowed)
    throw new DomainError('Origem da requisição não autorizada.', 403);
}
export function cookie(value: string, maxAge: number) {
  const secure = process.env.VERCEL === '1' || (process.env.APP_URL ?? '').startsWith('https://');
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
