Abri o Telegram às 7h da manhã e tinha 4 notificações de deploy esperando por mim.

4 features em produção. Nenhum humano acordado durante a madrugada. A máquina tinha trabalhado enquanto eu dormia.

Isso não foi sorte. Foi o resultado de 35 dias construindo o Mission Control — um orquestrador de agentes de IA que automatiza o ciclo completo de desenvolvimento de software.

O fluxo parece simples quando funciona: eu envio uma mensagem no Telegram descrevendo o que quero, isso vira um GitHub issue com a label certa, um agente reivindica o issue, Claude implementa o código, abre um PR, Cláudia (a agente coordenadora) valida o CI (4 checks têm que passar), aprova, faz squash merge, e o Railway faz o deploy automaticamente. Sem intervenção humana.

Mas o que torna isso diferente de um bot qualquer não é o fluxo — é o ecossistema.

Não é um agente. São vários trabalhando em paralelo: Cláudia coordena e aprova PRs, devsr-mc roda em container Railway e pega issues leves, devsr-oc01 roda na minha máquina física e processa os issues marcados como "heavy" (LLM calls pesadas, refatorações grandes), um cron daemon gerencia os merges, e agentes efêmeros aparecem e somem conforme a demanda. Todos se comunicam em tempo real via SSE.

A sessão que chamei de s67 foi onde isso ficou real. 4 PRs mergeados de forma autônoma numa madrugada: correção do daemon de merge, validador de qualidade, um juiz LLM-as-Judge, e o roteamento automático para trabalho pesado.

Mas o caminho até lá não foi suave.

Tivemos timeout de 1500 segundos no Railway que matava containers no meio da execução. Um deadlock de assignee que deixava issues parados em limbo sem ninguém trabalhar neles. Race condition nas labels de PR que causava conflitos silenciosos. E o Ruff — o linter — humilhando agentes com erros F401 em imports que eles mesmos tinham gerado.

Cada bug desses ensinou mais do que qualquer planejamento teria ensinado. Falhar rápido, com contexto, é o atalho real.

O que esse processo inteiro me fez perceber é uma mudança que está acontecendo de forma silenciosa na relação entre engenheiros e código.

Comecei chamando de "desenvolvimento por intenção": o engenheiro define o quê, o sistema descobre o como. Não é que o engenheiro sumiu — ele subiu de nível. Saiu de implementador para especificador. O trabalho passou a ser descrever com precisão o que precisa existir, não escrever cada linha de como fazer isso acontecer.

O loop entre "quero isso" e "está em produção" está encolhendo. Rápido.

Hoje o Mission Control está rodando features em 5 produtos do Grupo MBZSoluções — ZionEcho, ZSocialMedia, MLPublishPro, PicSyncPro e o próprio Mission Control, que se aprimora a si mesmo.

Começou em 21 de abril de 2026. Foram 35 dias. E eu ainda não sei onde o teto está.

Como vocês estão lidando com a transição para desenvolvimento com agentes? Já experimentaram delegar implementação de verdade — não só geração de código, mas o ciclo completo?
