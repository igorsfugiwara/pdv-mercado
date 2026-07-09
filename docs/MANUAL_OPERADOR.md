# Manual do Operador — PDV Mercado

## Login e troca de operador
- Entre com **usuário e senha**. Para trocar de operador rapidamente durante o expediente use `Ctrl+L` e informe o **PIN**.

## Abertura de caixa (RF-11)
Ao abrir o app sem caixa ativo, informe o **fundo de troco** e confirme. Só então a tela de venda fica disponível.

## Vendendo (tela Caixa)
O foco fica sempre no campo de captura. Basta **bipar** o código de barras.

| Ação | Como |
|---|---|
| Adicionar produto | Bipe o EAN (ou digite e Enter) |
| Buscar produto | `F2`, digite nome/EAN/código, ↑/↓ e Enter |
| Multiplicar quantidade | Digite `3 *` e bipe — soma 3 unidades |
| Produto pesável | Ao adicionar, lê a balança; se falhar, informa o peso manualmente |
| Desconto na venda | `F4` |
| CPF na nota | `F8` (validação de dígito) |
| Cancelar item | `F6` |
| Cancelar venda | `F12` |
| Pagamento | `F10` |

## Pagamento (RF-07)
No painel de pagamento, informe o valor e escolha a forma (Dinheiro, Débito, Crédito, PIX, Voucher). É possível **combinar formas**. Em dinheiro, o **troco** é calculado. Marque **Emitir NFC-e** (padrão) e finalize. O DANFE é impresso automaticamente.

## Sangria e suprimento (RF-12)
`F9` — informe valor, motivo e a autorização do supervisor (PIN).

## Fechamento de caixa (RF-11/13)
Conte o dinheiro **sem ver o valor esperado** (conferência cega). O sistema apura a diferença e imprime o relatório por forma de pagamento.

## Quando a internet cai
As vendas continuam normalmente. A NFC-e é emitida em **contingência** e transmitida automaticamente quando a conexão volta. Acompanhe pelo **Monitor fiscal**.

## Recuperação após queda de energia
Ao reabrir o app, a venda em andamento é oferecida para recuperação — nenhum item é perdido.
