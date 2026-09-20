import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, getDb, schema } from '../electron/db/index'
import { initFiscal, getEstadoFiscal, definirModoFalhaSimulado, _setFiscalParaTestes } from '../electron/fiscal'
import { finalizarVenda } from '../electron/services/vendaService'
import { fiscalRepo } from '../electron/db/repositories/fiscal.repo'
import { chaveValida, lerChave } from '../shared/chaveFiscal'
import type { FinalizarVendaInput } from '../shared/types'

/**
 * Critério de aceite da fatia 01, exercitado como o app exercita.
 *
 * Diferente de `fiscal-simulado.test.ts`, que testa as unidades: aqui o banco é
 * um arquivo de verdade, o provider vem de `initFiscal()` sem nenhuma
 * configuração fiscal (a máquina limpa do critério) e a venda passa pelo
 * caminho inteiro. É o teste que quebra se a fiação entre configuração,
 * provider e venda for desfeita.
 */
const MIGRATIONS = join(__dirname, '..', 'electron', 'db', 'migrations')
let dir: string

const venda = (): FinalizarVendaInput => ({
  caixaId: 1,
  usuarioId: 1,
  clienteCpf: null,
  itens: [{ produtoId: 1, descricao: 'Leite Ninho', quantidade: 1, peso: null, precoUnitario: 2590, desconto: 0 }],
  descontoVenda: 0,
  pagamentos: [{ forma: 'dinheiro', valor: 3000 }],
  emitirNfce: true,
})

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pdv-aceite-'))
  initDb(join(dir, 'pdv.db'), MIGRATIONS)

  const db = getDb()
  const agora = new Date().toISOString()
  db.insert(schema.usuarios)
    .values({ nome: 'Caixa', login: 'caixa', senhaHash: 'x', perfil: 'operador', ativo: true, criadoEm: agora })
    .run()
  db.insert(schema.produtos)
    .values({
      codigoInterno: '1', ean: '7891000100103', descricao: 'Leite Ninho', unidade: 'UN', pesavel: false,
      precoCusto: 1200, precoVenda: 2590, estoqueAtual: 20, estoqueMinimo: 5, ativo: true,
      ncm: '19011010', cfop: '5102', origem: '0', csosn: '102', criadoEm: agora, atualizadoEm: agora,
    })
    .run()
  db.insert(schema.caixas)
    .values({ usuarioAberturaId: 1, valorAbertura: 20000, abertoEm: agora, status: 'aberto' })
    .run()

  // Nenhuma configuração fiscal gravada: é o boot numa máquina limpa.
  await initFiscal()
})

afterAll(() => {
  _setFiscalParaTestes(null)
  rmSync(dir, { recursive: true, force: true })
})

describe('aceite da fatia 01 — máquina sem ACBrLib, certificado ou periférico', () => {
  it('1. o módulo fiscal sobe em modo simulado, sem configuração', () => {
    const e = getEstadoFiscal()
    expect(e.provider).toBe('simulado')
    expect(e.simulado).toBe(true)
    expect(e.motivoFallback).toBeNull()
  })

  it('2-4. a venda finaliza com NFC-e autorizada e chave válida', async () => {
    const r = await finalizarVenda(venda())
    const doc = (await fiscalRepo.listar()).find((d) => d.id === r.documentoFiscal.id)

    expect(doc?.status).toBe('autorizada')
    expect(doc?.chaveAcesso).toHaveLength(44)
    expect(chaveValida(doc!.chaveAcesso!)).toBe(true)

    const c = lerChave(doc!.chaveAcesso!)
    expect(c.modelo).toBe('65') // NFC-e
    expect(c.tpEmis).toBe('1')

    // Troco: R$ 30,00 pagos sobre R$ 25,90.
    expect(r.troco).toBe(410)
  })

  it('5. com falha timeout, o documento cai em contingência e a venda permanece', async () => {
    await definirModoFalhaSimulado('timeout')
    const r = await finalizarVenda(venda())
    const doc = (await fiscalRepo.listar()).find((d) => d.id === r.documentoFiscal.id)

    expect(doc?.status).toBe('contingencia_pendente')
    expect(r.venda.id).toBeGreaterThan(0)
  })

  it('6. com falha rejeicao, o documento é rejeitado com motivo e a venda permanece', async () => {
    await definirModoFalhaSimulado('rejeicao')
    const r = await finalizarVenda(venda())
    const doc = (await fiscalRepo.listar()).find((d) => d.id === r.documentoFiscal.id)

    expect(doc?.status).toBe('rejeitada')
    expect(doc?.motivoRejeicao).toBeTruthy()
    expect(r.venda.id).toBeGreaterThan(0)
  })

  it('invariante 1: as três vendas estão no banco, qualquer que tenha sido o desfecho fiscal', () => {
    expect(getDb().select().from(schema.vendas).all()).toHaveLength(3)
  })

  it('o modo de falha fica persistido na configuração', async () => {
    const { configRepo } = await import('../electron/db/repositories/config.repo')
    expect(await configRepo.obter('fiscal.simulado.falha')).toBe('rejeicao')
  })
})
