---
description: Roda os quatro portões de verificação do PDV Mercado e dá um veredito
allowed-tools: Bash
---

Rode a verificação completa do PDV Mercado e me dê um veredito, não um despejo de log.

```bash
npm run typecheck        # tsc --noEmit no projeto inteiro
npm test                 # vitest: desktop (SQLite) + web (PGlite)
npm run check:offline    # RNF-06: zero firebase/analytics/telemetry
npx vite build           # o alvo desktop ainda compila
```

Rode os quatro **mesmo que um falhe** — quero o quadro completo, não a primeira parada.

Formato da resposta: uma tabela com etapa, passou/falhou e o número que importa (testes
passando, erros de tipo, tamanho do bundle). Depois, só para os que falharam, o erro real e
o arquivo em `arquivo:linha`.

Não sugira correção sem eu pedir.
