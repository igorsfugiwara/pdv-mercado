# Etiqueta de Balança

**PDV Mercado · Fatia 05**

| | |
|---|---|
| **Objetivo** | Bipar etiqueta de balança resolve produto **e** peso (ou valor) numa leitura só. |
| **RFs tocados** | RF-03 · RF-01 |
| **Depende de** | 02 |

---

## 1. Problema

`parseEanBalanca()` está escrito em `electron/hardware/balanca.ts:103`, tem teste em
`tests/hardware.test.ts` — e **nunca é chamado**. Zero referências fora do próprio módulo.

`processarCaptura()` (`CaixaScreen.tsx:55`) faz `produtos.obterPorEan(texto)` com o código
cru. Uma etiqueta de balança é um EAN-13 com prefixo `2` onde os dígitos do meio carregam
o **código interno do produto** e o **peso ou valor** — o código completo nunca vai bater
com nenhum EAN cadastrado. Na prática: **o operador bipa hortifruti e o sistema diz que o
produto não existe.**

É o pior tipo de defeito — a peça difícil está pronta e testada, e o fio não foi ligado.

## 2. Escopo

### 2.1 Reconhecimento no fluxo de captura

`processarCaptura()` passa a, em ordem:

1. Multiplicador (`3 *`) — como hoje.
2. **Etiqueta de balança**: 13 dígitos começando com o prefixo configurado (padrão `2`).
3. EAN comum.
4. Busca por texto.

Etiqueta reconhecida resolve o produto pelo **código interno** extraído, não pelo EAN.
Requer método novo no contrato: `produtos.obterPorCodigoInterno(codigo)` — hoje só existe
`obterPorEan`, e `buscar()` faria varredura por texto, o que é impreciso e lento no bip.

### 2.2 Dois layouts

O PRD (RF-03) exige os dois, selecionáveis em `ConfigScreen → Periféricos`:

| Layout | Estrutura | Significado dos 5 dígitos |
|---|---|---|
| **código + peso** | `2` + código(6) + peso(5) + DV | peso em gramas → `01500` = 1,500 kg |
| **código + valor** | `2` + código(6) + valor(5) + DV | valor em centavos → `01290` = R$ 12,90 |

No layout **valor**, a quantidade é derivada: `valor ÷ precoVenda`, arredondada a 3 casas.
O item entra com o valor da etiqueta como total — a balança já fez a conta, e recalcular a
partir do peso arredondado introduz divergência de centavos com a etiqueta que o cliente
tem na mão. **A etiqueta é a fonte da verdade do valor.**

Chaves de configuração: `balanca.ean.prefixo` (padrão `2`) e `balanca.ean.layout`
∈ `peso | valor` (padrão `peso`).

### 2.3 Validação

- **DV do EAN-13 confere** antes de aceitar. Etiqueta amassada ou leitura parcial vira erro
  claro, não item errado no carrinho.
- Código interno sem produto correspondente: mensagem dizendo **qual** código não foi achado.
- Produto achado que **não é pesável**: recusa com o motivo. Etiqueta de balança para item
  unitário é erro de cadastro, e aceitar mascara o problema.
- Peso ou valor zero: recusa.

### 2.4 Precedência

Um EAN-13 legítimo pode começar com `2` — o prefixo `2` é reservado para uso interno, mas
cadastro errado acontece. Regra: **se existir produto cadastrado com aquele EAN exato, ele
ganha**; só então tenta-se interpretar como etiqueta. Isso torna o comportamento previsível
e não quebra cadastro existente.

## 3. Fora de escopo

Leitura serial da balança (RS-232). Esta fatia é sobre a **etiqueta impressa**, que chega
pelo leitor de código de barras como teclado — funciona sem nenhum periférico serial.
Balança serial já tem `parsePeso()` e é assunto de hardware físico.

> **Recorte combinado:** a balança física só será testada imediatamente antes da
> integração, na balança de verdade. Tudo que não depende dela pode andar agora — e esta
> fatia inteira não depende: a etiqueta chega digitada. O protocolo serial dá para exercitar
> com porta virtual, ver [`docs/TESTES_VM.md`](../TESTES_VM.md) §2.

## 4. Critério de aceite

Com "Banana Prata (kg)" cadastrada com código interno `2001`, preço R$ 5,99/kg, pesável:

1. Layout `peso`, bipar `2200100150` + DV → item entra com 1,500 kg e total R$ 8,99.
2. Layout `valor`, bipar `2200101290` + DV → item entra com total R$ 12,90 e quantidade
   ≈ 2,154 kg.
3. Etiqueta com DV errado → erro "código inválido", nada no carrinho.
4. Código interno inexistente → erro nomeando o código.
5. Código de produto não-pesável → erro explicando.
6. EAN-13 cadastrado começando com `2` → resolve como produto normal (precedência).
7. Bipar etiqueta **não** abre o diálogo de peso manual — o peso já veio.

## 5. Testes

| Teste | Verifica |
|---|---|
| `parseEanBalanca` layout peso extrai código e gramas | 2.2 (existe; conectar) |
| `parseEanBalanca` layout valor extrai código e centavos | 2.2 |
| DV inválido é rejeitado | 2.3 |
| prefixo configurável (`2` vs outro) | 2.2 |
| quantidade derivada de valor ÷ preço, 3 casas | 2.2 |
| total do item no layout valor **bate exatamente** com a etiqueta | 2.2 — a divergência de centavos |
| produto não-pesável recusado | 2.3 |
| EAN cadastrado tem precedência sobre interpretação | 2.4 |
| etiqueta não dispara pedido de peso manual | 4.7 |

## 6. Notas de implementação

`parseEanBalanca` vive em `electron/hardware/balanca.ts`, mas o parsing é **puro** e o
renderer precisa decidir o fluxo. Mover para `shared/eanBalanca.ts` — mesmo caminho já
feito com `vendaValidacao` e `csvProdutos`. O módulo de hardware continua importando de lá.

Cuidado com o arredondamento no layout valor: `quantidade = valor / precoVenda` com 3
casas, mas o **total do item é o valor da etiqueta**, não `quantidade × precoVenda`. Se
recalcular, o cupom diverge da etiqueta em alguns centavos — e é o tipo de erro que só
aparece no cliente reclamando no caixa.
