import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret() {
  let bits = '';
  for (const byte of randomBytes(20)) bits += byte.toString(2).padStart(8, '0');
  return bits
    .match(/.{5}/g)!
    .map((part) => alphabet[parseInt(part, 2)])
    .join('');
}
export function totp(secret: string, step = Math.floor(Date.now() / 30000), digits = 6) {
  const bits = [...secret].map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits)
    .toString()
    .padStart(digits, '0');
}
export function verifyTotp(
  secret: string,
  code: string,
  lastStep = -1,
  now = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30000);
  for (const candidate of [step, step - 1, step + 1])
    if (
      candidate > lastStep &&
      timingSafeEqual(Buffer.from(totp(secret, candidate)), Buffer.from(code))
    )
      return candidate;
  return null;
}
