import { describe, it, expect } from 'vitest'
import { formatBRL, parseBRL } from '../src/lib/money'
import { validarCpf } from '../src/lib/cpf'
import { parseEanBalanca } from '../electron/hardware/balanca'
import { validarFinalizacao, totalVenda } from '../electron/services/vendaValidacao'
import type { FinalizarVendaInput } from '../shared/types'

describe('money (centavos)', () => {
  it('formata em BRL', () => {
    expect(formatBRL(2790)).toBe('R$ 27,90')
  })
  it('parseia strings BR para centavos', () => {
    expect(parseBRL('27,90')).toBe(2790)
    expect(parseBRL('R$ 1.234,56')).toBe(123456)
    expect(parseBRL('0')).toBe(0)
  })
})

describe('CPF (RF-08)', () => {
  it('aceita CPF válido', () => {
    expect(validarCpf('529.982.247-25')).toBe(true)
  })
  it('rejeita inválidos e repetidos', () => {
    expect(validarCpf('111.111.111-11')).toBe(false)
    expect(validarCpf('123.456.789-00')).toBe(false)
    expect(validarCpf('123')).toBe(false)
  })
})

describe('EAN de balança (RF-03)', () => {
  it('layout código+peso (prefixo 2)', () => {
    // 2 | 12345 | 001500 (1,5kg em gramas) | DV
    const r = parseEanBalanca('2123450015007', 'peso')
    expect(r).toEqual({ codigoProduto: '12345', peso: 1.5 })
  })
  it('layout código+valor', () => {
    const r = parseEanBalanca('2123450012349', 'valor')
    expect(r).toEqual({ codigoProduto: '12345', valor: 1234 })
  })
  it('ignora EAN sem prefixo 2', () => {
    expect(parseEanBalanca('7891000100103', 'peso')).toBeNull()
  })
})

describe('validação de finalização de venda (Fase 1)', () => {
  const base = (over: Partial<FinalizarVendaInput> = {}): FinalizarVendaInput => ({
    caixaId: 1,
    usuarioId: 1,
    clienteCpf: null,
    itens: [{ produtoId: 1, descricao: 'Arroz', quantidade: 2, peso: null, precoUnitario: 1000, desconto: 0 }],
    descontoVenda: 0,
    pagamentos: [{ forma: 'dinheiro', valor: 2000 }],
    emitirNfce: true,
    ...over,
  })

  it('total desconta o descontoVenda', () => {
    expect(totalVenda(base({ descontoVenda: 300 }))).toBe(1700)
  })

  it('aceita venda válida', () => {
    expect(() => validarFinalizacao(base())).not.toThrow()
  })

  it('rejeita carrinho vazio', () => {
    expect(() => validarFinalizacao(base({ itens: [] }))).toThrow(/sem itens/i)
  })

  it('rejeita pagamento insuficiente', () => {
    expect(() => validarFinalizacao(base({ pagamentos: [{ forma: 'dinheiro', valor: 1500 }] }))).toThrow(
      /insuficiente/i,
    )
  })

  it('rejeita total não-positivo (desconto >= subtotal)', () => {
    expect(() => validarFinalizacao(base({ descontoVenda: 2000 }))).toThrow(/positivo/i)
  })

  it('aceita troco em dinheiro (paga mais que o total)', () => {
    expect(() => validarFinalizacao(base({ pagamentos: [{ forma: 'dinheiro', valor: 5000 }] }))).not.toThrow()
  })

  it('rejeita excesso em pagamento eletrônico (sem troco em cartão)', () => {
    expect(() => validarFinalizacao(base({ pagamentos: [{ forma: 'credito', valor: 5000 }] }))).toThrow(
      /eletrônico|troco/i,
    )
  })

  it('rejeita quantidade inválida', () => {
    expect(() =>
      validarFinalizacao(
        base({ itens: [{ produtoId: 1, descricao: 'X', quantidade: 0, peso: null, precoUnitario: 1000, desconto: 0 }] }),
      ),
    ).toThrow(/quantidade/i)
  })
})
