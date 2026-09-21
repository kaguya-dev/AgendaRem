# AgendaMagno

Agenda pessoal com painel e conversa no navegador, acessível pelo notebook e pelo celular. Frontend e API ficam no mesmo projeto Next.js na Vercel; os dados ficam no PostgreSQL do Neon. A conversa é processada durante a própria requisição, sem serviços de automação ou processos permanentes. Interface em português, fuso `America/Bahia` e acesso por senha de um único proprietário.

Os provedores de IA, modelos, chaves, prioridades e limites são cadastrados no próprio painel. A aplicação troca de provedor quando o anterior atinge um limite ou fica indisponível. Comandos básicos continuam funcionando sem nenhuma API de IA cadastrada.

## Testar localmente

Requisito: **Node.js 22.x**, com npm. Na primeira instalação é preciso internet para baixar as dependências.

```bash
./iniciar.sh
```

Abra **http://localhost:3000** e entre com a senha `PANEL_PASSWORD` do arquivo `.env`. Você pode substituí-la por uma senha de sua escolha e reiniciar o servidor. O script cria os segredos iniciais e, em um `.env` existente, acrescenta somente `LLM_ENCRYPTION_KEY` e `CRON_SECRET` quando ainda não estiverem definidos. Valores existentes, inclusive vazios, são preservados.

- O script instala dependências quando necessário.
- Os dados ficam em `.data/local`, preservados entre reinícios. O banco local é PGlite, um PostgreSQL embutido, sem Docker.
- Esse atalho **sempre usa o banco local**, mesmo se o `.env` tiver uma URL Neon. Ele não copia dados para o Neon.
- Use a conversa para criar e organizar tarefas; as alterações aparecem no mesmo painel.
- Encerre com `Ctrl+C`. Para outra porta: `./iniciar.sh 3002`.
- Use o endereço `localhost` mostrado pelo script: a proteção de origem verifica esse endereço.

Alternativa manual:

```bash
npm ci
npm run setup
npm run dev
```

Nesse caso, o banco e o endereço vêm do `.env`; o banco local padrão fica em `.data/agenda`.

## Publicar na Vercel com Neon

1. No Neon, crie um projeto para a agenda ou use o banco que já contém os dados dela. No painel de conexão, selecione **Pooled connection** e copie a URL completa, preservando os parâmetros SSL. O hostname da conexão agrupada contém `-pooler`. [Conexões no Neon](https://neon.com/blog/postgres-support-case-recap).
2. Importe o repositório na Vercel como projeto **Next.js**, com a raiz deste repositório e build `npm run build`. O projeto fixa Node.js `22.x`, versão disponível na Vercel. [Versões do Node.js](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
3. Em **Settings → Environment Variables**, cadastre as variáveis da tabela abaixo para **Production**. Use valores reais, sem os marcadores dos exemplos. `npm run setup` gera os segredos localmente para você copiar de forma privada.
4. Faça o deploy. Se o domínio definitivo só aparecer depois do primeiro deploy, atualize `APP_URL` com esse endereço e faça um **Redeploy** para carregar a alteração.
5. Abra o endereço HTTPS, entre com sua senha e cadastre suas APIs de IA pelo painel. Acesse o mesmo endereço no notebook e no celular: ambos usam os mesmos dados do Neon.

| Variável             | Valor na Vercel                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_MODE`      | `postgres`                                                                                                                      |
| `DATABASE_URL`       | URL de conexão agrupada do Neon, com SSL, como `postgresql://USUARIO:SENHA@SEU_HOST-pooler.neon.tech/SEU_BANCO?sslmode=require` |
| `APP_URL`            | Origem exata do app, como `https://sua-agenda.vercel.app`; sem caminho ou barra final                                           |
| `PANEL_PASSWORD`     | Senha privada para acessar o painel                                                                                             |
| `SESSION_SECRET`     | Segredo aleatório de pelo menos 32 caracteres usado para assinar as sessões                                                     |
| `LLM_ENCRYPTION_KEY` | Chave de 32 bytes: 64 caracteres hexadecimais ou base64; preserve-a entre deploys                                               |
| `CRON_SECRET`        | Segredo aleatório de pelo menos 32 caracteres que autentica a limpeza diária da lixeira                                         |

Nenhuma dessas variáveis usa prefixo `NEXT_PUBLIC_`. As chaves dos provedores de IA são cadastradas no painel e armazenadas criptografadas no banco; não vão para o código nem para as variáveis de ambiente de cada provedor. `LLM_ENCRYPTION_KEY` é a chave do servidor que permite descriptografá-las. Se ela for perdida ou trocada, será necessário cadastrar novamente as chaves das APIs.

Para usar **Preview**, configure também suas variáveis nesse ambiente. Use um banco ou branch Neon de testes e `APP_URL` com a origem exata daquele preview; não reutilize a origem de produção. Alterações de variáveis exigem novo deploy. Esta aplicação permite uma origem por ambiente, então acessar por outro domínio exige ajustar `APP_URL`.

O schema é aplicado de forma idempotente na primeira conexão. Para prepará-lo manualmente, configure `DATABASE_MODE=postgres` e a URL Neon no `.env`, então execute:

```bash
npm run db:migrate
```

Na Vercel, o banco local é bloqueado: configure o Neon antes de usar o app. O filesystem de uma função não serve como armazenamento persistente. Tarefas que você criou em `.data/local` não são transferidas automaticamente para um banco Neon novo.

A estrutura foi preparada para hospedagem na Vercel e no Neon, sujeita às cotas e condições das suas contas. A conexão e o deploy reais precisam ser validados nessas contas. Não é necessário contratar um domínio próprio.

O [vercel.json](vercel.json) habilita **Fluid Compute**. A API permite até 120 segundos por requisição para acomodar tentativas em vários provedores; esse tempo cabe no limite atual de 300 segundos do Hobby com Fluid Compute. [Configuração e limites do Fluid Compute](https://vercel.com/docs/fluid-compute).

## Cadastrar IA e alternar provedores

No menu **Modelos de IA**, clique em **Adicionar modelo** e cadastre um ou mais provedores com:

- Nome para identificação, tipo de API e modelo disponível na sua conta.
- Chave da API. Ao editar, deixe esse campo vazio para manter a chave já salva; ela não é retornada pelo servidor.
- URL completa do endpoint HTTPS público de `chat/completions`, quando usar uma API compatível. Use porta padrão 443, sem parâmetros, fragmentos ou credenciais na URL. O adaptador Gemini usa a API nativa.
- Prioridade: os menores números são tentados primeiro.
- Limites diários de requisições e tokens, além da opção de ativar ou desativar o provedor. No limite de tokens, `0` significa sem limite local.

Você pode adicionar até 20 modelos, do mesmo serviço ou de serviços diferentes. O cadastro fica salvo no banco, sem alteração de código ou novo deploy. A interface mostra uso do dia, falhas e pausa temporária de cada provedor. A API compatível precisa aceitar autenticação Bearer e os campos `model`, `messages`, `max_tokens`, `temperature` e `response_format` com `json_object`.

O fluxo é:

1. Comandos básicos reconhecidos são resolvidos diretamente, sem gastar tokens.
2. Pedidos que precisam de IA usam o primeiro provedor habilitado com orçamento disponível e fora da pausa temporária.
3. Em caso de cota esgotada, erros HTTP `429`/`402` ou falha transitória, o sistema pausa esse provedor e tenta o próximo na mesma mensagem.
4. Cada mensagem tenta no máximo quatro provedores, com orçamento de 85 segundos para as tentativas de IA. Provedores restantes podem ser usados nas próximas mensagens. Se nenhum estiver disponível, a conversa informa a indisponibilidade; nenhuma ação parcial é aplicada.

Se uma IA responder com comandos em formato inválido, o pedido termina sem alterações e pede reformulação; nesse caso não é tentada outra interpretação automaticamente.

Os limites diários usam o fuso `America/Bahia`. O uso de tokens vem dos metadados retornados pela API ou de uma estimativa conservadora quando o provedor não informa o consumo. O limite é verificado antes da chamada, mas uma chamada ainda pode ultrapassar o saldo configurado. **Liberar tentativa** retira a pausa de um provedor sem zerar seu uso diário.

Não existe uma consulta universal ao saldo real de todas as APIs. A troca automática depende dos limites cadastrados, do consumo observado e dos erros devolvidos pelo serviço. APIs ou modelos que compartilham a mesma cota podem ficar indisponíveis juntos. Um limite dentro da agenda não transforma uma API paga em gratuita: confira o plano e os controles de cobrança de cada provedor.

## Lixeira e agendamento

A exclusão de itens com retenção vencida acontece durante o uso da aplicação e também pode rodar sem ninguém abrir o app: [vercel.json](vercel.json) agenda `GET /api/cron/cleanup` diariamente com `0 6 * * *`, às 06:00 UTC (03:00 em `America/Bahia`).

Esse cron é compatível com a frequência diária do plano Hobby, que não garante execução no minuto exato. Ele faz manutenção da lixeira, não envio de lembretes. [Limites do cron da Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Defina `CRON_SECRET` em produção: a Vercel envia automaticamente `Authorization: Bearer SEU_SEGREDO`, que a rota valida. Sem esse segredo, a rota não aceita chamadas; a limpeza durante o uso continua funcionando. No painel da Vercel, confira os logs e a execução em **Cron Jobs** depois do deploy. [Proteção do cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## O que está implementado

- Grupos: criar e renomear; Caixa de entrada para tarefas sem grupo.
- Tarefas: título, descrição, prioridade, situação, data e horário opcionais.
- Filtros: hoje, atrasadas, sem prazo, concluídas e lixeira; busca por título/descrição e paginação.
- Concluir envia à lixeira. Descartar não marca conclusão. Restaurar retorna a pendente.
- Retenção configurável, inicialmente 30 dias. A mudança vale para novas entradas; repetir a conclusão não reinicia o prazo.
- Histórico e desfazer por 24 horas, com detecção de conflito entre painel e conversa. Criar uma lista pode ser desfeito como conjunto. Grupos e configurações não têm desfazer.
- Até dez ações por comando, aplicadas atomicamente. Ambiguidades pedem esclarecimento, sem gravar partes do pedido.
- Referências recentes por conversa por 30 minutos, seleção de tarefas homônimas e continuação por “mostrar mais”.
- Login com cookie HttpOnly, assinatura de sessão, verificação de origem e limite de tentativas.
- Manifesto e ícones para adicionar o webapp à tela inicial nos navegadores compatíveis. O aplicativo depende de internet; não há sincronização offline nem notificações push implementadas.

Áudio, lembretes automáticos, recorrência, etiquetas e contas para vários usuários continuam fora desta versão.

## Comandos básicos sem IA

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

O modo básico reconhece formatos definidos. Para frases fora desses formatos, cadastre uma API de IA. Quando houver tarefas homônimas, responda com o número da opção. Para um grupo inexistente, “criar” confirma a criação e retoma o pedido. Um novo comando claro substitui a pergunta pendente.

## Atualizar a instalação anterior

Execute `npm run setup` para acrescentar os novos segredos ausentes ao `.env`. Na Vercel, cadastre-os também nas variáveis do projeto. Mantenha a mesma conexão com o banco para preservar tarefas, grupos e histórico. A inicialização acrescenta as tabelas de provedores e consumo de IA; não apaga as tabelas antigas de transporte.

A configuração antiga de IA em variáveis `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_API_URL` e `LLM_DAILY_LIMIT` deixou de ser usada. Cadastre novamente os provedores no painel. As configurações de n8n, WAHA, WhatsApp e `INTERNAL_API_TOKEN` também deixaram de ser usadas; podem ser removidas do ambiente. Interrompa os serviços antigos caso ainda estejam rodando. Os workflows e serviços correspondentes foram retirados deste repositório.

[PLANO.md](PLANO.md) fica como registro histórico: a arquitetura ali descrita foi substituída por esta versão.

## Docker local opcional

```bash
npm run setup
docker compose up --build -d app
```

Abra `http://localhost:3000`. Há somente o serviço `app`; o volume `app_data` preserva o banco local. Se o `.env` tiver `DATABASE_MODE=postgres`, o app usa o banco indicado em `DATABASE_URL`. A Vercel não usa esse Compose nem exige Docker.

## Estrutura e verificações

```text
iniciar.sh                    Início rápido para testar localmente
src/app/                      Página, manifesto e API Next.js
src/components/               Painel, conversa e configuração de IA
src/lib/domain.ts             Regras de tarefas, contexto, lixeira e desfazer
src/lib/db.ts                 PostgreSQL/Neon e PGlite
src/lib/schema.ts             Schema idempotente
src/lib/interpreter.ts        Comandos básicos e interpretação com IA
src/lib/service.ts            Execução de ações e limpeza
vercel.json                   Limpeza diária em produção
tests/                        Testes de regras, integração e navegador
```

```bash
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Os testes de integração usam PostgreSQL embutido em memória. Os testes de navegador usam banco temporário separado dos seus dados. Para usar um Chromium já instalado, informe `PLAYWRIGHT_CHROMIUM_EXECUTABLE` com seu caminho. Testes com respostas simuladas de IA não comprovam qualidade de compreensão de um modelo nem disponibilidade ou saldo de uma API real.

Backups: com o servidor local **parado**, copie `.data/local` para um local seguro. No Neon, mantenha backups PostgreSQL (`pg_dump`/`pg_restore`) conforme sua necessidade. Guarde também os segredos do ambiente, especialmente `LLM_ENCRYPTION_KEY`, em local protegido; ela é necessária para recuperar as chaves das APIs guardadas no banco. Backups têm retenção própria. A restauração deve ser validada no ambiente escolhido.
