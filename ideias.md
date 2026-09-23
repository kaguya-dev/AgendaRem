# Plano de evolução do AgendaMagno

Plano baseado no código atual. As caixas abaixo representam trabalho futuro; este documento não implementa as funcionalidades.

## Ideias que este plano atende

- Usar comandos de voz para criar tarefas e executar outros pedidos no assistente.
- Ter um espaço para gerenciar receitas e despesas, com dashboards.
- Entender para onde o dinheiro foi: a IA sugere categorias como alimentação, transporte, lazer ou uma categoria personalizada como “besteiras”.
- Ter um espaço acessível para escrever e consultar a descrição das tarefas.

## Ponto de partida e escopo

| Frente | O que existe hoje | Entrega proposta |
| --- | --- | --- |
| Descrição de tarefas | Campo no formulário, persistência, busca, edição pela conversa e prévia na lista. A prévia é ocultada em telas pequenas. | Melhorar a descoberta e a leitura, principalmente no celular. |
| Voz | O assistente recebe texto por `/api/chat`. | Ditado no campo de mensagem, com revisão antes de enviar. |
| Financeiro | Sem entidades, tela ou comandos financeiros; o interpretador recusa esse assunto. | Lançamentos manuais, categorias, resumo mensal e interpretação de pedidos financeiros. |
| IA | Provedores com prioridade, limites diários e troca após falha; reescrita opcional da resposta. | Reaproveitar essa infraestrutura com contexto específico e poucas chamadas. |

Premissas para a primeira versão: uso pessoal, moeda BRL, datas em `America/Bahia`, registro de valores efetivamente recebidos ou gastos e funcionamento financeiro com internet. Integração bancária, cartões/faturas, parcelamento, investimentos, múltiplas moedas e planejamento de contas futuras ficam para uma expansão. Esse recorte é uma proposta inicial, ajustável conforme a necessidade.

## Ordem de implementação

| Etapa | Resultado | Dependência | Porte relativo |
| --- | --- | --- | --- |
| 1 | Descrição fácil de encontrar e consultar | Nenhuma | Pequeno |
| 2 | Ditado de comandos no assistente | Fluxo de texto existente | Médio |
| 3 | Cadastro e manutenção de receitas/despesas | Modelo financeiro e migração | Grande |
| 4 | Dashboard mensal e por categoria | Etapa 3 | Médio |
| 5 | Lançamentos e categorias pela IA | Etapas 3 e 4 | Grande |

As etapas 1 e 2 podem ser entregues separadamente. O financeiro deve funcionar pelo formulário antes de depender da interpretação da IA. Depois da etapa 5, o ditado também poderá iniciar pedidos financeiros pelo mesmo fluxo de texto.

## 1. Descrição de tarefas

Reaproveitar o campo existente de até 5.000 caracteres. Não criar outro campo ou uma migração para algo que já está armazenado.

- [ ] Manter “Descrição” visível no formulário de criação e edição, com texto de ajuda curto.
- [ ] Mostrar um indicador ou uma prévia curta quando a tarefa tiver descrição, inclusive no celular.
- [ ] Permitir abrir a descrição completa pelo item da tarefa, preservando quebras de linha e evitando que textos longos ocupem toda a lista.
- [ ] Verificar leitura e edição em tarefas ativas, concluídas e na lixeira, respeitando as restrições já existentes.
- [ ] Reaproveitar os testes de descrição e acrescentar cobertura apenas para o novo comportamento de visualização.

**Aceite:** criar uma tarefa com descrição, recarregar, localizar pela busca e abrir o texto completo no computador e no celular. Editar o título não pode apagar a descrição. Acrescentar pela conversa deve preservar o texto anterior.

**Arquivos existentes:** `src/frontend/dashboard/TaskDialog.tsx`, `src/frontend/dashboard/index.tsx`, `src/app/globals.css`, `tests/e2e/dashboard.spec.ts` e `tests/domain.test.ts`.

## 2. Comandos de voz

Fluxo inicial: tocar no microfone → falar → revisar ou corrigir a transcrição → enviar. A transcrição preenche o mesmo campo usado para digitar e segue para `/api/chat` somente quando a pessoa envia.

O reconhecimento de fala tem disponibilidade limitada entre navegadores e pode usar processamento remoto. A escolha deve seguir detecção de suporte e validação nos aparelhos usados, conforme a [documentação de SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) e a [especificação Web Speech](https://webaudio.github.io/web-speech-api/).

- [ ] Criar um componente/hook de ditado e integrá-lo ao compositor do assistente.
- [ ] Usar reconhecimento de fala do navegador em `pt-BR` quando disponível, detectando suporte em tempo de execução.
- [ ] Exibir estados de escuta, conclusão e erro; oferecer parar e cancelar. Limitar cada sessão de ditado a 60 segundos.
- [ ] Pedir acesso ao microfone ao iniciar a função, preservar o rascunho digitado e limitar o texto final aos 6.000 caracteres aceitos pela API.
- [ ] Tratar permissão negada, falta de microfone, ausência de fala, perda de conexão e navegador sem suporte; manter a digitação disponível.
- [ ] Evitar duplicar trechos ao receber resultados intermediários ou repetidos. Não truncar e enviar texto excedente sem avisar.
- [ ] Encerrar a escuta ao sair da tela e impedir iniciar ditado durante um pedido em processamento; evitar envio duplicado, reaproveitando `requestId` e os estados existentes.
- [ ] Não persistir áudio no app. Explicar na interface que o serviço de reconhecimento do navegador pode processá-lo remotamente; não prometer funcionamento offline.
- [ ] Validar em navegadores de computador e celular antes de declarar suporte. Se a cobertura for insuficiente, planejar uma etapa própria de transcrição por API, com captura, limites de upload, custos e descarte do áudio definidos.
- [ ] Ajustar ajuda e mensagens de capacidade para distinguir ditado de comandos de envio de arquivos de áudio. O ditado não acrescenta uma chamada de áudio ao Gemini, mas o texto enviado continua consumindo a cota normal do assistente.

**Aceite:** ditar “crie uma tarefa para estudar amanhã”, corrigir o texto e criar apenas uma tarefa ao enviar. Cancelar não executa comandos. Negar permissão ou usar navegador incompatível mantém o assistente por texto utilizável.

**Arquivos:** integrar em `src/frontend/dashboard/Assistant.tsx` e `src/app/globals.css`; criar o componente/hook de voz em `src/frontend/dashboard/`. O contrato textual de `src/app/api/[...path]/route.ts` deve ser reaproveitado nesta etapa.

**Validação:** automatizar eventos de reconhecimento com uma implementação simulada e testar o microfone real manualmente. A simulação não comprova compatibilidade com o serviço de fala do navegador.

## 3. Base financeira e lançamentos manuais

Criar uma área “Financeiro” na navegação, com lista de lançamentos e formulários de receita, despesa e categoria. O cadastro manual deve continuar disponível quando a IA estiver sem cota.

### Dados e regras

| Entidade | Campos iniciais |
| --- | --- |
| Lançamento | ID, tipo (`income`/`expense`), valor em centavos, data, descrição, categoria, origem, versão, datas de criação/atualização e exclusão lógica. |
| Categoria | ID, nome, tipo de lançamento aceito, cor/ícone opcionais e estado ativo/arquivado. |

- [ ] Armazenar valores positivos em centavos inteiros, com limites validados. O tipo define entrada ou saída; cálculos não devem usar valores monetários em ponto flutuante.
- [ ] Aceitar a escrita brasileira de valores, como `1.234,56`, e validar formato, precisão e limites no servidor.
- [ ] Usar data civil para o lançamento e timestamps para auditoria. Sem data informada na conversa, usar o dia da mensagem em `America/Bahia`.
- [ ] Criar categorias iniciais editáveis: salário, outras receitas, alimentação, transporte, moradia, saúde, estudos, lazer, compras e sem categoria. Permitir cadastrar “besteiras” ou outro nome escolhido pela pessoa.
- [ ] Implementar criar, consultar, editar, excluir e restaurar lançamentos; arquivar categorias em uso preserva os vínculos antigos.
- [ ] Impedir duplicação por reenvio com `requestId` e conflitos de edição com versão/revisão. Confirmar exclusão e oferecer restauração pela própria área financeira.
- [ ] Registrar alterações financeiras no histórico de operações. Enquanto o desfazer global não souber revertê-las, marcá-las como não reversíveis por esse comando e explicar a alternativa, sem desfazer uma tarefa anterior por engano.

### Integração técnica

- [ ] Criar tabelas `agenda_finance_entries` e `agenda_finance_categories`, com índices para período, categoria e lançamentos não excluídos.
- [ ] Organizar regras e consultas em um novo módulo `src/backend/finance/`, separado das regras de tarefas.
- [ ] Reaproveitar autenticação, verificação de origem, transações e controle de revisão. Evitar carregar o histórico financeiro inteiro em cada atualização de `/api/state`.
- [ ] Adicionar consultas paginadas e ações financeiras no roteador existente, com filtros validados no servidor.
- [ ] Integrar a navegação por `src/frontend/dashboard/types.ts` e `src/frontend/dashboard/index.tsx`, mantendo telas financeiras em componentes próprios.
- [ ] Atualizar `src/backend/schema.ts`, a integração de migração em `src/backend/db.ts`, `scripts/migrate.ts`, permissões de `scripts/runtime-role.sql` e verificações de `scripts/deploy-check.ts` conforme necessário.
- [ ] Manter os dados financeiros fora da fila e do cache offline atuais nesta primeira versão, com estado claro de indisponibilidade quando não houver conexão.
- [ ] Evoluir o backup para versão 2 com categorias e lançamentos. Continuar aceitando versão 1; restaurar um arquivo antigo deve preservar o financeiro existente. A prévia de restauração da versão 2 deve informar quais dados financeiros serão substituídos.
- [ ] Validar referências, valores, duplicatas e revisão na importação; atualizar também `BackupDialog.tsx`, que hoje aceita somente versão 1. Restaurar dados de forma atômica e invalidar interpretações em andamento sobre dados substituídos.

**Aceite:** registrar receita de R$ 3.000,00 e despesa de R$ 42,90, recarregar e encontrar os mesmos dados. Editar, excluir e restaurar deve produzir o resultado esperado sem duplicação. Reaplicar a migração deve preservar os dados anteriores, tanto no PGlite quanto no PostgreSQL.

## 4. Dashboards financeiros

- [ ] Mostrar seletor de mês e cartões de receitas, despesas e resultado do período (`receitas − despesas`). Identificar esse resultado como mensal, sem apresentá-lo como saldo de uma conta bancária.
- [ ] Exibir gastos por categoria, com valores e participação percentual; “sem categoria” precisa aparecer para que o total feche.
- [ ] Mostrar evolução de receitas e despesas por dia e comparação com o mês anterior.
- [ ] Permitir abrir os lançamentos ao selecionar uma categoria e filtrar por período, tipo e categoria.
- [ ] Calcular totais e agrupamentos no backend, sempre com o mesmo conjunto de filtros da lista. Lançamentos excluídos não entram nos números.
- [ ] Renderizar gráficos com rótulos e tabela/lista equivalente; não depender apenas de cores. Tratar mês vazio, resultado negativo e comparação sem base anterior.
- [ ] Atualizar os dados após criar, editar, excluir, restaurar ou importar, sem chamadas à IA para montar o dashboard.

**Aceite:** com a receita e a despesa do exemplo anterior, o resultado mensal deve ser R$ 2.957,10. A soma das categorias deve coincidir com as despesas. Mudar categoria, mês ou exclusão deve refletir nos gráficos e nos cartões, inclusive no celular.

## 5. Interpretação financeira e categorias pela IA

Exemplos de comportamento esperado:

| Mensagem | Resultado |
| --- | --- |
| “Gastei 42,90 no almoço hoje” | Despesa de R$ 42,90, data de hoje e sugestão de alimentação. |
| “Recebi 3 mil de salário ontem” | Receita de R$ 3.000,00, data de ontem e categoria salário. |
| “Gastei 80 em besteiras” | Usar a categoria “besteiras” se cadastrada; permitir revisão da categoria escolhida. |
| “Quanto gastei com comida este mês?” | Consultar os lançamentos e calcular o total no servidor. |
| “Gastei no mercado” | Pedir o valor antes de registrar. |

- [ ] Definir comandos financeiros explícitos e schemas validados para criar, editar, excluir/restaurar e consultar lançamentos. IDs e categorias devolvidos pelo modelo precisam existir e ser compatíveis com a operação.
- [ ] Extrair tipo, valor, data, descrição e categoria na mesma chamada de interpretação; não fazer uma chamada extra só para categorizar cada lançamento.
- [ ] Priorizar a categoria dita pela pessoa. Quando faltar contexto para classificar, usar “sem categoria” e permitir correção; nunca inventar valor ou estabelecimento.
- [ ] Para ambiguidades que impedem execução, como valor ausente ou lançamento não identificado, reaproveitar o fluxo de esclarecimento antes de gravar.
- [ ] Montar contexto específico para tarefas ou finanças. Pedidos financeiros simples recebem categorias e contexto recente relevante; não recebem todas as tarefas nem todo o extrato. Evitar uma chamada adicional apenas para decidir o assunto.
- [ ] Para pedidos mistos, validar todas as ações antes de executar e manter gravação atômica. Se alguma parte estiver ambígua ou não for suportada, pedir esclarecimento sem aplicar as demais.
- [ ] Atualizar `src/backend/interpreter.ts`, schemas de comandos, fluxo de execução de `src/backend/service.ts`, ajuda e exemplos. Retirar a recusa genérica de “finanças” apenas para as operações já implementadas.
- [ ] Reaproveitar a troca de provedores e os limites existentes. Erro de IA ou cota não pode gerar lançamento parcial nem bloquear o formulário manual.
- [ ] Gerar confirmações financeiras diretamente a partir dos dados gravados, com valor, data e categoria; evitar a segunda chamada de reescrita para essas respostas. O backend calcula somas e percentuais.
- [ ] Nas correções de categoria, guardar a alteração no lançamento. Regras recorrentes por estabelecimento podem ser uma evolução posterior, sem prometer aprendizado automático nesta entrega.

**Aceite:** texto digitado e texto vindo do ditado produzem o mesmo comando. A categoria pode ser corrigida pelo painel. Valores e totais mostrados coincidem com o banco. Reenviar o mesmo pedido não duplica a despesa; cota esgotada mantém a alternativa manual disponível.

## Verificação e conclusão de cada entrega

- [ ] Executar `npm run typecheck` e os testes pertinentes às regras alteradas; antes de integrar cada entrega, executar `npm test` e `npm run build` em Node.js 22.x.
- [ ] Descrição: aproveitar os testes atuais e verificar a nova visualização móvel com Playwright.
- [ ] Voz: cobrir transcrição, cancelamento, permissão negada, ausência de suporte, preservação de rascunho e envio único; complementar com teste real no computador e no celular.
- [ ] Financeiro: testar centavos, valores inválidos, datas, filtros, somas, categorias arquivadas, exclusão/restauração, duplicação e edição concorrente.
- [ ] IA: simular respostas válidas/inválidas, categorias inexistentes, pedido incompleto, pedido misto e troca de provedor após HTTP 429, sem gastar cota nos testes automatizados.
- [ ] Backup: testar importação das versões 1 e 2, preservação do financeiro ao importar versão 1 e reversão completa da transação quando o arquivo for inválido.
- [ ] Validar migrações e permissões em bancos de teste local e PostgreSQL antes de aplicar em produção.
- [ ] Atualizar `README.md` a cada funcionalidade entregue, incluindo uso, limitações reais e migração quando necessária.

Primeira entrega recomendada: concluir a etapa 1 e adicionar o ditado da etapa 2. A segunda entrega reúne financeiro manual e dashboards; a terceira integra a IA ao financeiro.
