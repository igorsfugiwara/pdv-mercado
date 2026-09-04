# Interface e Didática

**PDV Mercado · Fatia 08**

| | |
|---|---|
| **Objetivo** | Layout limpo e interface que ensina o operador sozinho, sem manual. |
| **RFs tocados** | RF-10 · RF-06 · RNF-01 |
| **Status** | Primeira passada entregue. Restante listado em §5. |

---

## 1. Diagnóstico

Auditoria feita no código e na tela renderizada, com contraste calculado pela fórmula de
luminância do WCAG — não estimado no olho.

### As fontes do tema nunca foram carregadas

`tailwind.config.js` declarava Playfair Display, Inter e JetBrains Mono. O `index.html` não
carregava nenhuma, e a CSP (`font-src 'self' data:`) bloquearia CDN de qualquer forma.
Nenhuma das três está instalada na máquina de desenvolvimento. Resultado: toda a intenção
tipográfica estava inerte — o app renderizava no genérico do sistema, e o `font-display`
caía em serif de fallback.

### A borda reprovava em contraste

| Par | Razão | Exigido | |
|---|---|---|---|
| `border` #2E2E2E sobre `surface` | 1.28:1 | 3:1 | ✗ |
| `border` #2E2E2E sobre `surface-alt` (campo) | 1.17:1 | 3:1 | ✗ |
| `text-muted` #8A8580 sobre `surface-alt` | 4.35:1 | 4.5:1 | no limite |

Na prática o operador não enxergava onde o campo começava. O resto da paleta estava bom
(texto 16:1, dourado 11:1) — o problema era só o contorno.

### Os atalhos não existiam na tela

`F3`, `F4`, `F7`, `F8`, `F9`, `F12` e `Ctrl+L` estavam implementados e não apareciam em
lugar nenhum. A instrução que existia (`F2 buscar · F10 pagar`) morava no *placeholder* do
campo de captura — ou seja, sumia exatamente quando o operador começava a digitar. O
critério de aceite do PRD original (§9.4) exige operador **sem treinamento técnico**; isso
não se resolve com manual, se resolve com a tecla visível.

### A lista de itens

Cada linha carregava um botão `remover (F6)` de largura inteira (`col-span-12`), o que
dobrava a altura de toda linha e ainda mentia: `F6` removia o **último** item, não aquele.
Não havia seleção de linha, então cancelar o terceiro item de dez exigia mouse — furando o
RF-10. E bipar o mesmo produto duas vezes criava duas linhas de quantidade 1.

### Atalhos vazavam por baixo de overlay

O handler global de teclado não checava se a busca ou o pagamento estavam abertos. Um `F10`
com a busca aberta abria o painel de pagamento por baixo dela.

## 2. Entregue

**Tipografia.** Stacks de sistema reais (`ui-sans-serif`/`system-ui`, `ui-monospace`), que
renderizam nativas nos dois alvos do PRD sem baixar nada e sem esbarrar na CSP. Dígito
tabular (`tabular-nums`) em tudo que é dinheiro: sem isso `R$ 1.199,00` e `R$ 89,90`
desencontram na coluna e o operador lê errado na pressa.

**Contraste.** Dois tokens em vez de um, porque a regra 1.4.11 do WCAG vale para contorno
de **controle**, não para divisória decorativa:

- `border` #383838 — divisória dentro de card, decorativa;
- `border-strong` #707070 — contorno de campo e botão. 3.5:1 sobre `surface`, 3.2:1 sobre
  `surface-alt`.

`text-muted` subiu para #9A948C (5.3:1 sobre `surface-alt`, 6.4:1 sobre o fundo).

**Barra de atalhos fixa** (`BarraAtalhos.tsx`). Todas as teclas sempre na tela. Atalho
indisponível fica **apagado em vez de sumir** — sumir ensina que a tecla não existe;
apagado ensina que existe e por que não cabe agora.

**Lista de itens.** Botão por linha removido; seleção navegável por `↑↓` com marca dourada;
`F6` passa a cancelar o **item selecionado**; linhas mais baixas. Estado vazio ensina o que
fazer em vez de só informar que está vazio.

**Empilhamento de itens iguais.** Bipar o mesmo produto soma na linha existente. Numa
compra de 20 itens é a diferença entre uma lista que cabe na tela e uma que precisa rolar.
Não empilha pesável (cada pesagem é medição distinta), nem linha com desconto por item
(somar mudaria o desconto acordado), nem preço remarcado no meio da venda.

**Guarda de overlay.** Atalhos e setas ficam suspensos enquanto busca, pagamento ou espera
estão abertos.

## 3. Verificação

Contraste recalculado após a mudança; 130 testes passando, sendo 7 novos cobrindo os casos
de borda do empilhamento. A tela foi inspecionada renderizada — não só compilada.

## 4. Fora de escopo desta passada

Os 18 `prompt()`/`alert()`/`confirm()` continuam de pé: são a **fatia 02**, que tem escopo
próprio. Esta fatia mexeu no que é layout e legibilidade; a 02 mexe no mecanismo de
interação.

## 5. Restante

- Desconto por item sobre a linha selecionada (depende da fatia 03).
- Rolagem automática para manter a linha selecionada visível em lista longa.
- Painel de totais: hierarquia entre subtotal, desconto e total ainda é plana.
- Estilo da barra de rolagem da lista (hoje é a padrão do sistema).
- Rever o peso visual do item ativo na navegação lateral.
- Tirar a dica de credenciais da tela de login quando empacotado.
