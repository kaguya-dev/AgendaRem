import { test, expect } from '@playwright/test';

test('cadastro de modelos funciona no frontend, persiste e não devolve a chave', async ({ page }) => {
  const key = 'test-api-key-never-return-to-browser';
  await page.goto('/');
  await page.getByLabel('Sua senha').fill('test-password-only');
  await page.getByRole('button', { name: 'Entrar no meu espaço' }).click();
  await page.getByRole('button', { name: 'Modelos de IA', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar modelo' }).click();
  await page.getByLabel('Nome para identificar').fill('Minha IA principal');
  await page.getByLabel('Identificador do modelo').fill('modelo-teste');
  await page.getByLabel('Chave da API').fill(key);
  await page.getByLabel('Limite de chamadas por dia').fill('12');
  await page.getByLabel('Limite de tokens por dia').fill('15000');
  await page.getByRole('button', { name: 'Salvar modelo' }).click();
  await expect(page.getByRole('heading', { name: 'Minha IA principal', exact: true })).toBeVisible();
  let result = await page.request.get('/api/llm-providers');
  expect(result.ok()).toBeTruthy();
  const raw = await result.text();
  expect(raw).not.toContain(key);
  expect(raw).not.toContain('encrypted_key');
  const provider = JSON.parse(raw).providers[0];
  expect(provider.keySet).toBe(true);
  expect(provider.dailyRequestLimit).toBe(12);
  expect(provider.dailyTokenLimit).toBe(15000);
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.getByLabel('Chave da API')).toHaveValue('');
  await page.getByLabel('Nome para identificar').fill('Minha IA reserva');
  await page.getByLabel('Prioridade de uso').fill('2');
  await page.getByLabel('Usar este modelo no assistente').uncheck();
  await page.getByRole('button', { name: 'Salvar modelo' }).click();
  await expect(page.getByRole('heading', { name: 'Minha IA reserva', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Modelos de IA', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Minha IA reserva', exact: true })).toBeVisible();
  result = await page.request.get('/api/llm-providers');
  const saved = (await result.json()).providers[0];
  expect(saved.keySet).toBe(true);
  expect(saved.enabled).toBe(false);
  expect(saved.priority).toBe(2);

  const rejected = await page.request.post('/api/llm-providers/delete', {
    headers: { Origin: 'https://evil.test' }, data: { id: saved.id },
  });
  expect(rejected.status()).toBe(403);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/llm-settings-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Remover Minha IA reserva' }).click();
  await page.getByRole('button', { name: 'Confirmar remoção' }).click();
  await expect(page.getByRole('heading', { name: 'Minha IA reserva', exact: true })).not.toBeVisible();
  expect((await (await page.request.get('/api/llm-providers')).json()).providers).toEqual([]);
});

test('cron autentica o agendamento e manifesto permite adicionar o webapp à tela inicial', async ({ request }) => {
  const cron = await request.get('/api/cron/cleanup', {
    headers: { Authorization: 'Bearer cron-test-secret-only-not-for-production-123456789' },
  });
  expect(cron.status()).toBe(200);
  expect((await cron.json()).removed).toBeGreaterThanOrEqual(0);
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  const body = await manifest.json();
  expect(body.display).toBe('standalone');
  expect(body.start_url).toBe('/');
  expect(body.icons.length).toBeGreaterThan(0);
});
