import { expect, type Browser, type BrowserContext } from '@playwright/test';

type Cookies = Awaited<ReturnType<BrowserContext['cookies']>>;
let cached: Cookies | null = null;

// O servidor bloqueia o endereço depois de 15 tentativas de login em 15 minutos, e a suíte
// inteira roda no mesmo endereço. Os testes que não estão exercitando a tela de login entram
// com este cookie, gerado uma única vez por execução.
export async function session(browser: Browser): Promise<Cookies> {
  if (cached) return cached;
  const context = await browser.newContext();
  const response = await context.request.post('http://localhost:3100/api/login', {
    headers: { origin: 'http://localhost:3100' },
    data: { password: 'test-password-only' },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  cached = await context.cookies();
  await context.close();
  return cached;
}
