import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { initDb, getDb, schema } from '../electron/db/index'
import { vendasRepo } from '../electron/db/repositories/vendas.repo'
import type { FinalizarVendaInput } from '../shared/types'

// Exercita o vendasRepo real sobre SQLite in-memory (singleton via initDb),
// cobrindo validação, total fiscal com desconto e idempotência do cancelamento.
const MIGRATIONS = join(__dirname, '..', 'electron', 'db', 'migrations')

beforeEach(() => {
  initDb(':memory:', MIGRATIONS)
  const db = getDb()
  const agora = new Date().toISOString()
  db.insert(schema.usuarios)
    .values({ nome: 'Op', login: 'op', senhaHash: 'x', perfil: 'operador', ativo: true, criadoEm: agora })
    .run()
  db.insert(schema.produtos)
    .values({
      codigoInterno: '1', ean: '789', descricao: 'Arroz', unidade: 'UN', pesavel: false,
      precoCusto: 1000, precoVenda: 2000, estoqueAtual: 10, estoqueMinimo: 2, ativo: true,
      ncm: '1', cfop: '5102', origem: '0', csosn: '102', criadoEm: agora, atualizadoEm: agora,
    })
    .run()
  db.insert(schema.caixas)
    .values({ usuarioAberturaId: 1, valorAbertura: 10000, abertoEm: agora, status: 'aberto' })
    .run()
})

const input = (over: Partial<FinalizarVendaInput> = {}): FinalizarVendaInput => ({
  caixaId: 1,
  usuarioId: 1,
  clienteCpf: null,
  itens: [{ produtoId: 1, descricao: 'Arroz', quantidade: 2, peso: null, precoUnitario: 2000, desconto: 0 }],
  descontoVenda: 0,
  pagamentos: [{ forma: 'dinheiro', valor: 4000 }],
  emitirNfce: true,
  ...over,
})

describe('vendasRepo.finalizar', () => {
  it('persiste venda com total já descontado', () => {
    const { venda } = vendasRepo.finalizar(input({ descontoVenda: 500, pagamentos: [{ forma: 'dinheiro', valor: 3500 }] }))
    expect(venda.subtotal).toBe(4000)
    expect(venda.total).toBe(3500)
  })

  it('reserva número fiscal sequencial quando emitirNfce', () => {
    const { documento } = vendasRepo.finalizar(input())
    expect(documento?.numero).toBe(1)
    const segundo = vendasRepo.finalizar(input())
    expect(segundo.documento?.numero).toBe(2)
  })

  it('rejeita venda inválida sem gravar nada', () => {
    expect(() => vendasRepo.finalizar(input({ itens: [] }))).toThrow(/sem itens/i)
    const vendas = getDb().select().from(schema.vendas).all()
    expect(vendas).toHaveLength(0)
  })
})

describe('vendasRepo.cancelar (idempotência / RF-16)', () => {
  it('estorna estoque uma única vez', () => {
    const { venda } = vendasRepo.finalizar(input()) // baixa 2 → estoque 8
    const antes = getDb().select().from(schema.produtos).where(eq(schema.produtos.id, 1)).all()[0]
    expect(antes.estoqueAtual).toBe(8)

    vendasRepo.cancelar(venda.id, 1) // estorna +2 → 10
    const depois = getDb().select().from(schema.produtos).where(eq(schema.produtos.id, 1)).all()[0]
    expect(depois.estoqueAtual).toBe(10)

    // Segundo cancelamento deve falhar sem estornar de novo.
    expect(() => vendasRepo.cancelar(venda.id, 1)).toThrow(/não pode ser cancelada/i)
    const final = getDb().select().from(schema.produtos).where(eq(schema.produtos.id, 1)).all()[0]
    expect(final.estoqueAtual).toBe(10)
  })
})
