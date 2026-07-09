import { describe, it, expect } from 'vitest'
import { formatBRL, parseBRL } from '../src/lib/money'
import { validarCpf } from '../src/lib/cpf'
import { parseEanBalanca } from '../electron/hardware/balanca'

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
