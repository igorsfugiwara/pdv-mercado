import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'node:path'
import { initDb, getDb, schema } from '../electron/db/index'
import { relatoriosRepo } from '../electron/db/repositories/relatorios.repo'

/**
 * Fatia 06 — a única agregação nova do painel, contra SQLite de verdade.
 * É a base do "dura ~2 dias": se ela mentir, o painel manda comprar errado.
 */
const MIGRATIONS = join(__dirname, '..', 'electron', 'db', 'migrations')

const dia = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}
const soData = (iso: string) => iso.slice(0, 10)

function semear(qtdProdutos = 3) {
  initDb(':memory:', MIGRATIONS)
  const db = getDb()
  const agora = new Date().toISOString()

  db.insert(schema.usuarios)
    .values({ nome: 'Op', login: 'op', senhaHash: 'x', perfil: 'operador', ativo: true, criadoEm: agora })
    .run()
  db.insert(schema.caixas)
    .values({ usuarioAberturaId: 1, valorAbertura: 0, abertoEm: agora, status: 'aberto' })
    .run()

  for (let i = 1; i <= qtdProdutos; i++) {
    db.insert(schema.produtos)
      .values({
        codigoInterno: String(i), ean: `789${i}`, descricao: `Produto ${i}`, unidade: 'UN',
        pesavel: false, precoCusto: 500, precoVenda: 1000, estoqueAtual: 100, estoqueMinimo: 10,
        ativo: true, ncm: '1', cfop: '5102', origem: '0', csosn: '102',
        criadoEm: agora, atualizadoEm: agora,
      })
      .run()
  }
}

/** Grava uma venda finalizada com um item, na data indicada. */
function vender(produtoId: number, quantidade: number, quandoIso: string) {
  const db = getDb()
  const total = quantidade * 1000
  db.insert(schema.vendas)
    .values({
      caixaId: 1, usuarioId: 1, clienteCpf: null, subtotal: total, desconto: 0,
      total, status: 'finalizada', criadoEm: quandoIso,
    })
    .run()
  const [{ id }] = db.select({ id: schema.vendas.id }).from(schema.vendas).all().slice(-1)
  db.insert(schema.vendaItens)
    .values({
      vendaId: id, produtoId, descricao: `Produto ${produtoId}`, quantidade,
      peso: null, precoUnitario: 1000, desconto: 0, total,
    })
    .run()
}

beforeEach(() => semear())

describe('média diária por produto', () => {
  it('divide a quantidade vendida pelos dias do período', async () => {
    // 20 unidades em 10 dias → 2/dia.
    for (let d = 0; d < 10; d++) vender(1, 2, dia(d))

    const r = await relatoriosRepo.mediaDiariaPorProduto(soData(dia(9)), soData(dia(0)))
    const p1 = r.find((x) => x.produtoId === 1)
    expect(p1).toBeDefined()
    expect(p1!.mediaDiaria).toBeCloseTo(2, 5)
  })

  it('produto sem venda no período NÃO aparece — é ausência, não zero', () => {
    // É o que evita dividir por zero ao estimar dias restantes.
    return relatoriosRepo
      .mediaDiariaPorProduto(soData(dia(30)), soData(dia(0)))
      .then((r) => expect(r).toEqual([]))
  })

  it('só conta venda finalizada', async () => {
    vender(1, 10, dia(1))
    // Uma venda cancelada não pode inflar o giro.
    const db = getDb()
    db.insert(schema.vendas)
      .values({
        caixaId: 1, usuarioId: 1, clienteCpf: null, subtotal: 50000, desconto: 0,
        total: 50000, status: 'cancelada', criadoEm: dia(1),
      })
      .run()
    const [{ id }] = db.select({ id: schema.vendas.id }).from(schema.vendas).all().slice(-1)
    db.insert(schema.vendaItens)
      .values({
        vendaId: id, produtoId: 1, descricao: 'Produto 1', quantidade: 50,
        peso: null, precoUnitario: 1000, desconto: 0, total: 50000,
      })
      .run()

    const r = await relatoriosRepo.mediaDiariaPorProduto(soData(dia(2)), soData(dia(0)))
    const p1 = r.find((x) => x.produtoId === 1)!
    // 10 unidades em 3 dias ≈ 3,33 — não 60/3.
    expect(p1.mediaDiaria).toBeLessThan(4)
  })

  it('separa por produto', async () => {
    for (let d = 0; d < 4; d++) {
      vender(1, 4, dia(d))
      vender(2, 1, dia(d))
    }
    const r = await relatoriosRepo.mediaDiariaPorProduto(soData(dia(3)), soData(dia(0)))
    expect(r.find((x) => x.produtoId === 1)!.mediaDiaria).toBeCloseTo(4, 5)
    expect(r.find((x) => x.produtoId === 2)!.mediaDiaria).toBeCloseTo(1, 5)
  })

  it('período de um dia não vira divisão por zero', async () => {
    vender(1, 5, dia(0))
    const hoje = soData(dia(0))
    const r = await relatoriosRepo.mediaDiariaPorProduto(hoje, hoje)
    expect(r.find((x) => x.produtoId === 1)!.mediaDiaria).toBe(5)
  })
})

describe('desempenho (critério 7 do PRD)', () => {
  it('agrega 10 000 itens de venda em menos de 200 ms', async () => {
    semear(50)
    const db = getDb()

    // Insere em transação: 10 000 inserts avulsos medem o SQLite, não a consulta.
    db.transaction((tx) => {
      for (let i = 0; i < 10_000; i++) {
        const quando = dia(i % 30)
        tx.insert(schema.vendas)
          .values({
            caixaId: 1, usuarioId: 1, clienteCpf: null, subtotal: 1000, desconto: 0,
            total: 1000, status: 'finalizada', criadoEm: quando,
          })
          .run()
        tx.insert(schema.vendaItens)
          .values({
            vendaId: i + 1, produtoId: (i % 50) + 1, descricao: 'x', quantidade: 1,
            peso: null, precoUnitario: 1000, desconto: 0, total: 1000,
          })
          .run()
      }
    })

    const t0 = performance.now()
    const r = await relatoriosRepo.mediaDiariaPorProduto(soData(dia(30)), soData(dia(0)))
    const levou = performance.now() - t0

    expect(r.length).toBe(50)
    expect(levou).toBeLessThan(200)
  }, 60_000)
})
