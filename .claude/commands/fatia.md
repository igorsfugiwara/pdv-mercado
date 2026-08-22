---
description: Executa uma fatia do PDV — lê o PRD, delega ao executor, roda os portões e chama o revisor
argument-hint: <número da fatia> [instrução extra]
allowed-tools: Task, Read, Glob, Grep, Bash
---

Execute a fatia **$ARGUMENTS** do PDV Mercado.

## 1. Leia antes de mexer

- O PRD da fatia em `docs/prds/` (o arquivo que começa com o número).
- O plano em `docs/prds/00 - Plano e Estado Atual.md` — seção 3, os invariantes.

Se a fatia depende de outra que ainda não foi feita, **pare e diga**. A ordem das fatias
existe porque cada uma deixa a seguinte mais fácil; furar a fila dobra trabalho.

## 2. Delegue

Escolha o executor pelo que o PRD pede:

- Mexe em `src/` → **`pdv-caixa`**
- Mexe em `electron/`, `shared/` ou `server/` → **`pdv-main`**
- Mexe nos dois → **`pdv-main` primeiro** (o contrato e o dado nascem lá), depois `pdv-caixa`

Passe ao executor: o caminho do PRD, o escopo exato, e o aviso de que ele **não** deve
extrapolar para outra fatia. Escopo que cresce sozinho é o que faz revisão virar
arqueologia.

## 3. Portões

Rode os quatro, **mesmo que um falhe** — quero o quadro completo:

```bash
npm run typecheck
npm test
npm run check:offline
npx vite build
```

Falhou algum? Volte ao executor com o erro real antes de chamar o revisor. Não gaste
revisão em código que não compila.

## 4. Revise

Chame o **`pdv-revisor`** com o caminho do PRD e o diff da fatia.

Se o veredito for `bloqueado`, volte ao executor com os achados de gravidade alta.
**No máximo duas rodadas.** Se na terceira ainda houver bloqueio, pare e me traga o
impasse — é sinal de que o PRD está ambíguo, e isso eu resolvo, não o agente.

## 5. Relate

- O que mudou, em uma frase por arquivo.
- Os quatro portões, com o número que importa (testes passando, erros de tipo).
- O veredito do revisor e o que sobrou em aberto.
- O item do critério de aceite que **não** foi coberto por teste automatizado e precisa de
  verificação manual na máquina.

Não commite. O commit é decisão do Igor.
