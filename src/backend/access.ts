import { createHash, randomBytes, randomUUID, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { db, consumeLimit, type Database, type Sql } from './db';
import { COOKIE, cookie, equal, verifyPassword } from './auth';
import { DomainError } from './domain';
import { encryptKey, decryptKey } from './llm/crypto';
import { newTotpSecret, verifyTotp } from './totp';

const derive = promisify(scrypt);
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
type Security = {
  passwordHash?: string;
  totp?: string;
  pendingTotp?: string;
  pendingUntil?: number;
  lastStep?: number;
  recovery?: string[];
};
export type Session = {
  id: string;
  label: string;
  trusted: boolean;
  created_at: string;
  expires_at: string;
  last_seen: string;
};
const credentials = z.object({
  password: z.string().min(1).max(256),
  code: z.string().max(64).optional(),
});
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${((await derive(password, salt, 64)) as Buffer).toString('hex')}`;
}
async function validPassword(password: string, security: Security) {
  if (!security.passwordHash) return verifyPassword(password);
  const [salt, expected] = security.passwordHash.split(':');
  return equal(((await derive(password, salt, 64)) as Buffer).toString('hex'), expected);
}
async function load(tx: Sql, locked = false): Promise<Security> {
  return (
    await tx.query<{ data: Security }>(
      `SELECT data FROM agenda_security WHERE id=1${locked ? ' FOR UPDATE' : ''}`,
    )
  ).rows[0].data;
}
async function save(tx: Sql, value: Security) {
  await tx.query('UPDATE agenda_security SET data=$1::jsonb WHERE id=1', [JSON.stringify(value)]);
}
function secondFactor(security: Security, code?: string) {
  if (!security.totp) return;
  if (!code)
    throw new DomainError('Informe o código do autenticador ou um código de recuperação.', 403);
  const recovery = digest(code.replace(/\s/g, '').toLowerCase());
  if (security.recovery?.includes(recovery)) {
    security.recovery = security.recovery.filter((item) => item !== recovery);
    return;
  }
  const step = verifyTotp(decryptKey(security.totp, 'account-totp'), code, security.lastStep);
  if (step === null)
    throw new DomainError(
      'Código inválido, expirado ou já utilizado. Aguarde o próximo código.',
      403,
    );
  security.lastStep = step;
}
export async function session(request: Request, connection?: Database): Promise<Session | null> {
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const database = connection ?? (await db());
  const result = await database.query<Session>(
    'SELECT id,label,trusted,created_at,expires_at,last_seen FROM agenda_sessions WHERE token_hash=$1 AND expires_at>now()',
    [digest(token)],
  );
  if (!result.rows[0]) return null;
  await database.query(
    "UPDATE agenda_sessions SET last_seen=now() WHERE id=$1 AND last_seen<now()-interval '5 minutes'",
    [result.rows[0].id],
  );
  return result.rows[0];
}
export async function login(request: Request, input: unknown, connection?: Database) {
  const value = credentials
    .extend({
      trusted: z.boolean().default(false),
      device: z.string().trim().max(100).default('Navegador'),
    })
    .parse(input);
  const database = connection ?? (await db());
  // Trust an IP header only when the platform supplies it. Local access shares a bucket.
  const address =
    process.env.VERCEL === '1'
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim() ?? 'unknown')
      : 'local';
  if (!(await consumeLimit(database, `login:${digest(address)}`, 15, 15 * 60000)))
    throw new DomainError('Muitas tentativas. Aguarde 15 minutos.', 429);
  if (!(await consumeLimit(database, 'login:global', 200, 15 * 60000)))
    throw new DomainError('Muitas tentativas. Tente mais tarde.', 429);
  return database.transaction(async (tx) => {
    const security = await load(tx, true);
    if (!(await validPassword(value.password, security)))
      throw new DomainError('Senha incorreta.', 401);
    if (security.totp && !value.code) return { needsCode: true, cookie: null, expiresAt: null };
    secondFactor(security, value.code);
    if (!security.passwordHash) security.passwordHash = await passwordHash(value.password);
    await save(tx, security);
    const token = randomBytes(32).toString('hex');
    const maxAge = value.trusted ? 90 * 86400 : 12 * 3600;
    const expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();
    await tx.query('DELETE FROM agenda_sessions WHERE expires_at<=now()');
    await tx.query(
      'INSERT INTO agenda_sessions(id,token_hash,label,trusted,expires_at) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), digest(token), value.device || 'Navegador', value.trusted, expiresAt],
    );
    await tx.query(
      'DELETE FROM agenda_sessions WHERE id IN (SELECT id FROM agenda_sessions ORDER BY created_at DESC OFFSET 20)',
    );
    return { needsCode: false, cookie: cookie(token, maxAge), expiresAt };
  });
}
export async function accessInfo(current: Session) {
  const database = await db();
  const security = await load(database);
  const sessions = (
    await database.query<Session>(
      'SELECT id,label,trusted,created_at,expires_at,last_seen FROM agenda_sessions WHERE expires_at>now() ORDER BY last_seen DESC',
    )
  ).rows;
  return {
    twoFactor: Boolean(security.totp),
    recoveryRemaining: security.recovery?.length ?? 0,
    currentId: current.id,
    sessions,
  };
}
export async function revokeSession(id: string, connection?: Database) {
  await (connection ?? (await db())).query('DELETE FROM agenda_sessions WHERE id=$1', [id]);
}
export async function reauthenticate(current: Session, input: unknown, connection?: Database) {
  const database = connection ?? (await db());
  const value = credentials.parse(input);
  if (!(await consumeLimit(database, `reauth:${current.id}`, 10, 5 * 60000)))
    throw new DomainError('Muitas tentativas. Aguarde 5 minutos.', 429);
  await database.transaction(async (tx) => {
    const security = await load(tx, true);
    if (!(await validPassword(value.password, security)))
      throw new DomainError('Senha incorreta.', 403);
    secondFactor(security, value.code);
    await save(tx, security);
  });
}
export async function updateAccess(current: Session, input: unknown) {
  const value = credentials
    .extend({
      action: z.enum(['password', 'setup', 'enable', 'disable', 'revoke', 'revoke-others']),
      newPassword: z.string().min(12).max(256).optional(),
      sessionId: z.string().uuid().optional(),
    })
    .parse(input);
  const database = await db();
  if (!(await consumeLimit(database, `reauth:${current.id}`, 10, 5 * 60000)))
    throw new DomainError('Muitas tentativas. Aguarde 5 minutos.', 429);
  return database.transaction(async (tx) => {
    const security = await load(tx, true);
    if (!(await validPassword(value.password, security)))
      throw new DomainError('Senha incorreta.', 403);
    secondFactor(security, value.code);
    if (value.action === 'password') {
      if (!value.newPassword)
        throw new DomainError('Informe uma nova senha com pelo menos 12 caracteres.');
      security.passwordHash = await passwordHash(value.newPassword);
      await tx.query('DELETE FROM agenda_sessions WHERE id<>$1', [current.id]);
    } else if (value.action === 'setup') {
      if (security.totp) throw new DomainError('A autenticação em duas etapas já está ativa.');
      const secret = newTotpSecret();
      security.pendingTotp = encryptKey(secret, 'account-totp');
      security.pendingUntil = Date.now() + 600000;
      await save(tx, security);
      return {
        secret,
        uri: `otpauth://totp/AgendaRem:Proprietario?secret=${secret}&issuer=AgendaRem&algorithm=SHA1&digits=6&period=30`,
      };
    } else if (value.action === 'enable') {
      if (security.totp || !security.pendingTotp || (security.pendingUntil ?? 0) < Date.now())
        throw new DomainError('Reinicie a configuração do autenticador.');
      const step = verifyTotp(decryptKey(security.pendingTotp, 'account-totp'), value.code ?? '');
      if (step === null) throw new DomainError('Código inválido. Confira o autenticador.');
      security.totp = security.pendingTotp;
      security.lastStep = step;
      delete security.pendingTotp;
      delete security.pendingUntil;
      const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(8).toString('hex'));
      security.recovery = recoveryCodes.map(digest);
      await save(tx, security);
      await tx.query('DELETE FROM agenda_sessions WHERE id<>$1', [current.id]);
      return { recoveryCodes };
    } else if (value.action === 'disable') {
      delete security.totp;
      delete security.lastStep;
      delete security.recovery;
      delete security.pendingTotp;
      delete security.pendingUntil;
      await tx.query('DELETE FROM agenda_sessions WHERE id<>$1', [current.id]);
    } else if (value.action === 'revoke') {
      if (!value.sessionId) throw new DomainError('Escolha o dispositivo.');
      await tx.query('DELETE FROM agenda_sessions WHERE id=$1', [value.sessionId]);
    } else await tx.query('DELETE FROM agenda_sessions WHERE id<>$1', [current.id]);
    await save(tx, security);
    return { ok: true };
  });
}
