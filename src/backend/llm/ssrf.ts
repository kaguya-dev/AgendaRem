import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { DomainError } from '../domain';

const MAX_RESPONSE_BYTES = 1024 * 1024;

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  blocked.addSubnet(address, prefix, 'ipv6');
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
export function validateApiUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DomainError('Informe uma URL HTTPS válida para a API.', 400);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443') ||
    !host ||
    (isIP(host)
      ? !isPublicAddress(host)
      : !host.includes('.') ||
        /(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(host) ||
        host.endsWith('.'))
  ) {
    throw new DomainError(
      'Use uma URL HTTPS pública, sem credenciais, parâmetros ou porta alternativa.',
      400,
    );
  }
  return url;
}

// DNS is checked inside the socket lookup and its validated address is pinned to that
// connection. Redirects are never followed; a second DNS lookup cannot rebind the host.
export const secureFetch = (url: string, init: RequestInit): Promise<Response> =>
  new Promise((resolve, reject) => {
    validateApiUrl(url);
    const req = request(
      url,
      {
        method: 'POST',
        headers: init.headers as Record<string, string>,
        signal: init.signal ?? undefined,
        lookup: (hostname, options, callback) => {
          lookup(hostname, { all: true }).then(
            (addresses) => {
              if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) {
                callback(new Error('Endereço privado bloqueado.'), '', 4);
                return;
              }
              if (options.all) callback(null, addresses);
              else callback(null, addresses[0].address, addresses[0].family);
            },
            () => callback(new Error('Falha de DNS da API.'), '', 4),
          );
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) req.destroy(new Error('Resposta da IA excede o limite.'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers))
            if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
          const status = res.statusCode ?? 502;
          resolve(
            new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), {
              status,
              headers,
            }),
          );
        });
      },
    );
    req.on('error', reject);
    req.end(init.body);
  });
