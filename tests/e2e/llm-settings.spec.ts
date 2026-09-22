import { test, expect } from '@playwright/test';

test('cadastro de modelos funciona no frontend, persiste e não devolve a chave', async ({
  page,
}) => {
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
  await expect(
    page.getByRole('heading', { name: 'Minha IA principal', exact: true }),
  ).toBeVisible();
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
    headers: { Origin: 'https://evil.test' },
    data: { id: saved.id },
  });
  expect(rejected.status()).toBe(403);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'test-results/llm-settings-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Remover Minha IA reserva' }).click();
  await page.getByRole('button', { name: 'Confirmar remoção' }).click();
  await expect(
    page.getByRole('heading', { name: 'Minha IA reserva', exact: true }),
  ).not.toBeVisible();
  expect((await (await page.request.get('/api/llm-providers')).json()).providers).toEqual([]);
});

test('cron autentica o agendamento e manifesto permite adicionar o webapp à tela inicial', async ({
  request,
}) => {
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

test('uso distingue tokens confirmados, estimativas e falhas; pausa expira na tela', async ({
  page,
}) => {
  let expires = 0;
  await page.route('**/api/llm-providers', async (route) => {
    expires ||= Date.now() + 3500;
    await route.fulfill({
      json: {
        providers: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            name: 'Gemini de teste',
            kind: 'gemini',
            model: 'gemini-example',
            apiUrl: '',
            priority: 1,
            enabled: true,
            keySet: true,
            dailyRequestLimit: 100,
            dailyTokenLimit: 250000,
            requestsToday: 17,
            tokensToday: 5100,
            reportedTokensToday: 5000,
            estimatedTokensToday: 100,
            legacyTokensToday: 0,
            unconfirmedRequestsToday: 2,
            cooldownUntil: new Date(expires).toISOString(),
            lastError:
              'Falha de conexão com a API. Não foi possível confirmar o consumo de tokens.',
          },
        ],
      },
    });
  });
  await page.goto('/');
  await page.getByLabel('Sua senha').fill('test-password-only');
  await page.getByRole('button', { name: 'Entrar no meu espaço' }).click();
  await page.getByRole('button', { name: 'Modelos de IA', exact: true }).click();
  await expect(page.getByText('Em pausa', { exact: true })).toBeVisible();
  await expect(page.getByText(/5.000 confirmados pela API/)).toBeVisible();
  await expect(page.getByText(/100 estimados em respostas sem contagem/)).toBeVisible();
  await expect(page.getByText(/2 tentativa\(s\) sem confirmação de consumo/)).toBeVisible();
  await expect(page.getByText(/Pausa por mais \d+ s/)).toBeVisible();
  await expect(page.getByText('Disponível', { exact: true })).toBeVisible({ timeout: 7000 });
  await expect(page.getByText(/Pausa por mais/)).not.toBeVisible();
});
