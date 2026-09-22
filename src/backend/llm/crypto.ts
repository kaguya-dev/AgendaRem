import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DomainError } from '../domain';

export function encryptionKey(): Buffer {
  const value = process.env.LLM_ENCRYPTION_KEY ?? '';
  const key = /^[a-f\d]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : /^[A-Za-z0-9+/]{43}=$/.test(value)
      ? Buffer.from(value, 'base64')
      : Buffer.alloc(0);
  if (key.length !== 32)
    throw new DomainError(
      'Configure LLM_ENCRYPTION_KEY no servidor: 32 bytes em hexadecimal ou base64.',
      503,
    );
  return key;
}
export function encryptKey(value: string, id: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(id));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}
export function decryptKey(value: string, id: string): string {
  const key = encryptionKey();
  try {
    const [version, iv, tag, encrypted] = value.split('.');
    if (version !== 'v1') throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    cipher.setAAD(Buffer.from(id));
    cipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      cipher.update(Buffer.from(encrypted, 'base64')),
      cipher.final(),
    ]).toString('utf8');
  } catch {
    throw new DomainError(
      'Não foi possível abrir a chave da IA. Confira LLM_ENCRYPTION_KEY ou cadastre novamente a chave.',
      503,
    );
  }
}
