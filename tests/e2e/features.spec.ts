import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
// Entrar e recarregar abrem a conversa com o assistente, que é a tela inicial. Os testes de
// painel seguem daí para a lista de tarefas.
async function toTasks(page: Page) {
  await expect(page.getByLabel('Sua mensagem')).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Todas as tarefas/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Todas as tarefas', exact: true })).toBeVisible();
}
async function enter(page: Page, trusted = false) {
  await page.goto('/');
  await page.getByLabel('Sua senha').fill('test-password-only');
  if (trusted) await page.getByLabel('Confiar neste dispositivo por 90 dias').check();
  await page.getByRole('button', { name: 'Entrar no meu espaço' }).click();
  await toTasks(page);
}
async function commands(page: Page, values: unknown[]) {
  const result = await page.request.post('/api/actions', {
    headers: { origin: 'http://localhost:3100' },
    data: { commands: values, requestId: randomUUID() },
  });
  expect(result.ok(), await result.text()).toBeTruthy();
  await page.getByRole('button', { name: 'Atualizar tarefas', exact: true }).click();
}
async function sync(page: Page) {
  await page
    .getByRole('button', { name: 'Tentar sincronizar' })
    .click({ timeout: 5000 })
    .catch(() => {});
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
}
test('grupo: personalizar, arquivar, restaurar e escolher destino das tarefas na exclusão', async ({
  page,
}) => {
  await enter(page);
  await commands(page, [
    { op: 'create_group', name: 'Grupo de teste' },
    { op: 'create_task', title: 'Tarefa do grupo', group: 'Grupo de teste' },
  ]);
  await page.getByRole('button', { name: /Grupo de teste/ }).click();
  await page.getByRole('button', { name: 'Editar grupo', exact: true }).click();
  await page.getByLabel('Cor', { exact: true }).selectOption('rose');
  await page.getByLabel('Ícone', { exact: true }).selectOption('book');
  await page.getByLabel('Ordem na barra lateral').fill('2');
  await page.getByRole('button', { name: 'Salvar grupo' }).click();
  await page.getByRole('button', { name: 'Editar grupo', exact: true }).click();
  await page.getByRole('button', { name: 'Arquivar grupo', exact: true }).click();
  await page.getByRole('button', { name: /^Grupos arquivados/ }).click();
  await page.getByRole('button', { name: 'Gerenciar grupo' }).click();
  await page.getByRole('button', { name: 'Restaurar grupo', exact: true }).click();
  await page.getByRole('button', { name: /Grupo de teste/ }).click();
  await page.getByRole('button', { name: 'Editar grupo', exact: true }).click();
  await page.getByRole('button', { name: 'Excluir grupo', exact: true }).click();
  await expect(page.getByText('1 tarefa(s) vinculada(s).', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar exclusão' }).click();
  await page.getByRole('button', { name: /^Caixa de entrada/ }).click();
  await expect(page.getByRole('button', { name: 'Editar Tarefa do grupo' })).toBeVisible();
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await page.getByRole('button', { name: /Grupo de teste/ }).click();
  await page.getByRole('button', { name: 'Editar grupo', exact: true }).click();
  await page.getByRole('button', { name: 'Excluir grupo', exact: true }).click();
  await page.getByLabel('Excluir também as tarefas, enviando-as à lixeira').check();
  await page.getByRole('button', { name: 'Confirmar exclusão' }).click();
  await page.getByRole('button', { name: /^Lixeira/ }).click();
  await expect(page.getByRole('button', { name: 'Restaurar Tarefa do grupo' })).toBeVisible();
});
test('tarefas: checklist, etiquetas, recorrência, calendário e seleção em lote', async ({
  page,
}) => {
  await enter(page);
  await page.getByRole('button', { name: 'Nova tarefa', exact: true }).click();
  await page.getByLabel('O que você precisa fazer?').fill('Rotina semanal');
  await page.getByLabel('Data de entrega').fill('2026-09-24');
  await page.getByLabel('Etiquetas separadas por vírgula').fill('rotina, estudo');
  await page.getByLabel('Nova etapa').fill('Ler capítulo');
  await page.getByRole('button', { name: 'Adicionar etapa' }).click();
  await page.getByLabel('Repetir', { exact: true }).selectOption('weekly');
  await page.getByLabel('Lembrete', { exact: true }).selectOption('15');
  await page.getByRole('button', { name: 'Criar tarefa', exact: true }).click();
  await page.getByLabel('Selecionar Rotina semanal', { exact: true }).check();
  await page.getByLabel('Prioridade das selecionadas').selectOption('high');
  await page.getByRole('button', { name: 'Aplicar prioridade' }).click();
  await page.getByRole('button', { name: 'Editar Rotina semanal', exact: true }).click();
  await expect(page.getByLabel('Prioridade', { exact: true })).toHaveValue('high');
  await expect(page.getByLabel('Concluir etapa Ler capítulo')).not.toBeChecked();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Fechar', exact: true })
    .last()
    .click();
  await page.getByRole('button', { name: 'Concluir Rotina semanal', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Editar Rotina semanal', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Concluídas/ })
    .click();
  await expect(
    page.getByRole('button', { name: 'Restaurar Rotina semanal', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Calendário', exact: true }).click();
  await expect(page.getByLabel('Visualização do calendário')).toHaveValue('month');
  await page.getByLabel('Visualização do calendário').selectOption('week');
  await expect(page.locator('.calendar-day')).toHaveCount(7);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/calendar-mobile.png', fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
test('consulta do dia 24 e respostas com destaque por tarefa', async ({ page }) => {
  await enter(page);
  await commands(page, [
    { op: 'create_task', title: 'Exatamente dia 24', dueDate: '2026-09-24' },
    { op: 'create_task', title: 'Exatamente dia 28', dueDate: '2026-09-28' },
  ]);
  await page.getByRole('button', { name: 'Abrir assistente', exact: true }).click();
  await page.getByLabel('Sua mensagem').fill('quais tarefas eu tenho pro dia 24/09/2026');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  const reply = page.locator('.bubble.assistant').last();
  await expect(reply).toContainText('Exatamente dia 24');
  await expect(reply).not.toContainText('Exatamente dia 28');
  await expect(reply.locator('.reply-task').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/assistant-tasks.png', fullPage: true });
});
test('acesso confiável mantém cookie e permite ver e encerrar dispositivos', async ({
  page,
  context,
}) => {
  await enter(page, true);
  const cookie = (await context.cookies()).find((c) => c.name === 'agenda_session')!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.expires * 1000 - Date.now()).toBeGreaterThan(89 * 86400000);
  await page.reload();
  await settings(page);
  await page.getByRole('button', { name: 'Segurança e dispositivos' }).click();
  await expect(page.getByText(/Este dispositivo/)).toBeVisible();
  await page.getByLabel('Senha atual para confirmar alterações').fill('test-password-only');
  await page.getByRole('button', { name: 'Encerrar outros dispositivos' }).click();
  await expect(page.getByRole('status')).toContainText('Configuração atualizada');
});
test('exportação pelo painel gera backup de tarefas sem credenciais', async ({ page }) => {
  await enter(page);
  await settings(page);
  await page.getByRole('button', { name: 'Exportar e restaurar' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar cópia da agenda' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^agenda-.*\.json$/);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const data = JSON.parse(Buffer.concat(chunks).toString());
  expect(data.format).toBe('AgendaMagno');
  expect(data.tasks.length).toBeGreaterThan(0);
  expect(data).not.toHaveProperty('password');
  expect(data).not.toHaveProperty('providers');
  await page.getByLabel('Arquivo para restaurar (JSON, até 2 MB)').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.getByRole('heading', { name: 'Revisar restauração' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restaurar arquivo' })).toBeDisabled();
});
test('offline persiste edição ao recarregar e sincroniza com o servidor ao reconectar', async ({
  page,
  context,
}) => {
  await enter(page, true);
  await commands(page, [{ op: 'create_task', title: 'Editar offline' }]);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await toTasks(page);
  await expect(
    page.getByRole('button', { name: 'Editar Editar offline', exact: true }),
  ).toBeVisible();
  await settings(page);
  await page.getByLabel('Permitir acesso offline neste dispositivo').check();
  await page.getByRole('button', { name: 'Salvar preferência' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Editar Editar offline', exact: true }).click();
  await page.getByLabel('O que você precisa fazer?').fill('Editada sem internet');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(
    page.getByRole('button', { name: 'Editar Editada sem internet', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('1 alteração(ões) aguardando envio.')).toBeVisible();
  await page.reload();
  await toTasks(page);
  await expect(
    page.getByRole('button', { name: 'Editar Editada sem internet', exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
  // Voltar a ter conexão já dispara a sincronização sozinha: o botão é só o empurrão manual e
  // pode sumir antes do clique, quando a fila esvazia primeiro. O que precisa valer é o
  // resultado — banner fora da tela e alteração no servidor.
  await sync(page);
  await expect(page.locator('.sync-banner')).not.toBeVisible();
  const state = await (await page.request.get('/api/state')).json();
  expect(state.tasks.some((t: { title: string }) => t.title === 'Editada sem internet')).toBe(true);
  // A concurrent edit must block the queued update instead of overwriting it.
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Editar Editada sem internet', exact: true }).click();
  await page.getByLabel('O que você precisa fazer?').fill('Minha alteração pendente');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(
    page.getByRole('button', { name: 'Editar Minha alteração pendente', exact: true }),
  ).toBeVisible();
  const task = state.tasks.find((t: { title: string }) => t.title === 'Editada sem internet');
  const external = await page.request.post('/api/actions', {
    headers: { origin: 'http://localhost:3100' },
    data: {
      commands: [
        {
          op: 'update_task',
          task: `#${task.id}`,
          title: 'Alteração de outro aparelho',
          expectedVersion: task.version,
        },
      ],
      requestId: randomUUID(),
    },
  });
  expect(external.ok()).toBeTruthy();
  await context.setOffline(false);
  await sync(page);
  await expect(page.locator('.sync-banner')).toContainText('alterada em outra tela');
  const actual = await (await page.request.get('/api/state')).json();
  expect(actual.tasks.find((t: { id: number }) => t.id === task.id).title).toBe(
    'Alteração de outro aparelho',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Descartar pendências' }).click();
  await expect(
    page.getByRole('button', { name: 'Editar Alteração de outro aparelho', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.sync-banner')).not.toBeVisible();
});

test('atualização automática traz mudanças de outro aparelho sem recarregar', async ({ page }) => {
  await enter(page);
  const result = await page.request.post('/api/actions', {
    headers: { origin: 'http://localhost:3100' },
    data: {
      commands: [{ op: 'create_task', title: 'Chegou de outro aparelho' }],
      requestId: randomUUID(),
    },
  });
  expect(result.ok()).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Editar Chegou de outro aparelho' })).toBeVisible({
    timeout: 20000,
  });
});
test('lembrete autorizado notifica uma vez e não repete a cada atualização', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['notifications']);
  await page.addInitScript(() => {
    (window as unknown as { reminderCalls: unknown[] }).reminderCalls = [];
    ServiceWorkerRegistration.prototype.showNotification = async function (title, options) {
      (window as unknown as { reminderCalls: unknown[] }).reminderCalls.push({ title, options });
    };
  });
  await enter(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const date = await page.evaluate(() =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bahia',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
  );
  await commands(page, [
    {
      op: 'create_task',
      title: 'Aviso de teste',
      dueDate: date,
      dueTime: '00:00',
      reminderMinutes: 0,
    },
  ]);
  await settings(page);
  await page.getByLabel('Ativar notificações de lembretes').check();
  await page.getByRole('button', { name: 'Salvar preferência' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { reminderCalls: { options: { body: string } }[] }
          ).reminderCalls.filter((c) => c.options.body === 'Aviso de teste').length,
      ),
    )
    .toBe(1);
  await page.getByRole('button', { name: 'Atualizar tarefas', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Atualizar tarefas', exact: true })).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { reminderCalls: { options: { body: string } }[] }
        ).reminderCalls.filter((c) => c.options.body === 'Aviso de teste').length,
    ),
  ).toBe(1);
});
test('barra lateral recolhe, devolve a largura ao conteúdo e a escolha sobrevive ao recarregamento', async ({
  page,
}) => {
  await enter(page);
  const borda = (seletor: string) =>
    page.locator(seletor).evaluate((el) => el.getBoundingClientRect().right);
  expect(await borda('.sidebar')).toBeGreaterThan(0);
  expect(
    await page.locator('.main-shell').evaluate((el) => el.getBoundingClientRect().left),
  ).toBeGreaterThan(200);
  await page.getByRole('button', { name: 'Ocultar menu lateral' }).click();
  await expect.poll(() => borda('.sidebar')).toBeLessThanOrEqual(0);
  await expect
    .poll(() => page.locator('.main-shell').evaluate((el) => el.getBoundingClientRect().left))
    .toBe(0);
  await page.screenshot({ path: 'test-results/sidebar-recolhida.png', fullPage: true });
  // A escolha é deste aparelho e continua valendo depois de recarregar.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Mostrar menu lateral' })).toBeVisible();
  await expect.poll(() => borda('.sidebar')).toBeLessThanOrEqual(0);
  // E a navegação volta com um clique, sem precisar de outra tela.
  await page.getByRole('button', { name: 'Mostrar menu lateral' }).click();
  await expect.poll(() => borda('.sidebar')).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: /^Todas as tarefas/ })).toBeVisible();
});
test('pedido é aceito na hora e concluído pelo servidor, sem depender da página aberta', async ({
  page,
}) => {
  await enter(page);
  const resposta = await page.request.post('/api/chat', {
    headers: { origin: 'http://localhost:3100' },
    data: { text: 'Anota: Sobrevive à saída', requestId: randomUUID() },
  });
  // O servidor responde antes de interpretar e executar: nada fica preso na requisição.
  const corpo = await resposta.json();
  expect(corpo.status).toBe('processing');
  expect(corpo.reply).toBeNull();
  // E termina o trabalho sozinho, com a página em outro lugar.
  await page.goto('about:blank');
  await expect
    .poll(
      async () => {
        const state = await page.request.get('http://localhost:3100/api/state');
        return ((await state.json()).tasks as { title: string }[]).some(
          (t) => t.title === 'Sobrevive à saída',
        );
      },
      { timeout: 20000 },
    )
    .toBe(true);
  // De volta à conversa, a resposta já está lá, sem reenviar nada.
  await page.goto('/');
  await expect(page.locator('.bubble.assistant').last()).toContainText(
    'Sobrevive à saída adicionada',
  );
});
