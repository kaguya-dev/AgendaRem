import { test, expect } from '@playwright/test';
import { session } from './session';

test('tema claro e escuro: a escolha persiste, o contraste vira e nada fica invisível', async ({
  browser,
  context,
  page,
}) => {
  await context.addCookies(await session(browser));
  await page.goto('/');
  // A conversa com o assistente é a tela inicial; o painel fica a um clique na navegação.
  await expect(page.getByLabel('Sua mensagem')).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Todas as tarefas/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Todas as tarefas', exact: true })).toBeVisible();

  const fundo = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const texto = () => page.evaluate(() => getComputedStyle(document.body).color);
  const luz = (cor: string) => {
    const [r, g, b] = cor.match(/\d+/g)!.map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const fundoClaro = luz(await fundo());
  const textoClaro = luz(await texto());
  expect(fundoClaro).toBeGreaterThan(textoClaro);
  await page.screenshot({ path: 'test-results/tema-claro.png', fullPage: true });

  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('button', { name: 'Escuro', exact: true }).click();
  const fundoEscuro = luz(await fundo());
  const textoEscuro = luz(await texto());
  // A relação inverte: fundo escuro, texto claro.
  expect(fundoEscuro).toBeLessThan(textoEscuro);
  expect(fundoEscuro).toBeLessThan(60);
  expect(textoEscuro).toBeGreaterThan(180);
  await page.keyboard.press('Escape');
  // O conteúdo atrás de um <dialog> modal só recalcula o estilo quando ele fecha: capturar antes
  // disso registra os cartões ainda claros, o que parece um defeito do tema e não é.
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.querySelector('.stat-card')!).backgroundColor),
    )
    .not.toBe('rgb(255, 255, 255)');
  await page.screenshot({ path: 'test-results/tema-escuro.png', fullPage: true });

  // A escolha sobrevive ao recarregamento, sem piscar claro antes.
  await page.reload();
  // A conversa com o assistente é a tela inicial; o painel fica a um clique na navegação.
  await expect(page.getByLabel('Sua mensagem')).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Todas as tarefas/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Todas as tarefas', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  expect(luz(await fundo())).toBeLessThan(60);

  // Voltar para "seguir o sistema" limpa a marcação.
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('button', { name: 'Seguir o sistema', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(undefined);
});
