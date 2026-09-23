import { test, expect } from '@playwright/test';
import { session } from './session';

test.beforeEach(async ({ browser, context }) => {
  await context.addCookies(await session(browser));
});

test('financeiro: receita, despesa, categoria, edição, exclusão, restauração e mobile', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Financeiro', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Financeiro', exact: true })).toBeVisible();
  await page.getByLabel('Mês', { exact: true }).selectOption('09');
  await page.getByLabel('Ano', { exact: true }).selectOption('2031');
  await page.getByRole('button', { name: 'Novo lançamento', exact: true }).click();
  await page.getByLabel('Tipo do lançamento').selectOption('income');
  await page.getByLabel('Valor em reais').fill('3.000,00');
  await page.getByLabel('Data do lançamento').fill('2031-09-23');
  await page.getByLabel('Descrição do lançamento').fill('Salário e2e');
  await page.getByLabel('Categoria do lançamento').selectOption({ label: 'Salário' });
  await page.getByRole('button', { name: 'Salvar lançamento' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Novo lançamento', exact: true }).click();
  await page.getByLabel('Valor em reais').fill('42,90');
  await page.getByLabel('Data do lançamento').fill('2031-09-23');
  await page.getByLabel('Descrição do lançamento').fill('Almoço e2e');
  await page.getByLabel('Categoria do lançamento').selectOption({ label: 'Alimentação' });
  await page.getByRole('button', { name: 'Salvar lançamento' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByLabel('Resumo financeiro')).toContainText('2.957,10');
  // O que entrou e o que saiu aparecem separados, cada um na sua categoria.
  const received = page
    .locator('.category-group')
    .filter({ hasText: 'Recebido em cada categoria' });
  const spent = page.locator('.category-group').filter({ hasText: 'Gasto em cada categoria' });
  await expect(received).toContainText('Salário');
  await expect(received).toContainText('3.000,00');
  await expect(spent).toContainText('Alimentação');
  await expect(spent).toContainText('42,90');
  await expect(received).not.toContainText('42,90');
  await page.getByText('Gerenciar categorias', { exact: true }).click();
  await page.getByRole('button', { name: 'Nova categoria', exact: true }).click();
  await page.getByLabel('Nome da categoria').fill('Besteiras e2e');
  await page.getByRole('button', { name: 'Salvar categoria' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Almoço e2e' });
  await row.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Categoria do lançamento').selectOption({ label: 'Besteiras e2e' });
  await page.getByRole('button', { name: 'Salvar lançamento' }).click();
  await expect(row).toContainText('Besteiras e2e');
  page.once('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: 'Excluir', exact: true }).click();
  await expect(page.getByLabel('Resumo financeiro')).toContainText('3.000,00');
  await expect(row).not.toBeVisible();
  await page.getByLabel('Ver excluídos').check();
  await row.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await expect(page.getByText(/Almoço e2e: restaurado/)).toBeVisible();
  await page.getByLabel('Ver excluídos').uncheck();
  await expect(page.getByLabel('Resumo financeiro')).toContainText('2.957,10');
  await page.reload();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Financeiro', exact: true })
    .click();
  await page.getByLabel('Mês', { exact: true }).selectOption('09');
  await page.getByLabel('Ano', { exact: true }).selectOption('2031');
  await expect(page.getByLabel('Resumo financeiro')).toContainText('2.957,10');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row).toContainText('42,90');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/finance-mobile.png', fullPage: true });
});

test('descrição visível no celular e preservada ao editar título e consultar lixeira', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Todas as tarefas/ })
    .click();
  await page.getByRole('button', { name: 'Nova tarefa', exact: true }).click();
  await page.getByLabel('O que você precisa fazer?').fill('Descrição móvel');
  await page
    .getByRole('dialog')
    .getByLabel('Descrição', { exact: false })
    .fill('Contexto importante\nSegunda linha');
  await page.getByRole('button', { name: 'Criar tarefa', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.locator('.description-preview').filter({ hasText: 'Contexto importante' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Editar Descrição móvel', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Descrição', { exact: false })).toHaveValue(
    'Contexto importante\nSegunda linha',
  );
  await page.getByLabel('O que você precisa fazer?').fill('Descrição preservada');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await page.getByRole('button', { name: 'Editar Descrição preservada', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Descrição', { exact: false })).toHaveValue(
    'Contexto importante\nSegunda linha',
  );
});
