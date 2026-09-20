# Aceite da Versão Web

**PDV Mercado · Fatia 11**

| | |
|---|---|
| **Objetivo** | O mesmo roteiro de aceite da fatia 07, rodando contra a versão web. |
| **RFs tocados** | verificação do porte web |
| **Depende de** | 07 |

---

## 1. Problema

A versão web reimplementa o backend inteiro: `server/repos/` espelha os
repositórios do Electron, `server/router.ts` espelha os handlers. Dois caminhos
para a mesma regra.

Hoje a cobertura é assimétrica:

- **Desktop**: 232 testes de unidade e integração, mais 7 E2E que exercitam o
  app inteiro.
- **Web**: testes contra Postgres real (PGlite) cobrindo repositórios e o guarda
  de sessão — e **nenhum teste que abra a interface**.

Nesta rodada, cada fatia duplicou regra nos dois lados: autorização de desconto
(03), busca por código interno (05), média diária (06). O risco não é teórico —
a fatia 06 teve um bug de fuso que existia **idêntico** nos dois repositórios,
porque o cálculo foi copiado. Foi corrigido criando `shared/periodo.ts`; sem
teste web, a próxima divergência passa.

E há um caso que só a web tem: o renderer decidindo entre preload e adapter HTTP.
A fatia 07 corrigiu essa detecção no desktop. **Ninguém verifica o outro ramo.**

## 2. Escopo

### 2.1 Infraestrutura

`playwright.config.ts` ganha um segundo projeto, `web`, com:

- Postgres efêmero por execução (PGlite em processo, como os testes atuais já
  fazem — nada de exigir Docker para rodar a suíte).
- Servidor de API levantado no teste, com `DATABASE_URL` apontando para ele.
- Chromium comum, não Electron.

O projeto `desktop` continua como está. `npm run test:e2e` roda os dois;
`--project=web` roda só a web.

### 2.2 O roteiro

O mesmo da fatia 07, **menos o que a plataforma não tem**:

| Passo | Web |
|---|---|
| Login, abertura de caixa | igual |
| 20 itens, multiplicador, etiqueta de balança | igual |
| Desconto com limite e autorização | igual |
| Cancelamento de item com PIN | igual |
| Pagamento em duas formas | igual |
| NFC-e | simulada por definição (`FiscalWebSimulado`) |
| Sangria | igual |
| Fechamento com conferência cega | igual |
| DANFE, gaveta, balança serial | **não existem** — e o teste confere que a UI diz isso, em vez de quebrar |

### 2.3 O que é específico da web

Três coisas que o desktop não tem e precisam de cobertura própria:

1. **Sessão por cookie assinado.** Chamada sem cookie devolve 401; o teste
   confirma que o guarda funciona de ponta a ponta, não só no unitário.
2. **O adapter HTTP é escolhido.** No navegador, `navigator.userAgent` não
   contém Electron e o app instala `apiWeb` — o ramo que a fatia 07 não cobriu.
3. **Periférico ausente degrada com mensagem.** `imprimirFechamento` devolve
   `ok: false` com explicação; a tela mostra, não engole.

### 2.4 Paridade explícita

Um teste que compara o **contrato**: para cada canal em `IPC`, verifica que
`apiWeb` e o `preload` expõem o mesmo conjunto de métodos.

É barato e pega a classe de erro mais provável deste projeto: canal novo
adicionado num alvo e esquecido no outro. O typecheck já pega quando o tipo é
exigido — este teste pega quando alguém adiciona um `any` para calar o
compilador.

## 3. Fora de escopo

Teste contra Postgres hospedado. Deploy de preview na Vercel dentro do CI. Ambos
exigem credencial e transformam o CI em dependente de terceiro.

## 4. Critério de aceite

1. `npm run test:e2e` roda desktop e web; `--project=web` roda só a web.
2. O roteiro de aceite passa na web, com as exclusões da tabela 2.2.
3. Chamada de API sem cookie devolve 401 e a UI trata.
4. O teste de paridade falha se um canal existir só num alvo.
5. Cada execução começa de banco vazio.
6. A suíte web roda em menos de 3 minutos.
7. O CI roda os dois projetos.

## 5. Testes

O entregável é o teste. Verificação da infraestrutura:

| Verificação | Por quê |
|---|---|
| o Postgres efêmero sobe e cai sem resíduo | mesma exigência da 07 |
| duas execuções seguidas passam | prova ausência de estado vazando |
| o teste de paridade falha de verdade ao remover um canal | teste que nunca falha não protege nada |

## 6. Notas de implementação

Reaproveitar `tests-e2e/support/app.ts`: extrair os helpers de teclado (`bipar`,
`responderDialogo`) para um módulo neutro, que sirva aos dois projetos. O roteiro
de aceite é quase o mesmo texto — se virar cópia, ele desatualiza no primeiro
ajuste de UI.

O servidor de API no teste não precisa ser a Vercel: `server/router.ts` é uma
função pura de canal para handler. Um servidor HTTP mínimo em cima dele é
suficiente e roda em qualquer lugar.
