import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'node:path'
import { initDb, getDb, schema } from '../electron/db/index'
import { relatoriosRepo } from '../electron/db/repositories/relatorios.repo'

// Relatórios (RF-22..25) exercitando o repo real sobre SQLite in-memory.
const MIGRATIONS = join(__dirname, '..', 'electron', 'db', 'migrations')
const DIA = '2026-07-12'
const CRIADO = `${DIA}T10:00:00.000Z`
const FILTRO = { de: DIA, ate: DIA }

let vendaSeq = 0

function inserirVenda(
  usuarioId: number,
  itens: Array<{ produtoId: number; descricao: string; quantidade: number; precoUnitario: number }>,
  pagamentos: Array<{ forma: 'dinheiro' | 'debito' | 'credito' | 'pix' | 'voucher'; valor: number; troco?: number }>,
) {
  const db = getDb()
  const total = itens.reduce((a, i) => a + i.precoUnitario * i.quantidade, 0)
  const id = ++vendaSeq
  db.insert(schema.vendas)
    .values({ id, caixaId: 1, usuarioId, subtotal: total, desconto: 0, total, status: 'finalizada', criadoEm: CRIADO })
    .run()
  for (const it of itens) {
    db.insert(schema.vendaItens)
      .values({ vendaId: id, produtoId: it.produtoId, descricao: it.descricao, quantidade: it.quantidade, peso: null, precoUnitario: it.precoUnitario, desconto: 0, total: it.precoUnitario * it.quantidade })
      .run()
  }
  for (const p of pagamentos) {
    db.insert(schema.vendaPagamentos).values({ vendaId: id, forma: p.forma, valor: p.valor, troco: p.troco ?? 0 }).run()
  }
}

beforeEach(() => {
  vendaSeq = 0
  initDb(':memory:', MIGRATIONS)
  const db = getDb()
  const agora = new Date().toISOString()
  db.insert(schema.usuarios).values([
    { nome: 'Ana', login: 'ana', senhaHash: 'x', perfil: 'operador', ativo: true, criadoEm: agora },
    { nome: 'Bia', login: 'bia', senhaHash: 'x', perfil: 'operador', ativo: true, criadoEm: agora },
  ]).run()
  db.insert(schema.grupos).values([{ nome: 'Alimentos' }, { nome: 'Bebidas' }]).run()
  const prod = (over: Record<string, unknown>) => ({
    ean: null, unidade: 'UN', pesavel: false, precoCusto: 500, estoqueAtual: 100, estoqueMinimo: 1,
    ativo: true, ncm: '1', cfop: '5102', origem: '0', csosn: '102', criadoEm: agora, atualizadoEm: agora, ...over,
  })
  db.insert(schema.produtos).values([
    prod({ codigoInterno: '1', descricao: 'Arroz', precoVenda: 2000, grupoId: 1 }),
    prod({ codigoInterno: '2', descricao: 'Refri', precoVenda: 3000, grupoId: 2 }),
    prod({ codigoInterno: '3', descricao: 'Bala', precoVenda: 100, grupoId: null }),
  ]).run()
  db.insert(schema.caixas).values({ usuarioAberturaId: 1, valorAbertura: 0, abertoEm: agora, status: 'aberto' }).run()
})

describe('relatoriosRepo.vendas', () => {
  beforeEach(() => {
    inserirVenda(1, [{ produtoId: 1, descricao: 'Arroz', quantidade: 2, precoUnitario: 2000 }], [{ forma: 'dinheiro', valor: 5000, troco: 1000 }])
    inserirVenda(2, [{ produtoId: 2, descricao: 'Refri', quantidade: 1, precoUnitario: 3000 }], [{ forma: 'pix', valor: 3000 }])
    inserirVenda(1, [{ produtoId: 3, descricao: 'Bala', quantidade: 10, precoUnitario: 100 }], [{ forma: 'debito', valor: 1000 }])
  })

  it('resumo com total e ticket médio', async () => {
    const r = await relatoriosRepo.vendas(FILTRO)
    expect(r.resumo.quantidadeVendas).toBe(3)
    expect(r.resumo.total).toBe(8000)
    expect(r.resumo.ticketMedio).toBe(2667) // round(8000/3)
  })

  it('por forma desconta o troco do dinheiro (soma bate com o total)', async () => {
    const r = await relatoriosRepo.vendas(FILTRO)
    const dinheiro = r.porForma.find((f) => f.forma === 'dinheiro')
    expect(dinheiro?.valor).toBe(4000) // 5000 recebido - 1000 troco
    expect(r.porForma.reduce((a, f) => a + f.valor, 0)).toBe(8000)
  })

  it('por produto ordenado por faturamento desc', async () => {
    const r = await relatoriosRepo.vendas(FILTRO)
    expect(r.porProduto.map((p) => p.descricao)).toEqual(['Arroz', 'Refri', 'Bala'])
  })

  it('por operador agrega e ordena', async () => {
    const r = await relatoriosRepo.vendas(FILTRO)
    expect(r.porOperador[0]).toMatchObject({ nome: 'Ana', quantidade: 2, total: 5000 })
  })

  it('por grupo, com "Sem grupo" para produto sem grupo', async () => {
    const r = await relatoriosRepo.vendas(FILTRO)
    const semGrupo = r.porGrupo.find((g) => g.grupoId === null)
    expect(semGrupo?.nome).toBe('Sem grupo')
    expect(semGrupo?.total).toBe(1000)
  })

  it('filtra por operador', async () => {
    const r = await relatoriosRepo.vendas({ ...FILTRO, usuarioId: 2 })
    expect(r.resumo.total).toBe(3000)
  })
})

describe('relatoriosRepo.curvaAbc (RF-23)', () => {
  it('classifica A/A/B por acumulado', async () => {
    inserirVenda(1, [{ produtoId: 1, descricao: 'Arroz', quantidade: 4, precoUnitario: 1000 }], [{ forma: 'pix', valor: 4000 }]) // 50%
    inserirVenda(1, [{ produtoId: 2, descricao: 'Refri', quantidade: 1, precoUnitario: 3000 }], [{ forma: 'pix', valor: 3000 }]) // 37,5%
    inserirVenda(1, [{ produtoId: 3, descricao: 'Bala', quantidade: 10, precoUnitario: 100 }], [{ forma: 'pix', valor: 1000 }]) // 12,5%
    const abc = await relatoriosRepo.curvaAbc(DIA, DIA)
    expect(abc.map((l) => l.classe)).toEqual(['A', 'A', 'B'])
    expect(abc[abc.length - 1].percentualAcumulado).toBeCloseTo(100)
  })

  it('produto dominante (>80%) continua sendo classe A', async () => {
    inserirVenda(1, [{ produtoId: 1, descricao: 'Arroz', quantidade: 1, precoUnitario: 9000 }], [{ forma: 'pix', valor: 9000 }]) // 90%
    inserirVenda(1, [{ produtoId: 3, descricao: 'Bala', quantidade: 10, precoUnitario: 100 }], [{ forma: 'pix', valor: 1000 }]) // 10%
    const abc = await relatoriosRepo.curvaAbc(DIA, DIA)
    expect(abc[0]).toMatchObject({ descricao: 'Arroz', classe: 'A' })
  })
})
