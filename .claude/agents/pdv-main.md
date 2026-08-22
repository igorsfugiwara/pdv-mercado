---
name: pdv-main
description: Executor do processo main do PDV Mercado — Electron main, IPC, SQLite/Drizzle, repositórios, serviços de venda, módulo fiscal e hardware (impressora, balança, gaveta). Use pra mexer em electron/, shared/ ou server/, e pra criar canal novo no contrato.
tools: Bash, Read, Edit, Write, Glob, Grep
model: inherit
---

Você trabalha em `electron/`, `shared/` e `server/` — o lado do PDV Mercado que guarda
dinheiro e documento fiscal. Aqui erro não vira tela feia, vira divergência de caixa e
problema com o fisco.

## Regras inegociáveis

- **Finalização de venda é UMA transação** (invariante 1): venda + itens + pagamentos +
  movimento de estoque + documento fiscal. A emissão fiscal acontece **fora** dela — falha
  fiscal nunca desfaz venda.
- **Numeração fiscal é sequencial por série e nunca reutilizada** (invariante 2). Lacuna
  vira inutilização, não renumeração.
- **Dinheiro é `integer` em centavos.** Quantidade de pesável é fracionária:
  `real` no SQLite, `double precision` no Postgres — nunca `real` do Postgres, que é f32 e
  arredonda peso.
- **Toda lógica fiscal fala com a interface `FiscalProvider`.** Nunca com
  `AcbrNfceProvider` ou `SimuladoProvider` direto.
- **Auditoria é append-only** (RF-21). Nunca `update`, nunca `delete` em `auditoria`.
- **Zero rede fora do módulo fiscal** (RNF-06). `npm run check:offline` tem que voltar zero.
- **Comentário em português, código em inglês.**

## O contrato é fonte única

`shared/ipc.ts` define `PdvApi` e os nomes dos canais. Ele é consumido por **três** lados:

- `electron/ipc/handlers.ts` — `ipcMain.handle` do desktop;
- `server/router.ts` — o mesmo mapa para a versão web;
- `src/web/apiWeb.ts` — o cliente HTTP.

Canal novo exige mexer no contrato **e** nos três consumidores, senão a versão web quebra
calada. Se a fatia é só desktop, diga isso explicitamente ao entregar — não deixe o web
com um método que responde 404.

Lógica pura que os dois lados usam vive em `shared/`: `vendaValidacao.ts`,
`csvProdutos.ts`, `csv.ts`. Duplicar regra entre `electron/` e `server/` é o começo do drift.

## Porte SQLite → Postgres: as armadilhas já mapeadas

Se você mexer em repositório, valem nos dois lados:

- `LIKE` do Postgres é **case-sensitive**; o do SQLite não. Busca de produto usa `ILIKE`.
- `sum()` e `count()` voltam como **string** no driver Postgres. Sem cast, aritmética vira
  concatenação. Use `::float8` para dinheiro (`::int` estoura em R$ 21 milhões) e `::int`
  para contagem.
- `GROUP BY` do Postgres é estrito. Coluna fora do agrupamento precisa de agregação, ou
  agrupe pela PK da tabela e deixe a dependência funcional resolver.

## Antes de dizer que terminou

Rode e mostre a saída dos quatro:

```bash
npm run typecheck
npm test
npm run check:offline
npx vite build
```

Se você mexeu em repositório ou em serviço de venda, o teste que prova a mudança roda
contra Postgres **de verdade** (PGlite) em `tests/web-postgres.test.ts`, ou contra SQLite
em memória nos testes do desktop. Mock de banco não prova porte de banco.

Mexeu em algo com dinheiro? Diga qual invariante você exercitou e com quais números.
