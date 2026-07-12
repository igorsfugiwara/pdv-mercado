# PDV Mercado

Frente de caixa desktop **offline-first** para supermercado, com emissão de **NFC-e (modelo 65)** na SEFAZ-SP, contingência offline e impressão de DANFE em impressora térmica.

Contexto fixo: **UF São Paulo · Simples Nacional · 1 caixa por instalação · NFC-e (SAT vedado em SP desde 01/01/2026)**.

Ponto de partida de UI/domínio: PDV Casa Ó (tema dark+dourado, valores em centavos). Ver PRD em `../PRD-PDV-Supermercado.md`.

## Stack

| Camada | Tecnologia |
|---|---|
| Shell desktop | Electron + electron-builder |
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

```
pdv-mercado/
├── electron/
│   ├── main.ts            # boot: DB, IPC, fiscal, backup, janela endurecida
│   ├── preload.ts         # contextBridge → window.api
│   ├── ipc/               # handlers + sessão do operador
│   ├── db/                # schema Drizzle, migrations SQL, repositórios, seeds
│   ├── fiscal/            # FiscalProvider, AcbrNfceProvider, fila de contingência
│   ├── hardware/          # impressora, balança, gaveta
│   ├── auth/              # hash argon2id
│   └── services/          # vendaService, csvImport, backup
├── shared/                # tipos de domínio + contrato IPC (main ↔ renderer)
├── src/                   # renderer React: screens/, components/, store/, lib/
└── docs/
```

## Desenvolvimento

```bash
npm install          # requer toolchain de build p/ módulos nativos (better-sqlite3, argon2, serialport)
npm run db:seed      # popula banco de dev em ./data/pdv.db (admin/admin123, caixa/caixa123)
npm run dev          # Vite + Electron em watch
npm run check:offline
npm test
```

> **Módulos nativos:** `better-sqlite3`, `argon2`, `serialport` e `koffi` compilam para a versão do Electron. Se necessário: `npx electron-rebuild`.

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
- **Fase 4/5:** relatórios (esqueleto), backup automático ✅, empacotamento configurado.

Ver `docs/FISCAL.md`, `docs/MANUAL_OPERADOR.md`, `docs/TESTES_HARDWARE.md`.

## Atalhos de teclado (RF-10)

`F2` buscar · `F3` quantidade · `F4` desconto · `F5` peso · `F6` cancelar item · `F7` espera · `F8` CPF · `F9` sangria/suprimento · `F10` pagamento · `F12` cancelar venda · `Ctrl+L` trocar operador
