# PDV Mercado

Frente de caixa para supermercado, em dois alvos que compartilham o mesmo renderer React:

- **Desktop (Electron)** — produto real: **offline-first**, SQLite local, emissão de **NFC-e (modelo 65)** na SEFAZ-SP, contingência offline, DANFE em impressora térmica, balança e gaveta.
- **Web (Vercel)** — mesma interface sobre Postgres, para acessar de qualquer lugar e demonstrar o fluxo completo. Sem periféricos e com **NFC-e simulada** (emissão real exige a ACBrLib nativa + certificado A1). Ver **[docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md)**.

Contexto fixo: **UF São Paulo · Simples Nacional · 1 caixa por instalação · NFC-e (SAT vedado em SP desde 01/01/2026)**.

Ponto de partida de UI/domínio: PDV Casa Ó (tema dark+dourado, valores em centavos).

PRD completo em [`docs/PRD-PDV-Supermercado.md`](docs/PRD-PDV-Supermercado.md). O trabalho em andamento está fatiado em PRDs próprios em [`docs/prds/`](docs/prds/) — comece pelo [plano](docs/prds/00%20-%20Plano%20e%20Estado%20Atual.md).

## Stack

| Camada | Tecnologia |
|---|---|
| Shell desktop | Electron + electron-builder |
| Hospedagem web | Vercel (SPA estático + serverless functions) |
| Banco (web) | Postgres + Drizzle ORM (`postgres.js`) |
| UI | React + TypeScript + Tailwind CSS |
| Estado | Zustand |
| Banco | SQLite (`better-sqlite3`, WAL, `foreign_keys=ON`) + Drizzle ORM |
| IPC | `contextBridge` tipado (`nodeIntegration:false`, `contextIsolation:true`) |
| Impressora | `node-thermal-printer` (ESC/POS) |
| Balança | `serialport` (Toledo/Filizola) |
| Fiscal | ACBrLib NFCe via `koffi`, atrás de `FiscalProvider` |
| Logs | `electron-log` |
| Testes | Vitest + Playwright Electron |

## Arquitetura (regras invioláveis)

1. **Renderer nunca** acessa banco/FS/hardware/fiscal direto — só via `window.api` (contrato em `shared/ipc.ts`).
2. `npm run check:offline` deve retornar 0 resultados de firebase/analytics/telemetry (RNF-06).
3. Toda a UI fiscal fala apenas com a interface `FiscalProvider` (`electron/fiscal/FiscalProvider.ts`).
4. **`src/` não sabe onde está rodando.** É a regra que dá os dois alvos de graça: quem implementa `window.api` é o preload (desktop) ou o adapter HTTP (web), e nenhuma tela precisa saber a diferença.

```
pdv-mercado/
├── electron/              # ── alvo DESKTOP ──
│   ├── main.ts            # boot: DB, IPC, fiscal, backup, janela endurecida
│   ├── preload.ts         # contextBridge → window.api
│   ├── ipc/               # handlers + sessão do operador
│   ├── db/                # schema Drizzle (SQLite), migrations, repositórios, seeds
│   ├── fiscal/            # FiscalProvider, AcbrNfceProvider, fila de contingência
│   ├── hardware/          # impressora, balança, gaveta
│   ├── auth/              # hash argon2id
│   └── services/          # vendaService, csvImport, backup
│
├── server/                # ── alvo WEB ──
│   ├── schema.pg.ts       # espelho Postgres do schema SQLite
│   ├── migrations/        # DDL idempotente
│   ├── repos/             # mesmos repositórios, portados para Postgres
│   ├── router.ts          # porte dos ipcMain.handle, indexado pelos mesmos canais
│   ├── auth.ts            # scrypt + cookie de sessão assinado
│   ├── fiscal.web.ts      # FiscalProvider simulado (sem ACBrLib/certificado)
│   └── setup.ts           # `npm run db:setup`: cria tabelas + dados de demo
├── api/                   # serverless functions da Vercel (rpc, health)
│
├── shared/                # domínio + contrato IPC + lógica pura dos dois lados
│   ├── ipc.ts             # fonte única: desktop, servidor e cliente web
│   ├── types.ts
│   ├── vendaValidacao.ts  # invariantes da finalização
│   ├── csvProdutos.ts     # parsing do CSV de produtos
│   └── csv.ts             # serialização da exportação
│
├── src/                   # renderer React (comum aos dois alvos)
│   ├── screens/ components/ store/ lib/
│   └── web/apiWeb.ts      # implementa PdvApi sobre POST /api/rpc
└── docs/
```

O renderer é o mesmo código nos dois alvos: `src/main.tsx` só instala o adapter HTTP quando `window.api` não existe, e por `import()` dinâmico — então o bundle do Electron nunca carrega o cliente HTTP.

## Desenvolvimento

```bash
npm install          # requer toolchain de build p/ módulos nativos (better-sqlite3, argon2, serialport)
npm run db:seed      # popula banco de dev em ./data/pdv.db (admin/admin123, caixa/caixa123)
npm run dev          # Vite + Electron em watch
npm run check:offline
npm test
```

> **Módulos nativos:** `better-sqlite3`, `argon2`, `serialport` e `koffi` compilam para a versão do Electron. Se necessário: `npx electron-rebuild`.

### Versão web

```bash
cp .env.example .env.local   # DATABASE_URL + SESSION_SECRET
npm run db:setup             # cria tabelas no Postgres + dados de demonstração
npm run dev:web              # só o SPA (as chamadas /api falham)
npx vercel dev               # SPA + serverless functions, igual à produção
npm run build:web            # build estático para a Vercel
```

Passo a passo do deploy em **[docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md)**.

> As dependências do desktop (Electron, `better-sqlite3`, `argon2`, `serialport`, `koffi`) ficam em `optionalDependencies` justamente para a Vercel pular todas com `npm install --omit=optional`.

## Build / distribuição

```bash
npm run build:win     # NSIS .exe (Windows 10+)
npm run build:linux   # .AppImage + .deb (Ubuntu 22.04+)
```

## Estado de implementação (Fases do PRD)

- **Fase 0 — Fundação:** ✅ scaffold Electron+React+SQLite, remoção do Firebase, esqueleto fiscal. Binding koffi da ACBrLib escrito (símbolos NFCE_*, config, INI/parse puros e testados); **gate pendente:** rodar a lib nativa + certificado A1 reais (não exercitável em CI).
- **Fase 1 — Núcleo de venda:** parcial — cadastro de produtos c/ campos fiscais, tela de caixa (bip/multiplicador/pesável/pagamento múltiplo/CPF), abertura/fechamento de caixa, auth argon2, auditoria, transação de venda + rascunho pós-queda.
- **Fase 2 — Hardware:** parsing de peso Toledo/Filizola (inteiro-gramas + decimal, testado), DANFE NFC-e ESC/POS via `montarDanfeNfce` (pura, testada) + QR, pulso de gaveta reutilizando a impressora. Falta validar I/O serial/térmica no dispositivo real (`docs/TESTES_HARDWARE.md`).
- **Fase 3 — Fiscal:** `FiscalProvider` (com `retransmitir`) + `AcbrNfceProvider` (esqueleto) + fila de contingência **com retry real** (autoriza/rejeita/mantém) + monitor. Fluxo venda→emissão→contingência coberto por testes com provider fake (`tests/fiscal-fluxo.test.ts`); só a ligação ACBrLib nativa (koffi) fica pendente.
- **Fase 4/5:** relatórios ✅ (vendas por período/forma/operador/produto/grupo, curva ABC, export CSV) — agregações do `relatoriosRepo` testadas, com correção de troco em "por forma" e da classificação ABC; backup automático ✅; empacotamento configurado.

- **Web (Vercel):** ✅ renderer completo sobre Postgres — auth com sessão assinada, caixa, venda transacional, estoque, relatórios e curva ABC, tudo coberto por testes que rodam contra Postgres real (PGlite). NFC-e **simulada** e periféricos ausentes por limite da plataforma; ver a tabela de diferenças em `docs/DEPLOY_VERCEL.md`.

Ver `docs/FISCAL.md`, `docs/MANUAL_OPERADOR.md`, `docs/TESTES_HARDWARE.md`, `docs/DEPLOY_VERCEL.md`.

## Atalhos de teclado (RF-10)

`F2` buscar · `F3` quantidade · `F4` desconto · `F5` peso · `F6` cancelar item · `F7` espera · `F8` CPF · `F9` sangria/suprimento · `F10` pagamento · `F12` cancelar venda · `Ctrl+L` trocar operador
