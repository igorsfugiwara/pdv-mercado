import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'node:path'
import { initDb, getDb, schema } from '../electron/db/index'
import { caixaRepo } from '../electron/db/repositories/caixa.repo'
import { vendasRepo } from '../electron/db/repositories/vendas.repo'
import type { FinalizarVendaInput } from '../shared/types'

// Saldo esperado do caixa (RF-11) exercitando o caixaRepo real sobre SQLite in-memory.
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
})

const vendaDinheiro = (caixaId: number, valorPago: number): FinalizarVendaInput => ({
  caixaId,
  usuarioId: 1,
  clienteCpf: null,
  itens: [{ produtoId: 1, descricao: 'Arroz', quantidade: 1, peso: null, precoUnitario: 2000, desconto: 0 }],
  descontoVenda: 0,
  pagamentos: [{ forma: 'dinheiro', valor: valorPago }],
  emitirNfce: false,
})

describe('caixaRepo.saldoEsperado (RF-11)', () => {
  it('abertura + suprimento - sangria + dinheiro líquido', async () => {
    const caixa = caixaRepo.abrir(1, 10000) // fundo de troco
    vendasRepo.finalizar(vendaDinheiro(caixa.id, 5000)) // total 2000, troco 3000 → líquido 2000
    caixaRepo.movimentar(caixa.id, 'suprimento', 5000, 'reforço', 1, 1) // +5000
    caixaRepo.movimentar(caixa.id, 'sangria', 3000, 'retirada', 1, 1) // -3000

    // 10000 + 2000 + 5000 - 3000 = 14000
    expect(await caixaRepo.saldoEsperado(caixa.id)).toBe(14000)
  })

  it('fechamento cego devolve a diferença (contado - esperado)', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    vendasRepo.finalizar(vendaDinheiro(caixa.id, 2000)) // exato → líquido 2000
    const { diferenca } = await caixaRepo.fechar(caixa.id, 1, 11500) // esperado 12000
    expect(diferenca).toBe(-500)
    expect(await caixaRepo.atual()).toBeNull()
  })

  it('ignora vendas canceladas no saldo', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    const { venda } = vendasRepo.finalizar(vendaDinheiro(caixa.id, 2000))
    vendasRepo.cancelar(venda.id, 1)
    expect(await caixaRepo.saldoEsperado(caixa.id)).toBe(10000)
  })

  it('rejeita movimentação com valor não-positivo', () => {
    const caixa = caixaRepo.abrir(1, 10000)
    expect(() => caixaRepo.movimentar(caixa.id, 'sangria', 0, 'x', 1, 1)).toThrow(/positivo/i)
  })
})
