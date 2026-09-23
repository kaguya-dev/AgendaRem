# Plano de evolução do AgendaMagno

Plano baseado no código atual. As seis etapas abaixo foram implementadas; as caixas marcadas registram o que já está no código e nos testes.

**Falta validar fora do ambiente de desenvolvimento**, nas caixas ainda vazias: microfone real em navegadores de computador e celular (os testes automatizados simulam os eventos de reconhecimento) e a migração financeira com permissões em um PostgreSQL de homologação (aqui ela foi exercitada apenas no PGlite). O uso, os limites e a migração desta entrega estão descritos no `README.md`.

## Segunda rodada, já entregue

Pedidos feitos depois do plano original e já implementados: destaque de urgência e prioridade na lista de tarefas; receitas e despesas somadas separadamente por categoria; mês e ano escolhidos em listas no Financeiro (o `input type="month"` não abre seletor no Firefox); criação de categorias financeiras pela conversa; modelos de lançamento para o que se repete todo mês; aba de anotações soltas com anexos no banco; e o nome na tela trocado para AgendaMagna.

Em aberto nessa rodada: **notificação com o app fechado**. Hoje o lembrete só dispara com a tela aberta. As opções levantadas foram Web Push (chaves VAPID, inscrição por aparelho e um agendador de minuto em minuto — o cron da Vercel roda uma vez por dia e teria de mudar; no iPhone exige o app na tela de início), melhorar o lembrete local (avisar atrasados ao abrir, adiar, concluir pela notificação) ou enviar por fora, via Telegram. A escolha ainda não foi feita.

Também em aberto: anotações e seus arquivos não entram no arquivo de exportação. Incluí-las exige uma versão 3 do backup e um limite de tamanho maior que os 2 MB atuais.

## Ideias que este plano atende

- Enviar várias mensagens no chat sem esperar a resposta: os pedidos ficam em uma fila e são executados um por vez, na ordem de envio.
- Usar comandos de voz para criar tarefas e executar outros pedidos no assistente.
- Ter um espaço para gerenciar receitas e despesas, com dashboards.
- Entender para onde o dinheiro foi: a IA sugere categorias como alimentação, transporte, lazer ou uma categoria personalizada como “besteiras”.
- Ter um espaço acessível para escrever e consultar a descrição das tarefas.

## Ponto de partida e escopo

| Frente               | O que existe hoje                                                                                                        | Entrega proposta                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Descrição de tarefas | Campo no formulário, persistência, busca, edição pela conversa e prévia na lista. A prévia é ocultada em telas pequenas. | Melhorar a descoberta e a leitura, principalmente no celular.                                                 |
| Fila do chat         | O compositor bloqueia novos envios durante o processamento e mantém apenas um pedido pendente para reenvio.              | Permitir novos envios, exibir mensagens em espera e executar automaticamente a próxima após concluir a atual. |
| Voz                  | O assistente recebe texto por `/api/chat`.                                                                               | Ditado no campo de mensagem, com revisão antes de enviar.                                                     |
| Financeiro           | Sem entidades, tela ou comandos financeiros; o interpretador recusa esse assunto.                                        | Lançamentos manuais, categorias, resumo mensal e interpretação de pedidos financeiros.                        |
| IA                   | Provedores com prioridade, limites diários e troca após falha; reescrita opcional da resposta.                           | Reaproveitar essa infraestrutura com contexto específico e poucas chamadas.                                   |

Premissas para a primeira versão: uso pessoal, moeda BRL, datas em `America/Bahia`, registro de valores efetivamente recebidos ou gastos e funcionamento financeiro com internet. Integração bancária, cartões/faturas, parcelamento, investimentos, múltiplas moedas e planejamento de contas futuras ficam para uma expansão. Esse recorte é uma proposta inicial, ajustável conforme a necessidade.

## Ordem de implementação

| Etapa | Resultado                                  | Dependência                  | Porte relativo |
| ----- | ------------------------------------------ | ---------------------------- | -------------- |
| 1     | Descrição fácil de encontrar e consultar   | Nenhuma                      | Pequeno        |
| 2     | Ditado de comandos no assistente           | Fluxo de texto existente     | Médio          |
| 3     | Fila de mensagens do chat                  | Fluxo de texto existente     | Médio          |
| 4     | Cadastro e manutenção de receitas/despesas | Modelo financeiro e migração | Grande         |
| 5     | Dashboard mensal e por categoria           | Etapa 4                      | Médio          |
| 6     | Lançamentos e categorias pela IA           | Etapas 4 e 5                 | Grande         |

As etapas 1, 2 e 3 podem ser entregues separadamente; a fila também deve funcionar apenas com texto digitado. O financeiro deve funcionar pelo formulário antes de depender da interpretação da IA. Depois da etapa 6, o ditado também poderá iniciar pedidos financeiros pelo mesmo fluxo de texto.

## 1. Descrição de tarefas

Reaproveitar o campo existente de até 5.000 caracteres. Não criar outro campo ou uma migração para algo que já está armazenado.

- [x] Manter “Descrição” visível no formulário de criação e edição, com texto de ajuda curto.
- [x] Mostrar um indicador ou uma prévia curta quando a tarefa tiver descrição, inclusive no celular.
- [x] Permitir abrir a descrição completa pelo item da tarefa, preservando quebras de linha e evitando que textos longos ocupem toda a lista.
- [x] Verificar leitura e edição em tarefas ativas, concluídas e na lixeira, respeitando as restrições já existentes.
- [x] Reaproveitar os testes de descrição e acrescentar cobertura apenas para o novo comportamento de visualização.

**Aceite:** criar uma tarefa com descrição, recarregar, localizar pela busca e abrir o texto completo no computador e no celular. Editar o título não pode apagar a descrição. Acrescentar pela conversa deve preservar o texto anterior.

**Arquivos existentes:** `src/frontend/dashboard/TaskDialog.tsx`, `src/frontend/dashboard/index.tsx`, `src/app/globals.css`, `tests/e2e/dashboard.spec.ts` e `tests/domain.test.ts`.

## 2. Comandos de voz

Fluxo inicial: tocar no microfone → falar → revisar ou corrigir a transcrição → enviar. A transcrição preenche o mesmo campo usado para digitar e segue para `/api/chat` somente quando a pessoa envia.

O reconhecimento de fala tem disponibilidade limitada entre navegadores e pode usar processamento remoto. A escolha deve seguir detecção de suporte e validação nos aparelhos usados, conforme a [documentação de SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) e a [especificação Web Speech](https://webaudio.github.io/web-speech-api/).

- [x] Criar um componente/hook de ditado e integrá-lo ao compositor do assistente.
- [x] Usar reconhecimento de fala do navegador em `pt-BR` quando disponível, detectando suporte em tempo de execução.
- [x] Exibir estados de escuta, conclusão e erro; oferecer parar e cancelar. Limitar cada sessão de ditado a 60 segundos.
- [x] Pedir acesso ao microfone ao iniciar a função, preservar o rascunho digitado e limitar o texto final aos 6.000 caracteres aceitos pela API.
- [x] Tratar permissão negada, falta de microfone, ausência de fala, perda de conexão e navegador sem suporte; manter a digitação disponível.
- [x] Evitar duplicar trechos ao receber resultados intermediários ou repetidos. Não truncar e enviar texto excedente sem avisar.
- [x] Encerrar a escuta ao sair da tela. Com a fila da etapa 3, permitir ditar e enviar a próxima mensagem enquanto outra é processada; evitar envio duplicado e atribuir um `requestId` próprio a cada item.
- [x] Não persistir áudio no app. Explicar na interface que o serviço de reconhecimento do navegador pode processá-lo remotamente; não prometer funcionamento offline.
- [ ] Validar em navegadores de computador e celular antes de declarar suporte. Se a cobertura for insuficiente, planejar uma etapa própria de transcrição por API, com captura, limites de upload, custos e descarte do áudio definidos.
- [x] Ajustar ajuda e mensagens de capacidade para distinguir ditado de comandos de envio de arquivos de áudio. O ditado não acrescenta uma chamada de áudio ao Gemini, mas o texto enviado continua consumindo a cota normal do assistente.

**Aceite:** ditar “crie uma tarefa para estudar amanhã”, corrigir o texto e criar apenas uma tarefa ao enviar. Cancelar não executa comandos. Negar permissão ou usar navegador incompatível mantém o assistente por texto utilizável.

**Arquivos:** integrar em `src/frontend/dashboard/Assistant.tsx` e `src/app/globals.css`; criar o componente/hook de voz em `src/frontend/dashboard/`. O contrato textual de `src/app/api/[...path]/route.ts` deve ser reaproveitado nesta etapa.

**Validação:** automatizar eventos de reconhecimento com uma implementação simulada e testar o microfone real manualmente. A simulação não comprova compatibilidade com o serviço de fala do navegador.

## 3. Fila de mensagens do chat

Fluxo esperado: enviar a mensagem A → A começa a executar → enviar B e C enquanto A está em processamento → B e C aparecem como “Em espera” → ao concluir A, executar B automaticamente → ao concluir B, executar C. O campo de texto continua disponível durante todo o fluxo.

- [x] Manter o campo de mensagem e o botão de envio disponíveis durante o processamento; desabilitar envio apenas quando o texto estiver vazio ou inválido. Limpar o campo após adicionar o pedido à fila, permitindo escrever o próximo imediatamente.
- [x] Criar uma fila por conversa, com um único pedido em execução por vez e ordem de chegada (FIFO). Enviar o próximo item a `/api/chat` somente após concluir o anterior, sem precisar de outro clique.
- [x] Mostrar cada mensagem assim que entrar na fila, com estado “Em espera”, “Executando”, “Concluída” ou “Erro”, posição dos itens pendentes e resposta associada ao pedido correto.
- [x] Dar um ID e um `requestId` estáveis a cada item. Um reenvio do mesmo item deve reutilizar seu `requestId`; duas mensagens enviadas intencionalmente, mesmo com texto igual, são pedidos distintos.
- [x] Incorporar a resposta e atualizar o estado da aplicação antes de iniciar o próximo pedido, para que ele considere as alterações realizadas pelo anterior. Não interpretar toda a fila antecipadamente.
- [x] Permitir remover uma mensagem que ainda esteja em espera. Remover um item pendente não cancela o pedido em execução nem desfaz ações já concluídas.
- [x] Em erro, perda de conexão ou cota esgotada, pausar a fila e preservar os itens seguintes. Oferecer tentar novamente ou descartar o item com erro e continuar; não avançar automaticamente quando o resultado do pedido for incerto.
- [x] Se o assistente pedir esclarecimento ou confirmação, pausar a fila. Permitir responder ao pedido atual antes de retomar os itens em espera, sem tratar uma mensagem já enfileirada como resposta à pergunta.
- [x] Na primeira versão, manter a fila apenas na sessão da tela, sem execução em segundo plano após fechar ou recarregar a página. Avisar antes de sair ou limpar a conversa quando houver pedidos pendentes; não prometer que fechar a tela cancela uma ação já enviada ao servidor.
- [x] Manter essa fila separada da fila offline existente. Mensagens em espera não devem ser executadas por dois mecanismos, e finanças continuam exigindo conexão.
- [x] Integrar mensagens digitadas e transcritas pelo mesmo fluxo, respeitando o limite textual de 6.000 caracteres por mensagem.

**Aceite:** enviar A, B e C sem aguardar respostas. Enquanto A executa, B e C ficam visíveis em espera e o campo continua editável. Ao concluir A, B começa automaticamente; depois, C. Nunca há duas chamadas de chat simultâneas nessa conversa. Remover B antes de sua execução faz C seguir A. Falha em A pausa B e C; tentar A novamente não duplica suas ações. Um pedido de esclarecimento pausa a fila até ser resolvido.

**Arquivos:** integrar em `src/frontend/dashboard/Assistant.tsx` e `src/app/globals.css`; extrair o controle da fila para um hook em `src/frontend/dashboard/` se necessário. Reaproveitar o contrato de `/api/chat` e a deduplicação por `requestId`.

## 4. Base financeira e lançamentos manuais

Criar uma área “Financeiro” na navegação, com lista de lançamentos e formulários de receita, despesa e categoria. O cadastro manual deve continuar disponível quando a IA estiver sem cota.

### Dados e regras

| Entidade   | Campos iniciais                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Lançamento | ID, tipo (`income`/`expense`), valor em centavos, data, descrição, categoria, origem, versão, datas de criação/atualização e exclusão lógica. |
| Categoria  | ID, nome, tipo de lançamento aceito, cor/ícone opcionais e estado ativo/arquivado.                                                            |

- [x] Armazenar valores positivos em centavos inteiros, com limites validados. O tipo define entrada ou saída; cálculos não devem usar valores monetários em ponto flutuante.
- [x] Aceitar a escrita brasileira de valores, como `1.234,56`, e validar formato, precisão e limites no servidor.
- [x] Usar data civil para o lançamento e timestamps para auditoria. Sem data informada na conversa, usar o dia da mensagem em `America/Bahia`.
- [x] Criar categorias iniciais editáveis: salário, outras receitas, alimentação, transporte, moradia, saúde, estudos, lazer, compras e sem categoria. Permitir cadastrar “besteiras” ou outro nome escolhido pela pessoa.
- [x] Implementar criar, consultar, editar, excluir e restaurar lançamentos; arquivar categorias em uso preserva os vínculos antigos.
- [x] Impedir duplicação por reenvio com `requestId` e conflitos de edição com versão/revisão. Confirmar exclusão e oferecer restauração pela própria área financeira.
- [x] Registrar alterações financeiras no histórico de operações. Enquanto o desfazer global não souber revertê-las, marcá-las como não reversíveis por esse comando e explicar a alternativa, sem desfazer uma tarefa anterior por engano.

### Integração técnica

- [x] Criar tabelas `agenda_finance_entries` e `agenda_finance_categories`, com índices para período, categoria e lançamentos não excluídos.
- [x] Organizar regras e consultas em um novo módulo `src/backend/finance/`, separado das regras de tarefas.
- [x] Reaproveitar autenticação, verificação de origem, transações e controle de revisão. Evitar carregar o histórico financeiro inteiro em cada atualização de `/api/state`.
- [x] Adicionar consultas paginadas e ações financeiras no roteador existente, com filtros validados no servidor.
- [x] Integrar a navegação por `src/frontend/dashboard/types.ts` e `src/frontend/dashboard/index.tsx`, mantendo telas financeiras em componentes próprios.
- [x] Atualizar `src/backend/schema.ts`, a integração de migração em `src/backend/db.ts`, `scripts/migrate.ts`, permissões de `scripts/runtime-role.sql` e verificações de `scripts/deploy-check.ts` conforme necessário.
- [x] Manter os dados financeiros fora da fila e do cache offline atuais nesta primeira versão, com estado claro de indisponibilidade quando não houver conexão.
- [x] Evoluir o backup para versão 2 com categorias e lançamentos. Continuar aceitando versão 1; restaurar um arquivo antigo deve preservar o financeiro existente. A prévia de restauração da versão 2 deve informar quais dados financeiros serão substituídos.
- [x] Validar referências, valores, duplicatas e revisão na importação; atualizar também `BackupDialog.tsx`, que hoje aceita somente versão 1. Restaurar dados de forma atômica e invalidar interpretações em andamento sobre dados substituídos.

**Aceite:** registrar receita de R$ 3.000,00 e despesa de R$ 42,90, recarregar e encontrar os mesmos dados. Editar, excluir e restaurar deve produzir o resultado esperado sem duplicação. Reaplicar a migração deve preservar os dados anteriores, tanto no PGlite quanto no PostgreSQL.

## 5. Dashboards financeiros

- [x] Mostrar seletor de mês e cartões de receitas, despesas e resultado do período (`receitas − despesas`). Identificar esse resultado como mensal, sem apresentá-lo como saldo de uma conta bancária.
- [x] Exibir gastos por categoria, com valores e participação percentual; “sem categoria” precisa aparecer para que o total feche.
- [x] Mostrar evolução de receitas e despesas por dia e comparação com o mês anterior.
- [x] Permitir abrir os lançamentos ao selecionar uma categoria e filtrar por período, tipo e categoria.
- [x] Calcular totais e agrupamentos no backend, sempre com o mesmo conjunto de filtros da lista. Lançamentos excluídos não entram nos números.
- [x] Renderizar gráficos com rótulos e tabela/lista equivalente; não depender apenas de cores. Tratar mês vazio, resultado negativo e comparação sem base anterior.
- [x] Atualizar os dados após criar, editar, excluir, restaurar ou importar, sem chamadas à IA para montar o dashboard.

**Aceite:** com a receita e a despesa do exemplo anterior, o resultado mensal deve ser R$ 2.957,10. A soma das categorias deve coincidir com as despesas. Mudar categoria, mês ou exclusão deve refletir nos gráficos e nos cartões, inclusive no celular.

## 6. Interpretação financeira e categorias pela IA

Exemplos de comportamento esperado:

| Mensagem                             | Resultado                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| “Gastei 42,90 no almoço hoje”        | Despesa de R$ 42,90, data de hoje e sugestão de alimentação.                         |
| “Recebi 3 mil de salário ontem”      | Receita de R$ 3.000,00, data de ontem e categoria salário.                           |
| “Gastei 80 em besteiras”             | Usar a categoria “besteiras” se cadastrada; permitir revisão da categoria escolhida. |
| “Quanto gastei com comida este mês?” | Consultar os lançamentos e calcular o total no servidor.                             |
| “Gastei no mercado”                  | Pedir o valor antes de registrar.                                                    |

- [x] Definir comandos financeiros explícitos e schemas validados para criar, editar, excluir/restaurar e consultar lançamentos. IDs e categorias devolvidos pelo modelo precisam existir e ser compatíveis com a operação.
- [x] Extrair tipo, valor, data, descrição e categoria na mesma chamada de interpretação; não fazer uma chamada extra só para categorizar cada lançamento.
- [x] Priorizar a categoria dita pela pessoa. Quando faltar contexto para classificar, usar “sem categoria” e permitir correção; nunca inventar valor ou estabelecimento.
- [x] Para ambiguidades que impedem execução, como valor ausente ou lançamento não identificado, reaproveitar o fluxo de esclarecimento antes de gravar.
- [x] Montar contexto específico para tarefas ou finanças. Pedidos financeiros simples recebem categorias e contexto recente relevante; não recebem todas as tarefas nem todo o extrato. Evitar uma chamada adicional apenas para decidir o assunto.
- [x] Para pedidos mistos, validar todas as ações antes de executar e manter gravação atômica. Se alguma parte estiver ambígua ou não for suportada, pedir esclarecimento sem aplicar as demais.
- [x] Atualizar `src/backend/interpreter.ts`, schemas de comandos, fluxo de execução de `src/backend/service.ts`, ajuda e exemplos. Retirar a recusa genérica de “finanças” apenas para as operações já implementadas.
- [x] Reaproveitar a troca de provedores e os limites existentes. Erro de IA ou cota não pode gerar lançamento parcial nem bloquear o formulário manual.
- [x] Gerar confirmações financeiras diretamente a partir dos dados gravados, com valor, data e categoria; evitar a segunda chamada de reescrita para essas respostas. O backend calcula somas e percentuais.
- [x] Nas correções de categoria, guardar a alteração no lançamento. Regras recorrentes por estabelecimento podem ser uma evolução posterior, sem prometer aprendizado automático nesta entrega.

**Aceite:** texto digitado e texto vindo do ditado produzem o mesmo comando. A categoria pode ser corrigida pelo painel. Valores e totais mostrados coincidem com o banco. Reenviar o mesmo pedido não duplica a despesa; cota esgotada mantém a alternativa manual disponível.

## Verificação e conclusão de cada entrega

- [x] Executar `npm run typecheck` e os testes pertinentes às regras alteradas; antes de integrar cada entrega, executar `npm test` e `npm run build` em Node.js 22.x.
- [x] Descrição: aproveitar os testes atuais e verificar a nova visualização móvel com Playwright.
- [ ] Voz: cobrir transcrição, cancelamento, permissão negada, ausência de suporte, preservação de rascunho e envio único; complementar com teste real no computador e no celular.
- [x] Fila do chat: simular respostas demoradas e verificar envio durante processamento, ordem FIFO, apenas uma requisição ativa, associação de respostas, remoção de pendentes, pausa por erro/esclarecimento e reenvio sem duplicação.
- [x] Financeiro: testar centavos, valores inválidos, datas, filtros, somas, categorias arquivadas, exclusão/restauração, duplicação e edição concorrente.
- [x] IA: simular respostas válidas/inválidas, categorias inexistentes, pedido incompleto, pedido misto e troca de provedor após HTTP 429, sem gastar cota nos testes automatizados.
- [x] Backup: testar importação das versões 1 e 2, preservação do financeiro ao importar versão 1 e reversão completa da transação quando o arquivo for inválido.
- [ ] Validar migrações e permissões em bancos de teste local e PostgreSQL antes de aplicar em produção.
- [x] Atualizar `README.md` a cada funcionalidade entregue, incluindo uso, limitações reais e migração quando necessária.

Primeira entrega recomendada: concluir a etapa 1, adicionar o ditado da etapa 2 e a fila de mensagens da etapa 3, que podem ser entregues separadamente. A segunda entrega reúne financeiro manual e dashboards; a terceira integra a IA ao financeiro.
