# PDV Mercado

Frente de caixa para supermercado. Um operador bipa produtos, recebe o pagamento,
emite a nota e fecha o turno — sem depender de internet.

Este README é para **quem está chegando agora**. Ele explica o que o projeto é, como
colocá-lo para rodar (incluindo as armadilhas que travam todo mundo na primeira vez),
como o código está organizado e por quê, e como o trabalho é feito aqui.

> **Antes de mais nada:** se você só quer ver funcionando, vá para
> [Primeiros 15 minutos](#primeiros-15-minutos). Se o `npm run dev` já falhou,
> pule para [Quando der errado](#quando-der-errado) — provavelmente é a ABI nativa.

---

## 1. O que é isto

Duas entregas que compartilham **o mesmo código de interface**:

| | Desktop (Electron) | Web (Vercel) |
|---|---|---|
| **Papel** | o produto real, no caixa da loja | acessar de qualquer lugar, demonstrar o fluxo |
| **Banco** | SQLite local, no disco da máquina | Postgres |
| **Internet** | funciona sem | precisa |
| **Periféricos** | impressora térmica, balança, gaveta | nenhum |
| **NFC-e** | emissão real (ACBrLib + certificado) | sempre simulada |

Contexto fixo do produto, que explica várias decisões:
**UF São Paulo · Simples Nacional · um caixa por instalação · NFC-e modelo 65**
(o SAT está vedado em SP desde 01/01/2026).

### Por que offline-first

Um supermercado não pode parar de vender porque a internet caiu. Tudo grava no SQLite
local primeiro; a comunicação com a SEFAZ acontece depois e, se falhar, a venda entra em
**contingência** e é retransmitida quando a conexão volta. Isso não é otimização — é o
requisito que molda a arquitetura inteira.

---

## 2. Primeiros 15 minutos

```bash
# 1. Dependências do sistema (Ubuntu/Debian) — precisa ANTES do npm install
sudo apt install -y build-essential python3

# 2. Dependências do projeto
npm install

# 3. Reconstruir os módulos nativos para a ABI do Electron  ← o passo que todo mundo pula
npx electron-rebuild -f

# 4. Popular o banco de desenvolvimento
npm run db:seed

# 5. Subir
npm run dev
```

Login de desenvolvimento: **`admin` / `admin123`** ou **`caixa` / `caixa123`**.
(São seeds de teste, criados apenas fora de produção.)

### Um passeio de 2 minutos pelo app

1. Entre como `caixa`, abra o caixa com qualquer valor de abertura.
2. Bipe `7891000100103` (ou digite e tecle Enter) — o item entra na lista.
3. `F4` abre o diálogo de desconto; `F8` pede o CPF na nota.
4. `F10` abre o pagamento; escolha dinheiro, informe o valor e confirme.
5. A venda finaliza e a NFC-e aparece como **autorizada** — em **modo simulado**,
   sinalizado no rodapé. Nada foi transmitido à SEFAZ.

Se isso funcionou, seu ambiente está correto.

---

## 3. O modelo mental

Três ideias explicam quase todo o código.

### 3.1 O renderer não sabe onde está rodando

`src/` é React puro e **nunca** fala com banco, disco, hardware ou fiscal. Ele só conhece
`window.api`, cujo formato é o contrato em `shared/ipc.ts`.

```
  src/  (React, igual nos dois alvos)
        │
        │  window.api  ← o único caminho, tipado em shared/ipc.ts
        ▼
  ┌─────────────┬──────────────┐
  │  preload    │  apiWeb.ts   │
  │ (Electron)  │  (HTTP)      │
  ▼             ▼              │
  electron/     api/rpc → server/
  SQLite        Postgres
```

É essa regra que dá os dois alvos praticamente de graça: quem implementa `window.api` é o
preload (desktop) ou um adapter HTTP (web), e **nenhuma tela precisa saber a diferença**.

Consequência prática: para expor algo novo ao renderer, o caminho é sempre
**contrato primeiro** — `shared/ipc.ts`, depois o handler no main, depois o preload,
depois a tela.

### 3.2 Dinheiro é inteiro, em centavos

`R$ 12,90` é `1290`. Nunca `12.9`. Ponto flutuante acumula erro e, num sistema que fecha
caixa e apura diferença, um centavo perdido vira uma hora de conferência. As conversões
ficam em `src/lib/money.ts` e nos diálogos de valor — não espalhe `parseFloat` por aí.

Quantidade de produto pesável é a exceção: é fracionária mesmo (1,5 kg), e usa float.

### 3.3 A venda é uma transação só

Finalizar uma venda grava venda, itens, pagamentos, baixa de estoque e documento fiscal
**numa transação única**. A emissão fiscal acontece **fora** dela, depois.

Isso é deliberado: se a SEFAZ não responder, a venda continua existindo e o documento
fica pendente. O cliente já levou a mercadoria — desfazer a venda porque a nota falhou
seria pior do que emitir depois.

---

## 4. Como o trabalho é organizado

O produto inteiro está especificado em [`docs/PRD-PDV-Supermercado.md`](docs/PRD-PDV-Supermercado.md)
(RF-01 a RF-31). O trabalho em andamento está recortado em **fatias**, cada uma com PRD
próprio em [`docs/prds/`](docs/prds/).

**Comece sempre pelo [plano](docs/prds/00%20-%20Plano%20e%20Estado%20Atual.md).** Ele diz o
que já está de pé, o que falta e em que ordem atacar.

| Fatia | Entrega | Estado |
|---|---|---|
| 01 | Fiscal simulado: o app roda sem ACBrLib nem certificado | ✅ |
| 02 | Diálogos próprios no lugar de `prompt/alert/confirm` | ✅ |
| 03 | Autorização e limites de desconto por perfil | pendente |
| 04 | Fechamento de caixa com conferência cega | ✅ |
| 05 | Etiqueta de balança (liga o parser que já existe) | pendente |
| 06 | Painel de abertura com alertas de estoque mínimo | pendente |
| 07 | Aceite ponta a ponta no CI | pendente |

Cada fatia fecha sozinha e é verificável. Nenhuma depende de fatia futura para funcionar.

### Os quatro portões

Nada é considerado pronto sem os quatro passando:

```bash
npm run typecheck      # tsc --noEmit no projeto inteiro
npm test               # vitest sob o Node do Electron
npm run check:offline  # nenhuma referência a nuvem/telemetria (RNF-06)
npx vite build         # o alvo desktop ainda compila
```

Regressão é bloqueio: uma fatia que quebra teste de outra volta para o executor.

### Harness de agente

O repositório tem um harness em `.claude/` — comandos `/fatia <n>` e `/checar`, e agentes
especializados (`pdv-caixa` para o renderer, `pdv-main` para o processo main,
`pdv-revisor` para revisão). Detalhes em [`.claude/README.md`](.claude/README.md).

---

## 5. Regras que nenhuma mudança pode quebrar

1. **O renderer não acessa banco, filesystem, hardware ou fiscal direto.** Só
   `window.api`. Canal novo entra em `shared/ipc.ts` **primeiro**.
2. **`npm run check:offline` retorna zero.** Nada de firebase, analytics ou telemetria —
   é um PDV offline-first, e o requisito é verificado por script.
3. **Toda lógica fiscal fala com a interface `FiscalProvider`**, nunca com uma
   implementação concreta.
4. **Dinheiro é inteiro em centavos.**
5. **Finalização de venda é uma transação só**, e a numeração fiscal é sequencial sem
   reuso.

---

## 6. Onde as coisas estão

```
pdv-mercado/
├── electron/              ── alvo DESKTOP ──
│   ├── main.ts            boot: banco, IPC, fiscal, backup, janela endurecida
│   ├── preload.ts         contextBridge → window.api
│   ├── ipc/               handlers + sessão do operador (perfil mora aqui)
│   ├── db/                schema Drizzle (SQLite), migrations, repositórios, seeds
│   ├── fiscal/            FiscalProvider, Simulado, ACBr, fila de contingência
│   ├── hardware/          impressora, balança, gaveta
│   ├── auth/              hash argon2id
│   └── services/          vendaService (orquestra a finalização), csvImport, backup
│
├── server/                ── alvo WEB ──
│   ├── schema.pg.ts       espelho Postgres do schema SQLite
│   ├── repos/             mesmos repositórios, portados
│   ├── router.ts          porte dos ipcMain.handle, indexado pelos mesmos canais
│   └── fiscal.web.ts      provider simulado (não há ACBrLib numa serverless function)
├── api/                   serverless functions da Vercel (rpc, health)
│
├── shared/                ── OS DOIS LADOS ──
│   ├── ipc.ts             o contrato. fonte única de verdade
│   ├── types.ts           domínio
│   ├── chaveFiscal.ts     chave de acesso da NFC-e (layout + DV mód-11)
│   ├── vendaValidacao.ts  invariantes da finalização
│   └── csvProdutos.ts     parsing do CSV de produtos
│
├── src/                   ── RENDERER (comum aos dois) ──
│   ├── screens/           Caixa, Produtos, Estoque, Fiscal, Relatórios, Config…
│   ├── components/        Dialogo + variantes, Aviso, BuscaProdutos, BarraAtalhos
│   ├── store/             Zustand: auth, caixa, carrinho
│   └── web/apiWeb.ts      implementa o contrato sobre POST /api/rpc
│
├── tests/                 Vitest. `.test.ts` = node; `.test.tsx` = happy-dom
└── docs/                  PRD, PRDs das fatias, fiscal, deploy, manual do operador
```

### Por onde começar a ler

1. `shared/ipc.ts` — o contrato inteiro em um arquivo. É o mapa do que o app faz.
2. `electron/services/vendaService.ts` — a orquestração da venda, o coração do domínio.
3. `src/screens/CaixaScreen.tsx` — a tela onde o operador passa o dia.

---

## 7. Quando der errado

### `npm run dev` abre a janela e falha no `initDb`

**Mensagem:** *"compiled against a different Node.js version"*.

O `npm install` baixa binários pré-compilados para o **Node**, mas o Electron usa outra
ABI. Reconstrua:

```bash
npx electron-rebuild -f
```

Se isso falhar com `ENOENT` no node-gyp, falta o compilador: instale `build-essential`
(Linux) ou as *Build Tools for Visual Studio* com o workload "Desktop development with
C++" (Windows).

### `npm test` falha com "Module did not self-register"

Você rodou `npx vitest` direto. Depois do `electron-rebuild`, os módulos nativos são da
ABI do Electron e o Node puro não os carrega. Use **`npm test`**, que roda o vitest sob o
Node do próprio Electron (`ELECTRON_RUN_AS_NODE=1`).

`npm run test:node` existe só para ambientes sem Electron e falha nos testes que abrem
SQLite — é esperado.

### Teste de componente não roda / erro de ESM

O ambiente DOM aqui é **happy-dom**, não jsdom: jsdom faz `require()` de um módulo ESM e
não carrega sob o Node do Electron. Ponha o docblock no topo do arquivo:

```ts
// @vitest-environment happy-dom
```

O padrão da suíte continua `node`, que é o que os testes de SQLite e Postgres precisam.

### A NFC-e sai "autorizada" mas nada chega na SEFAZ

Correto: o padrão é o **provider simulado**, e o app diz isso na tela (rodapé do caixa e
faixa no monitor fiscal). Emissão real exige a ACBrLib nativa e um certificado A1 —
veja [`docs/FISCAL.md`](docs/FISCAL.md).

Em Configurações → Módulo fiscal dá para injetar falha (`timeout`, `rejeicao`) e exercitar
contingência e rejeição sem derrubar rede.

### Mudei algo no renderer e "não existe no `window.api`"

Canal novo entra **primeiro** no contrato: `shared/ipc.ts` (tipo + nome do canal), depois
`electron/ipc/handlers.ts`, depois `electron/preload.ts`, e — se a versão web também
precisa — `src/web/apiWeb.ts`. O typecheck cobra os quatro.

---

## 8. Versão web

```bash
cp .env.example .env.local   # DATABASE_URL + SESSION_SECRET
npm run db:setup             # cria tabelas no Postgres + dados de demonstração
npx vercel dev               # SPA + serverless functions, igual à produção
```

`npm run dev:web` sobe só o SPA — as chamadas `/api` falham, o que é útil para trabalhar
em tela isolada. Passo a passo do deploy em
[`docs/DEPLOY_VERCEL.md`](docs/DEPLOY_VERCEL.md).

> As dependências do desktop (Electron, `better-sqlite3`, `argon2`, `serialport`, `koffi`)
> ficam em `optionalDependencies` justamente para a Vercel pular todas com
> `npm install --omit=optional`.

## 9. Build

```bash
npm run build:win     # NSIS .exe (Windows 10+)
npm run build:linux   # .AppImage + .deb (Ubuntu 22.04+)
```

---

## 10. Atalhos do caixa (RF-10)

A operação é 100% por teclado — o mouse é exceção, não regra.

| Tecla | Ação |
|---|---|
| `F2` | buscar produto |
| `F3` | quantidade (multiplicador do próximo item) |
| `F4` | desconto na venda |
| `F6` | cancelar o item selecionado |
| `F7` | colocar venda em espera |
| `F8` | CPF na nota |
| `F9` | sangria / suprimento |
| `F10` | pagamento |
| `F12` | cancelar a venda |
| `↑` `↓` | selecionar item da lista |
| `Ctrl+L` | trocar de operador |
| `Esc` | fecha o diálogo aberto |
| `Enter` | confirma o diálogo aberto |

Com um diálogo aberto, os atalhos acima ficam suspensos de propósito: o leitor de código
de barras é um teclado, e um bip acidental não pode disparar F10 por trás do diálogo.

---

## 11. Vocabulário

Se você não vem do varejo brasileiro, estes termos aparecem o tempo todo:

| Termo | O que é |
|---|---|
| **NFC-e** | Nota Fiscal de Consumidor eletrônica (modelo 65) — a nota do varejo ao consumidor |
| **SEFAZ** | Secretaria da Fazenda estadual; é quem autoriza a nota |
| **DANFE** | o papel que sai na impressora representando a nota eletrônica |
| **Chave de acesso** | 44 dígitos que identificam a nota; tem dígito verificador |
| **Contingência** | modo de emissão quando a SEFAZ não responde; transmite depois |
| **CSOSN / NCM / CFOP** | códigos fiscais obrigatórios no cadastro do produto |
| **Sangria** | retirada de dinheiro do caixa durante o turno |
| **Suprimento** | entrada de dinheiro no caixa (troco, por exemplo) |
| **Conferência cega** | fechar o caixa contando o dinheiro **sem** ver o esperado |
| **Curva ABC** | classificação de produtos por participação no faturamento |
| **Produto pesável** | vendido por peso; a etiqueta da balança traz peso ou valor |

---

## 12. Mais documentação

| Arquivo | Para quê |
|---|---|
| [`docs/PRD-PDV-Supermercado.md`](docs/PRD-PDV-Supermercado.md) | requisitos completos, modelo de dados, invariantes |
| [`docs/prds/`](docs/prds/) | as fatias de trabalho; comece pelo `00 - Plano` |
| [`docs/FISCAL.md`](docs/FISCAL.md) | ACBrLib, certificado A1, CSC, homologação |
| [`docs/MANUAL_OPERADOR.md`](docs/MANUAL_OPERADOR.md) | como o caixa usa o sistema |
| [`docs/DEPLOY_VERCEL.md`](docs/DEPLOY_VERCEL.md) | publicar a versão web |
| [`docs/TESTES_HARDWARE.md`](docs/TESTES_HARDWARE.md) | validar impressora, balança e gaveta reais |
| [`docs/TESTES_VM.md`](docs/TESTES_VM.md) | testar o instalador numa máquina limpa |
