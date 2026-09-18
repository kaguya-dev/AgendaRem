# AgendaMagno

MVP pessoal com painel Next.js, PostgreSQL no Neon, automações importáveis no n8n e integração WAHA. Interface em português, fuso `America/Bahia` e acesso por senha. Não inclui áudio, lembretes, recorrência, classificação automática, etiquetas ou outras evoluções do plano.

## Testar localmente

Requisito: **Node.js 22+**, com npm. Na primeira instalação, é preciso internet para baixar as dependências.

```bash
./iniciar.sh
```

Abra **http://localhost:3000**. A senha gerada está em `PANEL_PASSWORD` no arquivo `.env`. Você pode substituí-la por uma senha de sua escolha e reiniciar o servidor. O script não sobrescreve um `.env` existente.

- O script instala dependências quando necessário e cria a configuração inicial.
- Os dados ficam em `.data/local`, preservados entre reinícios. O banco local é PGlite, um PostgreSQL embutido, sem Docker.
- Esse atalho **sempre usa o banco local**, mesmo se o `.env` tiver uma URL Neon. Não copia dados para o Neon.
- O painel funciona sem n8n, número de WhatsApp ou chave de IA.
- Use **Testar conversa** para experimentar comandos. Eles alteram os mesmos dados do painel.
- Encerre com `Ctrl+C`. Para outra porta: `./iniciar.sh 3002`.
- Se a porta estiver ocupada, encerre a outra instância ou escolha outra porta. Use o endereço `localhost` mostrado pelo script: a proteção de origem verifica esse endereço.

O modo local não executa a rotina horária do n8n. A lixeira continua restaurável; a exclusão automática começa quando o workflow de limpeza estiver ativo.

Alternativa manual:

```bash
npm ci
npm run setup
npm run dev
```

Nesse caso, as configurações de banco e endereço vêm do `.env` (banco local padrão: `.data/agenda`).

## O que está implementado

- Grupos: criar e renomear; Caixa de entrada para tarefas sem grupo.
- Tarefas: título, descrição, prioridade, situação, data e horário opcionais.
- Filtros: hoje, atrasadas, sem prazo, concluídas e lixeira; busca por título/descrição e paginação.
- Concluir envia à lixeira. Descartar não marca conclusão. Restaurar retorna a pendente.
- Retenção configurável (30 dias inicialmente). A mudança vale para novas entradas, e repetir a conclusão não reinicia o prazo.
- Histórico e desfazer por 24 horas, com detecção de conflito entre painel e mensagens. Criar uma lista pode ser desfeito como conjunto. Grupos e configurações não têm desfazer.
- Até 10 ações por comando, aplicadas atomicamente. Ambiguidades pedem esclarecimento, sem gravar partes do pedido.
- Referências recentes por conversa (30 minutos), seleção de tarefas homônimas e continuação por “mostrar mais”.
- Fila persistente de mensagens, deduplicação por sessão/ID e tentativas limitadas. Envio incerto exige revisão manual em **Atividade**.
- Login com cookie HttpOnly, assinatura de sessão, verificação de origem, limite de tentativas e API interna autenticada.

## Comandos sem LLM

O padrão é `LLM_PROVIDER=none`. Um interpretador determinístico permite testar comandos básicos gratuitamente:

```text
Crie um grupo chamado Estudos
Adicione ler capítulo 3 em Estudos
Em Estudos, adicione fazer lista 1, revisar limites e resolver exercícios
Anota: comprar pilhas
Quais tarefas existem?
Quais tarefas existem em Estudos?
Acrescente na descrição de #1: resolver somente questões pares
Troque a descrição de #1 por: resolver questões 2 e 4
Comecei #1
Coloque prioridade alta em #1
#1 é para amanhã
Deixe #1 sem prazo
Finalizei #1
Restaure #1
Mova #1 para Estudos
Tire #1 do grupo
Exclua #1
Mostre a lixeira
O que vence hoje?
O que está atrasado?
Busque capítulo
Exclua as tarefas da lixeira depois de 15 dias
Qual é o prazo da lixeira?
Desfaça a última alteração
Ajuda
```

O modo básico reconhece formatos definidos; não promete entender toda linguagem natural. Quando houver duas tarefas com o mesmo título, responda com o número da opção. Para um grupo inexistente, “criar” confirma a criação e retoma o pedido. Um novo comando claro substitui a pergunta pendente.

## Conectar o Neon

No `.env`:

```dotenv
DATABASE_MODE=postgres
DATABASE_URL=postgresql://USUARIO:SENHA@SEU_HOST/SEU_BANCO?sslmode=require
```

Use a URL fornecida pelo Neon, preservando seus parâmetros SSL. Nunca coloque essa URL em variáveis `NEXT_PUBLIC_*` ou no navegador.

```bash
npm run db:migrate
npm run dev
```

A inicialização também aplica o schema idempotente. Não use `iniciar.sh` para testar o Neon, pois esse script isola os testes no banco local. Há um único proprietário no MVP. As tabelas `agenda_*` guardam entidades em JSONB, filas relacionais e os registros técnicos de deduplicação. As operações de escrita usam uma transação e bloqueiam o registro de metadados para serializar alterações desse único usuário.

## Escolher a LLM depois

Mantenha `none` até escolher uma API. Há dois adaptadores:

```dotenv
# API Gemini nativa
LLM_PROVIDER=gemini
LLM_API_KEY=SUA_CHAVE
LLM_MODEL=MODELO_DISPONIVEL_NA_SUA_CONTA
LLM_DAILY_LIMIT=100
```

```dotenv
# Provedor com endpoint compatível com chat/completions
LLM_PROVIDER=compatible
LLM_API_URL=https://SEU_PROVEDOR/SEU_CAMINHO/chat/completions
LLM_API_KEY=SUA_CHAVE
LLM_MODEL=SEU_MODELO
LLM_DAILY_LIMIT=100
```

Os comandos básicos e respostas objetivas não consomem IA. Pedidos não reconhecidos usam o provedor configurado. Há limite diário da aplicação, timeout, saída JSON validada e nenhuma troca automática de provedor. A gratuidade depende do modelo/plano escolhido: confirme a cota gratuita e deixe faturamento desativado no provedor se o objetivo continuar sendo R$ 0. Esse limite local não transforma uma API paga em gratuita.

## n8n

Os arquivos prontos para importar estão em [n8n/](n8n/):

| Arquivo                       | Função                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `01-processar-mensagens.json` | Webhook de aviso e agendamento a cada minuto; processa a fila até não haver trabalho. |
| `02-entregar-respostas.json`  | A cada minuto, entrega respostas pendentes via WAHA.                                  |
| `03-limpar-lixeira.json`      | A cada hora, exclui tarefas vencidas e limpa dados técnicos conforme retenção.        |

1. Importe os três JSONs pelo menu **Import from file** do n8n.
2. Crie uma credencial **Header Auth**, nome `AgendaMagno API`, com header `Authorization` e valor `Bearer SEU_INTERNAL_API_TOKEN` (valor do `.env`). Selecione-a no nó **Executar na API** de cada workflow.
3. Crie outra credencial **Header Auth**, nome `AgendaMagno webhook`, com header `X-Agenda-Token` e valor de `N8N_WEBHOOK_TOKEN`. Selecione-a no nó **Mensagem recebida**.
4. No nó **Configuração** de cada fluxo, ajuste `appUrl`: `http://app:3000` no Compose. Se ambos rodarem diretamente no mesmo computador, `http://localhost:3000`. Dentro de contêineres, `localhost` é o próprio contêiner.
5. Salve e ative os três workflows. Configure `N8N_PROCESS_WEBHOOK_URL` com a URL de produção `/webhook/agendamagno-processar`.

Os IDs de credencial nos JSONs são marcadores; precisam ser selecionados após importar. Não há segredos exportados. O script `npm run n8n:generate` regenera os arquivos-base, substituindo mudanças feitas neles.

**Divisão do código:** o n8n coordena as filas e os agendamentos; a API concentra interpretação, validação, persistência e envio. Assim o simulador usa exatamente as mesmas regras do WhatsApp. Cada chamada de processamento reserva uma mensagem, interpreta e confirma a operação numa transação. Um webhook perdido é recuperado pelo agendamento; uma falha de envio não recria a tarefa. A resposta pode levar até cerca de um minuto para ser despachada pelo fluxo periódico, além do tempo de interpretação.

## Docker local e WAHA

```bash
npm run setup
docker compose up --build -d app n8n
```

Painel em `http://localhost:3000`; n8n em `http://localhost:5678`. Crie o usuário administrador do n8n e importe os workflows. Os dados internos do n8n usam seu volume próprio; não mantêm o Neon acordado. A sessão WAHA também tem volume separado.

Quando tiver o número dedicado:

1. Defina `WAHA_IMAGE` no `.env` com uma versão concreta compatível com sua máquina. O Compose tem `latest` apenas como fallback de desenvolvimento; fixe a versão antes do uso diário.
2. Inicie `docker compose --profile whatsapp up -d`.
3. Acesse a administração local do WAHA em `http://localhost:3001`, configure a sessão `default` e pareie o WhatsApp por QR.
4. Defina `WHATSAPP_ALLOWED_CHAT_ID` com o identificador exato do remetente autorizado, conforme o evento WAHA. Não presuma o formato só a partir do número; ele pode ser `@c.us` ou `@lid`.
5. Recrie a aplicação após mudar variáveis: `docker compose up -d --force-recreate app`.

No Compose, os webhooks globais já apontam para `http://app:3000/api/waha`, com eventos `message,session.status`, assinatura SHA-512 e reentregas limitadas. Configuração equivalente por sessão está em [docs/waha-session.example.json](docs/waha-session.example.json). Configure **um** dos dois caminhos para evitar eventos duplicados desnecessários. API e administração ficam vinculadas a `127.0.0.1`; não exponha n8n/WAHA diretamente na internet. O WAHA é uma integração não oficial; o pareamento real ainda depende do número.

Para hospedar depois, defina `APP_URL` com a URL HTTPS, configure proxy reverso/TLS e preserve os volumes. O cookie do painel passa a usar `Secure` com uma URL HTTPS. `N8N_SECURE_COOKIE=false` no Compose atende somente ao acesso HTTP local; ajuste para HTTPS ao publicar. Nenhum serviço foi contratado ou publicado por este projeto.

## Estrutura e verificações

```text
iniciar.sh                  Início rápido para testar localmente
src/app/                    Página e API Next.js
src/components/dashboard.tsx Painel, login e simulador
src/lib/domain.ts           Regras de tarefas, contexto, lixeira e desfazer
src/lib/db.ts               PostgreSQL/Neon e PGlite
src/lib/schema.ts           Schema inicial idempotente
src/lib/interpreter.ts      Comandos básicos e adaptadores de IA
src/lib/service.ts          Filas, WAHA, processamento e limpeza
n8n/                        Workflows importáveis
tests/                      Testes de regras, integração e navegador
```

```bash
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Os testes de integração usam PostgreSQL embutido em memória. Os testes de navegador usam banco temporário separado dos seus dados. Para usar um Chromium já instalado, informe `PLAYWRIGHT_CHROMIUM_EXECUTABLE` com seu caminho.

A implementação é testável localmente, mas a conexão real com Neon, o pareamento WAHA e a qualidade de uma LLM escolhida precisam ser validados com suas contas. A suíte não comprova a meta de 95% de compreensão de linguagem natural; isso depende do modelo futuro.

Validação realizada: regras de domínio e integração com PGlite, ciclo completo no navegador (desktop/celular), proteção das rotas, build de produção e importação dos três workflows em n8n 2.39.6. Os testes não enviam mensagens reais.

Backups: com o servidor local **parado**, copie `.data/local` para um local seguro. No Neon, use um backup PostgreSQL (`pg_dump`/`pg_restore`) antes de depender do sistema diariamente. Guarde também o `.env` e os volumes de n8n/WAHA em local protegido: a chave `N8N_ENCRYPTION_KEY` é necessária para recuperar credenciais. Backups têm retenção própria. Após restaurar, execute o workflow de limpeza antes de voltar ao uso. A restauração de um backup externo ainda precisa ser validada no ambiente escolhido.
