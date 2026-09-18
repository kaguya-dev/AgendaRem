import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

mkdirSync('n8n', { recursive: true });
const node = (name, type, version, position, parameters, extra = {}) => ({
  id: randomUUID(),
  name,
  type: `n8n-nodes-base.${type}`,
  typeVersion: version,
  position,
  parameters,
  ...extra,
});
const connect = (name) => ({ node: name, type: 'main', index: 0 });
const internalCredentials = {
  httpHeaderAuth: { id: 'CONFIGURAR_CREDENCIAL_API', name: 'AgendaMagno API' },
};
function workflow({ file, name, endpoint, cadence, loopField, webhook }) {
  const config = node('Configuração', 'set', 3.4, [260, 200], {
    assignments: {
      assignments: [{ id: randomUUID(), name: 'appUrl', value: 'http://app:3000', type: 'string' }],
    },
    options: {},
  });
  const schedule = node('Agendamento', 'scheduleTrigger', 1.2, [0, 280], {
    rule: { interval: [cadence] },
  });
  const http = node(
    'Executar na API',
    'httpRequest',
    4.2,
    [520, 200],
    {
      method: 'POST',
      url: `={{ $('Configuração').first().json.appUrl + '/api/internal/${endpoint}' }}`,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: { timeout: 60000 },
    },
    { credentials: internalCredentials, retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 },
  );
  const note = node('Como configurar', 'stickyNote', 1, [0, -170], {
    width: 710,
    height: 210,
    content: `## ${name}\n1. Em Configuração, informe a URL interna da aplicação (Docker: http://app:3000).\n2. No HTTP Request, selecione a credencial Header Auth **AgendaMagno API**: nome Authorization; valor Bearer <INTERNAL_API_TOKEN>.\n${webhook ? '3. No Webhook, selecione Header Auth **AgendaMagno webhook**: nome X-Agenda-Token; valor <N8N_WEBHOOK_TOKEN>.\n' : ''}Salve e ative o workflow. Horários em America/Bahia. Nenhum segredo está neste arquivo.\nA API valida, persiste e deduplica. Não ligue o webhook WAHA diretamente a este fluxo.`,
  });
  const nodes = [note, schedule, config, http];
  const connections = {
    Agendamento: { main: [[connect('Configuração')]] },
    Configuração: { main: [[connect('Executar na API')]] },
  };
  if (webhook) {
    nodes.push(
      node(
        'Mensagem recebida',
        'webhook',
        2,
        [0, 100],
        {
          httpMethod: 'POST',
          path: 'agendamagno-processar',
          authentication: 'headerAuth',
          responseMode: 'onReceived',
          options: {},
        },
        {
          webhookId: randomUUID(),
          credentials: {
            httpHeaderAuth: { id: 'CONFIGURAR_CREDENCIAL_WEBHOOK', name: 'AgendaMagno webhook' },
          },
        },
      ),
    );
    connections['Mensagem recebida'] = { main: [[connect('Configuração')]] };
  }
  if (loopField) {
    nodes.push(
      node('Há mais trabalho?', 'if', 2.2, [780, 200], {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [
            {
              id: randomUUID(),
              leftValue: `={{ $json.${loopField} }}`,
              rightValue: true,
              operator: { type: 'boolean', operation: 'true', singleValue: true },
            },
          ],
          combinator: 'and',
        },
        options: {},
      }),
    );
    connections['Executar na API'] = { main: [[connect('Há mais trabalho?')]] };
    connections['Há mais trabalho?'] = { main: [[connect('Executar na API')], []] };
  }
  writeFileSync(
    `n8n/${file}`,
    JSON.stringify(
      {
        name,
        nodes,
        connections,
        active: false,
        settings: {
          executionOrder: 'v1',
          timezone: 'America/Bahia',
          executionTimeout: 180,
          saveDataSuccessExecution: 'none',
          saveDataErrorExecution: 'none',
          saveExecutionProgress: false,
        },
        pinData: {},
        tags: [],
      },
      null,
      2,
    ) + '\n',
  );
}
workflow({
  file: '01-processar-mensagens.json',
  name: 'AgendaMagno · Processar mensagens',
  endpoint: 'process',
  cadence: { field: 'minutes', minutesInterval: 1 },
  loopField: 'processed',
  webhook: true,
});
workflow({
  file: '02-entregar-respostas.json',
  name: 'AgendaMagno · Entregar respostas',
  endpoint: 'dispatch',
  cadence: { field: 'minutes', minutesInterval: 1 },
  loopField: 'sent',
});
workflow({
  file: '03-limpar-lixeira.json',
  name: 'AgendaMagno · Limpar lixeira',
  endpoint: 'cleanup',
  cadence: { field: 'hours', hoursInterval: 1 },
});
console.log('3 workflows gerados em n8n/. Importe, configure as credenciais e ative.');
