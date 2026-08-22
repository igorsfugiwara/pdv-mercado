# Autorização e Limites

**PDV Mercado · Fatia 03**

| | |
|---|---|
| **Objetivo** | Desconto e cancelamento passam a respeitar perfil, limite e autorização — e tudo fica auditado. |
| **RFs tocados** | RF-05 · RF-06 · RF-19 · RF-21 |
| **Depende de** | 02 |

---

## 1. Problema

O PRD original é explícito: desconto tem **limite por perfil**, e acima do limite exige
**autorização de supervisor por PIN** (RF-05); cancelamento de item e de venda exige
autorização e vai para `auditoria` (RF-06, RF-21).

O que existe hoje:

- `pedirDescontoVenda()` (`CaixaScreen.tsx:155`) aplica **qualquer valor**, de **qualquer
  operador**, sem autorização e sem registro.
- Não há desconto por item na interface, embora `ItemCarrinho.desconto` exista no tipo e o
  repositório já o some corretamente.
- `cancelarUltimoItem()` (`CaixaScreen.tsx:161`) remove sem PIN e **só o último item** —
  se o cliente desistir do terceiro de dez itens, não há caminho.
- F12 (cancelar venda) faz `cart.limpar()` sem autorização e sem registro.

A infraestrutura de autorização já existe e funciona: `auth.autorizarSupervisor(pin)` é
usada corretamente na sangria (`CaixaScreen.tsx:215`). Falta aplicá-la ao resto.

## 2. Escopo

### 2.1 Limites por perfil

Novas chaves em `configuracoes`, editáveis em `ConfigScreen` por Admin:

| Chave | Padrão | Significado |
|---|---|---|
| `desconto.limite.operador` | `500` | teto em **basis points** (5,00%) |
| `desconto.limite.supervisor` | `1500` | 15,00% |
| `desconto.limite.admin` | `10000` | 100% |

Limite em basis points, não em reais: percentual é o que o dono do mercado raciocina, e
inteiro evita float. O limite incide sobre o **percentual do subtotal da venda** para
desconto de venda, e sobre o **total do item** para desconto de item.

### 2.2 Regra de autorização

Uma função pura em `shared/autorizacao.ts` — testável sem UI e reaproveitável pelo main:

```ts
export function exigeAutorizacao(
  perfil: Perfil,
  descontoBps: number,
  limites: LimitesDesconto,
): boolean
```

Fluxo na UI: operador informa o desconto → se passar do limite do próprio perfil, abre
`pedirPin` → `autorizarSupervisor` → **o perfil de quem autorizou também tem limite**.
Um supervisor não pode autorizar 50% se o teto dele é 15%; nesse caso a resposta é recusa
com o motivo, não um segundo pedido de PIN.

### 2.3 Desconto por item

`F4` sobre a linha selecionada aplica desconto no item; `F4` sem seleção aplica na venda.
A lista de itens ganha navegação por setas e destaque da linha corrente — necessário
também para o cancelamento seletivo.

Desconto por item nunca pode deixar o total do item negativo. `shared/vendaValidacao.ts`
já rejeita isso na finalização; a UI passa a impedir antes, com mensagem clara.

### 2.4 Cancelamento de item

`F6` cancela **o item selecionado**, não o último. Exige PIN de supervisor.
Registra em `auditoria` com ação `venda_item_cancelar` e detalhe
`{ produtoId, descricao, quantidade, total, autorizadoPorId }`.

Como a venda ainda não existe no banco, o registro é do **ato do operador** — que é
exatamente o que a auditoria precisa capturar (RF-21): quem tirou o quê do carrinho de
quem, e com autorização de quem.

Canal novo: `auditoria.registrar` precisa ficar acessível ao renderer. Adicionar ao
contrato `shared/ipc.ts` com escopo restrito — o renderer registra ação, nunca lê nem
apaga (a auditoria é append-only, invariante do RF-21).

### 2.5 Cancelamento de venda

`F12` passa a exigir PIN de supervisor quando há item lançado, e registra
`venda_cancelar_carrinho` com a lista de itens e o total descartado. Carrinho vazio não
pede nada — não há o que auditar.

## 3. Fora de escopo

Cancelamento de venda **já finalizada** — isso é `vendas.cancelar`, existe no repositório,
está testado, e a tela que o expõe é assunto de outra fatia. Aqui só o carrinho.

## 4. Critério de aceite

1. Operador aplica 3% de desconto: passa direto.
2. Operador aplica 10%: pede PIN. Com PIN de supervisor, aplica e registra em auditoria.
3. Operador aplica 10%, digita PIN de outro operador: recusa com "PIN sem permissão".
4. Supervisor tenta 50% com teto de 15%: recusa com o motivo, sem pedir PIN de novo.
5. Desconto que zeraria o item é bloqueado na UI, com mensagem.
6. Cancelar o 3º item de 10 remove **aquele** item, pede PIN e registra em auditoria.
7. F12 com carrinho cheio pede PIN; com carrinho vazio, limpa sem perguntar.
8. Todo registro de auditoria tem `usuarioId` do operador e `autorizadoPorId` de quem
   autorizou — nunca os dois iguais quando houve autorização.

## 5. Testes

| Teste | Verifica |
|---|---|
| `exigeAutorizacao` no limite exato **não** exige (`<=` e não `<`) | 2.2 — a borda que sempre erra |
| `exigeAutorizacao` acima do limite exige | 2.2 |
| perfil desconhecido cai no limite mais restritivo | 2.2 — falha segura |
| autorizador com teto menor que o pedido é recusado | 2.2 |
| desconto por item que zera o total é rejeitado | 2.3 |
| cancelar item do meio remove o índice certo | 2.4 |
| cancelamento de item grava auditoria com autorizador | 2.4 |
| F12 com carrinho vazio não chama autorização | 2.5 |
| renderer não consegue ler nem apagar auditoria pelo contrato | 2.4 — append-only |

## 6. Notas de implementação

Basis points em todo lugar: `500` é 5,00%. Converter para reais só na exibição.
`Math.round(subtotal * bps / 10000)` — arredondamento uma vez, no fim, nunca acumulado
item a item.

O limite de quem autoriza precisa ser verificado **no main**, não só na UI: um renderer
comprometido não pode conceder desconto acima do teto. A UI é conveniência; a regra vive
em `shared/autorizacao.ts` e é aplicada nos dois lados.
