# Diálogos do Caixa

**PDV Mercado · Fatia 02**

| | |
|---|---|
| **Objetivo** | Nenhum `prompt()`, `alert()` ou `confirm()` no renderer. Toda interação em diálogo próprio, operável só com teclado. |
| **RFs tocados** | RF-02 · RF-04 · RF-08 · RF-10 |
| **Depende de** | 01 |
| **Destrava** | 03, 04, 05 — todas pedem algo ao operador |

---

## 1. Problema

São **18** chamadas a diálogo nativo no renderer: 10 em `CaixaScreen`, 4 em
`EstoqueScreen`, 3 em `ProdutosScreen`, 1 em `RelatoriosScreen`.

Num PDV de supermercado isso não é questão de estética:

- **`prompt()` trava o processo do renderer.** Enquanto o diálogo está aberto, nada mais
  responde — nem o timer do rascunho, nem o foco do campo de captura.
- **O leitor de código de barras é um teclado.** Com um `prompt()` aberto, um bip acidental
  digita dentro dele e o Enter do sufixo confirma o diálogo com lixo. Hoje isso passa.
- **Não dá para pré-formatar valor monetário nem validar enquanto digita** — o operador
  descobre o erro depois de confirmar.
- **Perde-se o tema** e a densidade da tela de caixa; o diálogo nativo aparece com fonte
  do sistema, no meio da tela, sem contexto do que está sendo pedido.
- **`alert()` como canal de resultado** obriga o operador a tirar a mão do teclado para
  dispensar mensagem que devia ser passageira.

## 2. Escopo

### 2.1 Primitiva de diálogo

Criar `src/components/Dialogo.tsx` — um único componente que resolve foco, teclado e
acessibilidade, para não repetir isso em cada chamada:

- Renderiza em portal, sobre o resto.
- **Foco preso dentro** enquanto aberto; devolve o foco ao campo de captura ao fechar.
  Esse retorno de foco é o detalhe que faz o operador não perder o ritmo.
- `Esc` cancela, `Enter` confirma. `Tab` circula só dentro do diálogo.
- Enquanto aberto, **suspende os atalhos globais F2–F12** da `CaixaScreen` — hoje eles
  continuam ativos e um F10 dentro de um prompt faz coisa inesperada.
- `role="dialog"`, `aria-modal`, `aria-labelledby`.
- Promise-based, para o chamador ficar legível:
  `const v = await pedirValor({ titulo: 'Desconto (R$)' })` — resolve com o valor ou `null`.

### 2.2 Variantes

| Variante | Uso | Detalhe |
|---|---|---|
| `pedirTexto` | CPF, motivo | validação síncrona com erro inline, sem fechar o diálogo |
| `pedirValor` | desconto, sangria, valor contado | máscara de moeda BRL, devolve **centavos inteiros** |
| `pedirQuantidade` | multiplicador, peso | aceita decimal com vírgula; `peso` limita casas |
| `pedirPin` | supervisor, troca de operador | `type=password`, não ecoa, limpa ao fechar |
| `confirmar` | cancelar venda | ação destrutiva em vermelho, foco inicial no **Cancelar** |
| `escolher` | sangria vs suprimento | lista navegável por setas, atalho numérico |

### 2.3 Mensagens ao operador

`alert()` de resultado vira uma faixa de aviso não-bloqueante (`src/components/Aviso.tsx`)
na própria tela: some sozinha em ~4 s, ou fica até ação quando é erro. A `CaixaScreen` já
tem o estado `mensagem` — é ele que passa a alimentar a faixa.

Erro de operação continua exigindo dispensa explícita. Aviso que some sozinho é bom para
"+ Arroz Branco 5kg", péssimo para "PIN inválido".

### 2.4 Substituições, arquivo por arquivo

- **`CaixaScreen.tsx` (10)** — CPF (F8), multiplicador (F3), desconto (F4), peso do
  pesável, escolha sangria/suprimento (F9), valor, motivo, PIN do supervisor, PIN da troca
  de operador (Ctrl+L), confirmação de cancelar venda (F12).
- **`EstoqueScreen.tsx` (4)** — quantidade de entrada, motivo, novo saldo de ajuste, motivo.
- **`ProdutosScreen.tsx` (3)** — caminho do CSV (só no desktop; a web abre seletor),
  resultado da importação, confirmação de exclusão.
- **`RelatoriosScreen.tsx` (1)** — resultado da exportação.

### 2.5 Busca com debounce (RF-02)

`BuscaProdutos.tsx:23` dispara consulta a cada tecla. Aplicar debounce de 120 ms e
descartar resposta fora de ordem — o `vivo` atual já evita o set tardio, mas não evita a
consulta. RF-02 pede resposta em ≤ 50 ms; com debounce o custo cai sem piorar a percepção.

## 3. Fora de escopo

Redesenho visual da tela de caixa. Esta fatia troca o mecanismo de interação, não o
layout. Nenhuma regra de negócio muda — limite de desconto e autorização são a fatia 03.

## 4. Critério de aceite

1. `grep -rn "prompt(\|alert(\|confirm(" src/` retorna **zero**.
2. Fluxo completo de venda executável **sem tocar no mouse**: bipar → F3 quantidade →
   F4 desconto → F8 CPF → F10 pagar → confirmar.
3. Com um diálogo aberto, bipar um código **não** confirma o diálogo nem lança item.
4. Ao fechar qualquer diálogo, o foco volta ao campo de captura.
5. `Esc` cancela sem efeito colateral em todos os diálogos.
6. Digitar `1,5` em peso e `12,90` em valor produz `1.5` e `1290` centavos.

## 5. Testes

| Teste | Verifica |
|---|---|
| `Dialogo` prende o foco e devolve ao fechar | 2.1 — o ponto que mantém o ritmo |
| `Esc` resolve a promise com `null` | 2.1 |
| atalhos F2–F12 ficam suspensos com diálogo aberto | 2.1 — evita o bip fantasma |
| `pedirValor` converte `12,90` → `1290` centavos | 2.2 |
| `pedirValor` rejeita entrada não numérica sem fechar | 2.2 |
| `pedirQuantidade` aceita `1,5` → `1.5` | 2.2 |
| `pedirPin` não ecoa e limpa ao fechar | 2.2 |
| busca dispara **uma** consulta para 5 teclas em 100 ms | 2.5 |
| aviso de sucesso some sozinho; de erro, não | 2.3 |

Testes de renderer com Vitest + Testing Library (`@testing-library/react` entra como
devDependency nesta fatia — o projeto ainda não tem teste de componente).

## 6. Notas de implementação

O tema é dark+dourado herdado da Casa Ó; use os tokens do Tailwind já configurados
(`bg-surface`, `text-text-muted`, `btn-primary`) em vez de cor literal.

Nada de `window.prompt` disfarçado: o diálogo é React, com estado, e a promise resolve
por callback do componente. Se aparecer `useState` guardando um `resolve`, é isso mesmo —
é o padrão correto aqui.
