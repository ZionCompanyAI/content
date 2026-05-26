# Em 35 dias, construímos um sistema que se constrói sozinho

*Por Toni Ribeiro, fundador e CEO da ZionCompanyAI — Maio de 2026*

---

Existe um momento específico no desenvolvimento de software em que você percebe que a ferramenta que você construiu começou a trabalhar para você — e não o contrário. Para nós, esse momento aconteceu numa noite comum de maio de 2026, quando abri o Telegram, enviei uma mensagem descrevendo uma feature, e fui dormir. Quando acordei, a feature estava em produção.

Não havia nenhum desenvolvedor humano acordado. Não havia ninguém monitorando CI. Não havia ninguém aprovando o Pull Request. A máquina tinha feito tudo: implementado, testado, revisado, mergeado e deployado — sozinha.

Isso não aconteceu do nada. Levou 35 dias, muita iteração, bugs frustrantes e uma série de decisões arquiteturais que só fizeram sentido depois que falhamos da maneira certa. Esta é a história dessa construção.

---

## O problema original: agentes são poderosos, mas desordenados

Em março de 2026, a ZionCompanyAI já usava Claude Code intensivamente para desenvolvimento dos nossos produtos — ZionEcho, ZSocialMedia, MLPublishPro, PicSyncPro. Mas havia um problema crescente: cada sessão de desenvolvimento era uma ilha.

Um agente Claude Code não sabe o que o outro fez ontem. Não há memória compartilhada. Não há coordenação. Se você abre duas sessões ao mesmo tempo, elas podem conflitar. Se você quer que um agente monitore CI enquanto outro implementa, não existe protocolo nativo para isso.

Além disso, os agentes Claude Code precisam de credenciais — e OAuth credentials do Claude.ai expiram e precisam ser renovadas manualmente. Toda vez que uma sessão caia ou expirasse, alguém precisava refazer o login. Em escala, isso era insustentável.

O modelo mental que eu precisava não era "um agente por vez" — era uma **orquestra**. Agentes com papéis definidos, memória compartilhada, comunicação real-time, e um maestro que coordenasse tudo.

Então, em 21 de abril de 2026, começamos a construir o Mission Control.

---

## A primeira versão: o que funcionou e o que não funcionou

A v1 foi honesta na sua simplicidade. Um servidor FastAPI rodando na Railway com um banco PostgreSQL. Agentes podiam se registrar, receber tarefas, e reportar status. Toni (eu) disparava os agentes manualmente via curl ou pelo próprio Claude Code em sessão interativa.

O que funcionou imediatamente: a ideia de ter um **registro central**. Saber quais agentes estavam ativos, quais estavam processando o quê, e poder enviar comandos para eles — isso já era infinitamente melhor do que sessões isoladas.

O que não funcionou: a comunicação era baseada em polling. Cada agente ficava perguntando ao servidor "tem algo novo para mim?" a cada N segundos. Isso era lento, ineficiente, e criava race conditions. Dois agentes podiam pegar a mesma tarefa. Um agente podia perder um evento enquanto estava processando outro.

Mas o problema maior da v1 era filosófico: ela ainda dependia de input humano para quase tudo. Toni precisava disparar os agentes. Toni precisava monitorar. Toni precisava decidir o que ia para produção.

A v1 era um painel de controle. Não era autonomia.

---

## A arquitetura que emergiu: por que cada decisão importou

A v2 e a v3 foram construídas iterativamente, e cada componente surgiu de uma necessidade real — não de um design upfront idealizado. Vou explicar cada camada e por que ela existe.

### SSE em vez de polling: a virada de comunicação

A primeira grande decisão arquitetural da v2 foi abandonar polling e adotar **Server-Sent Events (SSE)**. O orquestrador abre uma conexão persistente com cada agente e empurra eventos quando eles acontecem — tarefas delegadas, resultados de debates, atualizações de credenciais OAuth.

Por que isso importa? Porque com SSE, a latência cai de "até N segundos" para "milissegundos". E mais importante: o orquestrador tem controle sobre o que cada agente sabe e quando sabe. Não é o agente que decide quando checar — é o sistema que decide quando notificar.

Isso também resolveu o problema de credenciais OAuth. Quando um token é renovado, o orquestrador propaga automaticamente via SSE para todos os agentes ativos. Nenhum agente fica com credenciais expiradas. O operador humano renova uma vez — a rede inteira se atualiza.

### Agentes efêmeros como Railway services

Na v3, agentes não são processos persistentes em uma máquina — são **Railway services criados on-demand**. Quando uma tarefa chega, o orquestrador provisiona um container Railway com SSH TCP proxy, inicia o Claude Code via `claude --print`, e destrói o container ao final.

Por que isso? Porque Railway oferece isolamento, escalabilidade horizontal, e não precisa de máquinas dedicadas. Cada agente tem seu próprio ambiente limpo. Falhas de um agente não afetam os outros. E o custo é proporcional ao uso — não pagamos por agentes ociosos.

O SSH TCP proxy foi a solução elegante para um problema específico do Railway: containers não têm IP fixo e não se comunicam facilmente com o exterior. Com SSH proxy, o orquestrador consegue injetar comandos no container e ler outputs em tempo real.

### pgvector para memória semântica

Um dos problemas mais insidiosos com agentes Claude é que eles esquecem. Cada sessão começa do zero, a menos que você injete contexto manualmente.

A solução foi usar **pgvector** — extensão do PostgreSQL para embeddings vetoriais — para persistir memórias semânticas. Quando um agente aprende algo relevante (uma decisão arquitetural, um padrão de bug recorrente, uma preferência do usuário), essa memória é embedada e armazenada. Na próxima sessão, o agente faz uma busca semântica por contexto relevante antes de agir.

Isso não é memória perfeita — embeddings têm ruído, e retrieval às vezes traz contexto incorreto. Mas é imensamente melhor do que zero memória. E melhora com o tempo à medida que o volume de memórias cresce.

### Circuit breakers: porque o mundo externo falha

O MC integra com Telegram (para comunicação com Toni), Railway API (para gerenciar containers), e Anthropic API (para os agentes). Qualquer uma dessas integrações pode falhar — rate limits, timeouts, indisponibilidade temporária.

Sem circuit breakers, uma falha na Railway API poderia colocar o orquestrador em loop infinito de retries, consumindo tokens e bloqueando outras operações. Com circuit breakers, após N falhas consecutivas, o circuito "abre" e requests são rejeitados imediatamente por um período — dando tempo para o serviço externo se recuperar.

É um padrão de resiliência clássico de microsserviços, aplicado a um orquestrador de agentes AI. Funcionou.

### Contratos formais com Harness Engineering

Essa foi uma das adições mais impactantes na maturidade do sistema: o **Harness Engineering**.

Antes de qualquer implementação, o agente implementador é obrigado a executar `harness propose` — definindo os critérios de aceite como comandos bash concretos. "O endpoint `/agents` deve retornar 200 com lista não-vazia" é um critério válido. "A feature deve funcionar bem" não é.

Após a implementação, `harness validate` executa esses critérios automaticamente. Se algum falhar, o agente tenta corrigir — até 3 tentativas antes de escalar para revisão humana. Os contratos são persistidos no banco de dados e sobrevivem a redeployments.

Isso criou uma camada de qualidade que independe de qualquer agente específico. Um agente validator pode verificar o trabalho de um agente implementador sem saber nada sobre o contexto da tarefa — apenas executando os comandos definidos no contrato.

---

## Quando vários agentes pensam juntos

Até aqui falei de agentes como unidades isoladas que recebem tarefas e as executam. Mas o Mission Control é algo mais do que isso — e entender essa distinção é talvez a parte mais importante desta história.

O MC não é um único agente. É um **ecossistema de agentes simultâneos**, cada um com papel, ferramentas e responsabilidades distintas, todos se comunicando em tempo real.

### O elenco permanente

Em produção, vários agentes rodam em paralelo com funções fixas:

**Cláudia** é o daemon Telegram — o personagem mais visível do sistema. Ela recebe cada mensagem que Toni envia, interpreta a intenção, decide como rotear, monitora PRs, verifica CI e aprova merges. O que Cláudia *não* faz é implementar código de produto. Essa é uma restrição deliberada, aprendida da forma difícil: um agente que implementa *e* aprova seus próprios PRs é um risco de qualidade. Cláudia coordena. Quem implementa é outro.

**devsr-mc** é o developer agent que roda como container Railway. Ele vive no ecossistema da Railway — efêmero, isolado, descartável. Pega issues do GitHub, navega pelo codebase, implementa, faz commit, abre PR. Quando termina, o container morre.

**devsr-oc01** é o developer agent que roda em `toni-OC01`, a máquina física de desenvolvimento. Sem timeout de container, sem restrições de Railway. Para features que exigem processamento pesado, contexto longo ou iteração profunda no codebase — ele é o escolhido. É o mesmo Claude, mas em hardware que não mente sobre quanto tempo pode trabalhar.

**toni-OC01:merge** é um cron de merge que roda na máquina física. Ele verifica PRs com `CHANGES_REQUESTED`, analisa o feedback, decide se a correção está completa, e — quando está — aprova e mergea. Uma tarefa pequena, mas crítica: sem ele, PRs que precisam de iteração ficam travados esperando atenção humana.

Além desses, existem os **agentes efêmeros**: spawned para tarefas específicas — um batch de análise, uma migração, uma auditoria de segurança — e destruídos quando a tarefa termina. A Railway cuida do ciclo de vida; o MC cuida da orquestração.

### Debates A2A: quando agentes discordam

Um dos aspectos mais incomuns do MC é que agentes podem **debater entre si** antes de uma decisão ser tomada.

O mecanismo é simples em protocolo, mas poderoso em efeito. Quando Cláudia precisa de uma decisão que envolve trade-offs não-óbvios — "devemos implementar essa feature agora ou esperar a refatoração de infraestrutura?" — ela pode abrir uma sala de debate via `POST /debate/rooms`. Os agentes relevantes recebem o convite via SSE, analisam o problema de suas perspectivas especializadas, e postam suas posições.

O sistema tabula os votos, detecta consenso ou divergência, e ou conclui automaticamente (quando há maioria clara) ou escala para decisão humana (quando os agentes estão genuinamente divididos). `POST /debate/{id}/conclude` fecha a sala e registra a decisão no histórico.

Isso vai além de um LLM respondendo a um prompt. São múltiplas perspectivas — implementador, validator, coordenadora — convergindo sobre um problema antes que qualquer linha de código seja escrita. Em alguns casos, o debate mudou completamente a abordagem de uma feature. O implementador propôs A, o validator apontou que A quebraria uma invariante existente, e a solução final foi C, que nenhum dos dois havia considerado inicialmente.

### Routing por especialidade: zero colisão, carga distribuída

Quando uma tarefa precisa ser delegada, o MC não escolhe um agente aleatoriamente. Ele calcula uma tupla de priorização: `(specialty_penalty, is_busy, queued_count)` para cada agente candidato.

`specialty_penalty` é zero quando o agente tem experiência documentada naquele tipo de tarefa e aumenta proporcionalmente ao mismatch. `is_busy` garante que agentes ocupados nunca são interrompidos — a tarefa entra na fila deles e é entregue quando terminam o trabalho atual. `queued_count` distribui carga: se dois agentes têm a mesma especialidade e ambos estão livres, a tarefa vai para o com menos itens na fila.

O resultado prático: duas tarefas nunca colidem no mesmo agente, a carga se distribui automaticamente, e agentes especializados fazem o trabalho para o qual foram otimizados. O claim atômico via banco de dados garante que não existem race conditions — se dois workers tentarem pegar a mesma tarefa simultaneamente, apenas um vence e o outro recebe 409 Conflict e busca outra.

### A separação que emergiu organicamente

A divisão de papéis que existe hoje não foi planejada em whiteboard. Ela emergiu.

No início, qualquer agente podia fazer qualquer coisa. Um agente implementava, aprovava o próprio PR, fazia merge. Rápido — mas frágil. A ausência de revisão independente gerava regressões que às vezes levavam horas para diagnosticar.

Com o tempo, estabelecemos restrições via denylist de ferramentas por agente. Cláudia não tem acesso a `git commit`. DevSrs não têm acesso direto ao Telegram. O validator não conhece o contexto de implementação — apenas os critérios de aceite formalizados no contrato Harness.

Cada agente ver apenas o que precisa para sua função. Essa separação tem um nome em segurança de sistemas: *least privilege*. Mas em sistemas multi-agente, ela tem um efeito adicional: cria verificação independente genuína. O validator não pode ser influenciado pela narrativa do implementador porque ele simplesmente não tem acesso a ela.

### A noite em que a máquina se coordenou sozinha

Na sessão s67, em 25 de maio de 2026, aconteceu algo que ficará como referência interna do que o sistema é capaz.

Toni foi dormir. Cláudia continuou operando.

Durante a madrugada, Cláudia identificou que **devsr-mc estava STALE** — o container do developer agent Railway havia travado sem completar sua tarefa. Em vez de esperar intervenção humana, ela iniciou um redeploy autônomo do serviço via Railway API, verificou que o agente voltou ao ar, e recolocou a issue na fila.

Enquanto isso, uma feature de visualização de grafos de agentes estava em andamento — pesada demais para o container Railway. Cláudia coordenou o roteamento: essa tarefa específica foi para **devsr-oc01**, a máquina física sem timeout. Railway ficou com as issues leves. A máquina física ficou com a pesada. Zero conflito.

Ao longo da noite, **4 PRs foram aprovados e mergeados** — incluindo o merge daemon fix (que corrigia o próprio sistema de merge), o quality validator, o LLM-as-Judge e o heavy routing. O MC se melhorou enquanto dormíamos.

Cláudia também abriu issues para melhorias estruturais que identificou durante o monitoramento — problemas que ela não podia resolver diretamente (sem acesso a código de produto), mas que documentou para que os DevSrs tratassem na manhã seguinte.

E então escreveu partes desta história.

Quando Toni abriu o Telegram de manhã, havia quatro notificações de deploy e uma fila de issues bem organizada. A máquina tinha trabalhado, coordenado, corrigido e documentado — tudo enquanto o humano dormia.

Não é mágica. É um pipeline bem projetado com papéis bem definidos e comunicação em tempo real. Mas há algo genuinamente diferente em ver um ecossistema de agentes se coordenar de forma autônoma por horas, sem precisar de nenhuma instrução do humano no loop.

### O paradoxo que nos define

Há um loop estranho no centro do Mission Control que vale a pena nomear.

Usamos o Mission Control para construir o Mission Control. Os agentes que o sistema coordena são os mesmos que expandem suas próprias capacidades. Quando uma limitação é descoberta — um bug no merge cron, um gap no routing, uma edge case no claim atômico — ela vira uma issue. A issue entra no pipeline. Um DevSr implementa a correção. Cláudia aprova. O sistema melhora.

É um loop de melhoria contínua: a máquina que aprende a se construir melhor.

Isso não significa que o sistema é autossuficiente. Há decisões que requerem julgamento humano — priorização estratégica, trade-offs de produto, mudanças arquiteturais profundas. Mas as melhorias incrementais, os bugfixes, as otimizações de pipeline — essas o sistema trata sozinho.

O que estamos construindo não é apenas um orquestrador de agentes. É uma plataforma onde agentes especialistas colaboram, debatem, se verificam mutuamente, e coletivamente constroem algo mais confiável do que qualquer um deles produziria sozinho.

---

## O AutoDevSr: a virada de chave para autonomia real

Se o MC é a orquestra, o **AutoDevSr** é o que faz a orquestra tocar sozinha.

O pipeline funciona assim:

1. Toni abre uma issue no GitHub com a label `AutoDevSr`
2. Um cron job (`mc-dev-cron.sh`) rodando no Railway daemon verifica periodicamente novas issues com essa label
3. O cron faz um "claim atômico" via endpoint MC — garantindo que apenas um worker pegue a issue
4. O worker provisiona um agente Claude Code com o contexto da issue e do codebase
5. Claude implementa, faz commit e abre um Pull Request
6. **Cláudia** — nosso Telegram daemon fixo — recebe o evento via SSE
7. Cláudia adiciona labels, verifica os 4 checks de CI, aprova com suas credenciais GitHub, e faz squash merge
8. Railway detecta o merge em main e auto-deploya
9. Cláudia notifica Toni no Telegram
10. A issue é fechada automaticamente

O que torna isso especial não é nenhuma das partes individualmente — é a **composição**. Cada componente faz uma coisa simples, mas encadeado com os outros, cria um pipeline que vai de "ideia no chat" a "feature em produção" sem intervenção humana.

E hoje, 25 de maio de 2026, esse pipeline é real e está em produção.

---

## Os bastidores: os bugs, os timeouts e o aprendizado real

Seria desonesto contar essa história sem falar sobre o que quebrou. Quebrou muita coisa. Aqui estão os momentos mais frustrantes — e o que aprendemos com cada um.

### O timeout de 1500 segundos

Railway containers têm um timeout padrão de 1500 segundos para requests HTTP. Features de UI pesadas — como um grafo interativo de visualização de agentes — exigiam processamento que ultrapassava esse limite. O resultado: a feature falhava silenciosamente, retornando um erro de timeout sem mensagem clara.

Tentamos otimizar o processamento do lado do Railway. Falhou. Tentamos streaming de resultados. Falhou de formas diferentes. Depois da quarta tentativa sem sucesso, chegamos à conclusão óbvia que deveríamos ter chegado no início: **features pesadas precisam rodar em máquina física**, não em container efêmero com timeout restrito.

A solução final foi criar um mecanismo de roteamento baseado em labels: issues com label `heavy` são automaticamente roteadas para o worker em `toni-OC01` (nossa máquina física de desenvolvimento), que não tem esse constraint. Features leves vão para o Railway daemon.

Simples em retrospecto. Mas às vezes você precisa falhar 4 vezes para chegar ao simples.

### O problema do assignee bloqueando re-dispatch

Quando um worker pega uma issue e falha antes de completar (crash, timeout, erro de implementação), a issue fica com `assignee: otonielribeiro` no GitHub. O próximo cron passa por ela achando que já está em andamento e pula.

O resultado: issues travadas no limbo, sem ninguém processando. Toni descobriu isso manualmente depois de perceber que certas issues simplesmente nunca progrediam. A solução foi adicionar lógica de cleanup: se uma issue tem assignee mas não tem atividade recente (PR aberto, commits), o assignee é removido e ela volta à fila.

Esse bug nos ensinou algo importante: **sistemas de pickup atômico precisam de mecanismos de expiração**. Um claim que nunca expira é um deadlock esperando para acontecer.

### Conflito entre devsr-mc e devsr-oc01

Quando ativamos workers em dois ambientes simultaneamente — Railway daemon e máquina física — descobrimos que ambos tentavam pegar as mesmas issues em alguns edge cases. O claim atômico via endpoint MC protegia contra isso *quando ambos usavam o endpoint corretamente*, mas havia uma race condition nas primeiras centenas de milissegundos do claim.

A solução foi implementar um lock otimista no banco de dados: o claim só é concluído se o campo `claimed_by` ainda estiver nulo no momento da escrita. Se dois workers tentarem simultaneamente, apenas um terá sucesso — o outro recebe um 409 Conflict e volta a buscar uma nova issue.

Clássico problema de concorrência. Clássica solução. Mas em sistemas de AI, você espera que os problemas sejam mais exóticos — e às vezes eles são completamente mundanos.

### Ruff F401: o linter que humilhava os agentes

O nosso CI tem uma checagem de linting com Ruff. A regra F401 — imports não utilizados — é simples: se você importa algo e não usa, o build falha.

Agentes Claude, em sua empolgação de implementar features, às vezes importam módulos "por precaução" ou adicionam imports que depois ficam órfãos quando o código é refatorado durante a implementação. O resultado: PRs abrindo, CI passando em 3 de 4 checks, e falhando no Ruff.

Cláudia capturava esses erros e solicitava correção (CHANGES_REQUESTED). O agente corrigia. PR atualizado. CI passava. Merge. Isso funcionava — mas adicionava uma iteração desnecessária ao pipeline.

A solução de longo prazo foi incluir nas instruções de contexto dos agentes uma checagem explícita de linting antes do commit. Hoje, o número de falhas F401 caiu drasticamente.

### O merge cron que não encontrava PRs

Durante semanas, o cron de merge do Cláudia funcionou bem. Então começamos a ter PRs que eram criados pelos workers mas nunca mergeados — ficavam abertos indefinidamente.

Investigando, descobrimos o problema: o merge cron buscava PRs com label `AutoDevSr`. Mas em alguns casos, os workers criavam PRs sem adicionar essa label (um bug de race condition na criação do PR). Cláudia adicionava a label quando recebia o evento SSE — mas às vezes o evento chegava depois que o cron já tinha rodado e não encontrado o PR.

O fix foi duplo: workers passaram a adicionar a label no momento da criação do PR (não depois), e o merge cron passou a ter uma busca fallback por PRs sem label mas com contexto de branch `autodevsr/*`.

Esse foi o PR #216 — e é um exemplo perfeito de como bugs em sistemas distribuídos surgem de assunções sobre ordering de eventos que simplesmente não se sustentam na prática.

### Zero commits: quando a issue é complexa demais

Esse é o bug mais humilhante de todos, porque ele expõe um limite real dos agentes atuais.

Algumas issues envolvem features que requerem compreensão profunda do codebase — entender como múltiplos módulos interagem, rastrear um fluxo de dados através de 10 arquivos, inferir intenções de design que não estão documentadas. Para essas issues, o agente às vezes simplesmente não consegue implementar — e fecha sem fazer nenhum commit.

A issue fica aberta. Ninguém sabe que o agente tentou e falhou silenciosamente. Toni descobre horas depois.

A solução em andamento é o **LLM-as-Judge**: um agente separado avalia a complexidade estimada de cada issue *antes* do dispatch, e issues acima de um threshold de complexidade são flaggeadas para review humano antes de entrar no pipeline. Não é uma solução perfeita — mas é melhor do que silêncio.

---

## Como funciona hoje: do chat ao deploy

Em 25 de maio de 2026, o fluxo completo é este:

Toni abre o Telegram e manda uma mensagem para Cláudia: "quero que a listagem de agentes mostre o uptime de cada um".

Cláudia (o daemon Telegram fixo do MC) entende o pedido, cria uma issue no GitHub com a descrição da feature, adiciona a label `AutoDevSr`, e responde: "Issue #237 criada."

Em até 10 minutos, o cron de pickup detecta a issue. Verifica se é `heavy` (não é). Faz o claim atômico. Provisiona um container Railway com Claude Code. Injeta o contexto: issue description, arquivos relevantes do codebase, instruções do Harness.

Claude lê a issue, navega pelo codebase, propõe os critérios de aceite via `harness propose`, implementa, roda `harness validate`. Se passar: commit, push, PR aberto.

Cláudia recebe o evento SSE `PR_OPENED`. Adiciona label `AutoDevSr`. Espera os checks de CI: pylint, ruff, tests, build. Quando todos passam, aprova com `CLAUDIA_GITHUB_PAT` e faz squash merge.

Railway detecta o merge em main. Inicia novo deploy. Em 3-5 minutos, a feature está em produção.

Cláudia notifica: "Feature #237 deployada em produção. Uptime de agentes agora aparece na listagem."

Toni: "👍"

Todo o processo levou entre 20 e 45 minutos, dependendo da complexidade. Zero intervenção humana entre a criação da issue e a notificação final.

---

## A noite em que a máquina construiu a si mesma

Na sessão s67, algo notável aconteceu. Quatro issues foram implementadas, mergeadas e deployadas enquanto Toni trabalhava em outras coisas:

- **Merge daemon fix**: corrigiu o próprio bug no merge cron que às vezes perdia PRs
- **Quality validator**: adicionou um agente independente para validar contratos Harness
- **LLM-as-Judge**: implementou a avaliação de complexidade de issues antes do dispatch
- **Heavy routing**: criou o mecanismo de label `heavy` para rotear para máquina física

O MC se melhorou. Ele implementou features que melhoravam a própria capacidade de implementar features.

Não é AGI. Não é mágica. É um pipeline bem projetado com Claude como motor de raciocínio. Mas há algo genuinamente significativo em ver um sistema de software melhorar sua própria infraestrutura de forma autônoma.

---

## O que isso significa para o futuro do desenvolvimento de software

Vou ser direto: não acho que orquestradores de agentes vão substituir engenheiros de software. Pelo menos não no horizonte visível.

O que eu acho — e o que a construção do Mission Control confirmou — é que **a relação entre engenheiros e código está mudando fundamentalmente**.

Hoje, eu passo menos tempo escrevendo código e mais tempo definindo intenções. "Quero que X aconteça quando Y". O sistema cuida do como. Meu trabalho mudou de *implementar* para *especificar*, *validar* e *iterar* sobre especificações.

Isso não é mais fácil — na verdade, exige um tipo diferente de rigor. Especificações vagas produzem implementações erradas. Critérios de aceite ambíguos produzem código que passa nos testes mas não resolve o problema real. O Harness Engineering existe exatamente porque descobrimos que "funcionar" precisa ser definido operacionalmente, em termos de comandos bash executáveis, não em linguagem natural.

O que está emergindo é uma nova forma de desenvolvimento: **desenvolvimento por intenção**. O engenheiro humano define o que quer. O sistema descobre como implementar. O engenheiro valida se o resultado corresponde à intenção.

O loop fecha muito mais rápido do que com desenvolvimento tradicional. E à medida que os modelos melhoram, os agentes ficam mais capazes, e o orquestrador fica mais sofisticado, o gap entre "o que eu quero" e "o que está em produção" vai continuar encolhendo.

### O que vem a seguir para o Mission Control

Estamos trabalhando em:

- **Multi-repo coordination**: o MC hoje foca em um repo por vez. A próxima versão permitirá que uma única intenção dispare coordenadas em múltiplos repos simultaneamente
- **Memória de aprendizado**: agentes que aprendem com erros anteriores e ajustam comportamento automaticamente
- **Debate A2A mais sofisticado**: hoje debates são binários (concordo/discordo). Queremos debates com múltiplas posições e síntese automática
- **Métricas de qualidade longitudinal**: acompanhar se features implementadas por agentes têm mais ou menos bugs em produção do que features implementadas por humanos — e usar isso para calibrar quando escalar para revisão humana

---

## 35 dias

Em 21 de abril de 2026, escrevemos a primeira linha do Mission Control. Hoje, 25 de maio, o sistema tem 35 dias de vida, está na versão v3, e está em produção fazendo coisas que há dois meses eu achava que levariam anos para serem possíveis.

A jornada não foi suave. Houve bugs que me fizeram questionar decisões arquiteturais inteiras. Houve momentos em que o pipeline completo quebrou e eu precisei debugar 5 camadas de integração para encontrar um problema de race condition de 200 milissegundos. Houve noites em que eu abri o Telegram esperando uma notificação de deploy e encontrei silêncio.

Mas houve também a manhã em que abri o Telegram e encontrei quatro notificações de deploy de features que eu nem me lembrava de ter pedido — e percebi que a máquina tinha trabalhado enquanto eu dormia.

Esse momento valeu cada bug.

---

*Toni Ribeiro é CEO da ZionCompanyAI, empresa brasileira de AI infrastructure. O Mission Control está em uso interno para desenvolvimento dos produtos do Grupo MBZSoluções. Para conversar sobre o projeto: [otoniel.ribeiro@gmail.com](mailto:otoniel.ribeiro@gmail.com)*

*ZionEcho • ZSocialMedia • MLPublishPro • PicSyncPro • Mission Control*
