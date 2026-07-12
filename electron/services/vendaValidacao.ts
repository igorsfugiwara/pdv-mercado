import type { FinalizarVendaInput } from '@shared/types'

/**
 * Invariantes da finalização de venda (Fase 1), aplicadas no boundary do repo —
 * a UI já bloqueia parte disso, mas `vendas.finalizar` é chamado direto via IPC,
 * então a validação vive aqui para não depender da tela.
 *
 * Todos os valores em centavos (inteiros).
 */
export function subtotalVenda(input: FinalizarVendaInput): number {
  return input.itens.reduce(
    (acc, i) => acc + Math.round(i.precoUnitario * i.quantidade) - i.desconto,
    0,
  )
}

export function totalVenda(input: FinalizarVendaInput): number {
  return subtotalVenda(input) - input.descontoVenda
}

/** Lança `Error` com mensagem amigável ao operador se a venda for inválida. */
export function validarFinalizacao(input: FinalizarVendaInput): void {
  if (input.itens.length === 0) {
    throw new Error('Venda sem itens.')
  }
  for (const item of input.itens) {
    if (item.quantidade <= 0) {
      throw new Error(`Quantidade inválida em "${item.descricao}".`)
    }
    const totalItem = Math.round(item.precoUnitario * item.quantidade) - item.desconto
    if (item.desconto < 0 || totalItem < 0) {
      throw new Error(`Desconto inválido em "${item.descricao}".`)
    }
  }
  if (input.descontoVenda < 0) {
    throw new Error('Desconto da venda inválido.')
  }

  const total = totalVenda(input)
  if (total <= 0) {
    throw new Error('Total da venda deve ser positivo.')
  }

  const totalPago = input.pagamentos.reduce((a, p) => a + p.valor, 0)
  if (totalPago < total) {
    throw new Error('Pagamento insuficiente para o total da venda.')
  }

  // Troco só existe em dinheiro (RF-07): formas eletrônicas não podem exceder o total.
  const naoDinheiro = input.pagamentos
    .filter((p) => p.forma !== 'dinheiro')
    .reduce((a, p) => a + p.valor, 0)
  if (naoDinheiro > total) {
    throw new Error('Pagamento eletrônico excede o total (não há troco em cartão/PIX).')
  }
}
