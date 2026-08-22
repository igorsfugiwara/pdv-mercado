# Harness do PDV Mercado

Agentes e comandos para executar as fatias de `docs/prds/` com execução e revisão separadas.

## Comandos

| Comando | O que faz |
|---|---|
| `/fatia <n>` | Lê o PRD da fatia, delega ao executor, roda os portões, chama o revisor. Volta ao executor se houver bloqueio, no máximo duas rodadas. |
| `/checar` | Só os quatro portões, sem escrever código. |

## Agentes

| Agente | Território | Escreve? |
|---|---|---|
| `pdv-caixa` | `src/` — renderer React, telas, stores, diálogos | sim |
| `pdv-main` | `electron/`, `shared/`, `server/` — IPC, banco, fiscal, hardware | sim |
| `pdv-revisor` | revisa contra o PRD e os invariantes | **não** — só aponta |

A separação é de propósito. O revisor não tem `Edit` nem `Write`: revisor que corrige o
próprio achado deixa de ser revisor e vira um segundo executor com menos contexto. E os
dois executores são separados porque as regras de cada lado são diferentes — no renderer o
que importa é foco e teclado; no main, transação e centavo.

## Portões

Toda fatia passa pelos quatro antes de ser considerada pronta:

```bash
npm run typecheck && npm test && npm run check:offline && npx vite build
```

Regressão é bloqueio: fatia que quebra teste de outra volta para o executor.

## Fluxo

```
/fatia 02
   │
   ├─ lê docs/prds/02 - Diálogos do Caixa.md
   ├─ delega → pdv-caixa (implementa)
   ├─ portões (typecheck · test · offline · build)
   │     └─ falhou? volta ao executor, sem gastar revisão
   ├─ delega → pdv-revisor (veredito + achados + cobertura do PRD)
   │     └─ bloqueado? volta ao executor · máx. 2 rodadas
   └─ relata — sem commitar
```

O commit fica sempre com o Igor.
