import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { initDb, getDb, schema } from '../electron/db/index'
import { finalizarVenda } from '../electron/services/vendaService'
import { _setFiscalParaTestes } from '../electron/fiscal'
import { ContingenciaQueue } from '../electron/fiscal/contingenciaQueue'
import { fiscalRepo } from '../electron/db/repositories/fiscal.repo'
import { FakeFiscalProvider } from './support/fakeFiscal'
import type { FinalizarVendaInput } from '../shared/types'

// Fluxo fiscal (seção 7.3 + RF-27) com FiscalProvider fake — sem ACBrLib.
const MIGRATIONS = join(__dirname, '..', 'electron', 'db', 'migrations')
let fake: FakeFiscalProvider

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
      ncm: '19059090', cfop: '5102', origem: '0', csosn: '102', criadoEm: agora, atualizadoEm: agora,
    })
    .run()
  db.insert(schema.caixas)
    .values({ usuarioAberturaId: 1, valorAbertura: 10000, abertoEm: agora, status: 'aberto' })
    .run()
  fake = new FakeFiscalProvider()
  _setFiscalParaTestes(fake)
})

afterEach(() => _setFiscalParaTestes(null))

const input = (over: Partial<FinalizarVendaInput> = {}): FinalizarVendaInput => ({
  caixaId: 1,
  usuarioId: 1,
  clienteCpf: null,
  itens: [{ produtoId: 1, descricao: 'Arroz', quantidade: 1, peso: null, precoUnitario: 2000, desconto: 0 }],
  descontoVenda: 0,
  pagamentos: [{ forma: 'dinheiro', valor: 2000 }],
  emitirNfce: true,
  ...over,
})

describe('finalizarVenda → emissão (seção 7.3)', () => {
  it('autoriza e grava chave/protocolo no documento', async () => {
    const r = await finalizarVenda(input())
    expect(r.documentoFiscal?.status).toBe('autorizada')
    expect(r.documentoFiscal?.chaveAcesso).toBe(fake.proximaEmissao.status === 'autorizada' ? fake.proximaEmissao.chave : '')
  })

  it('emite o total já com desconto de venda (regressão do total fiscal)', async () => {
    const r = await finalizarVenda(input({ descontoVenda: 500, pagamentos: [{ forma: 'dinheiro', valor: 3500 }] }))
    expect(r.venda.total).toBe(1500)
    expect(fake.emissoes[0].total).toBe(1500)
  })

  it('cai em contingência quando a emissão falha (venda persiste)', async () => {
    fake.lancarNaEmissao = true
    const r = await finalizarVenda(input())
    expect(r.venda.id).toBeGreaterThan(0)
    expect(r.documentoFiscal?.status).toBe('contingencia_pendente')
  })

  it('marca rejeitada com o motivo da SEFAZ', async () => {
    fake.proximaEmissao = { status: 'rejeitada', codigo: '539', motivo: 'Duplicidade de NFC-e' }
    const r = await finalizarVenda(input())
    expect(r.documentoFiscal?.status).toBe('rejeitada')
    expect(r.documentoFiscal?.motivoRejeicao).toMatch(/539/)
  })

  it('não emite documento quando emitirNfce=false', async () => {
    const r = await finalizarVenda(input({ emitirNfce: false }))
    expect(r.documentoFiscal).toBeNull()
    expect(fake.emissoes).toHaveLength(0)
  })
})

describe('ContingenciaQueue.reprocessar (RF-27)', () => {
  async function criarPendente() {
    fake.lancarNaEmissao = true
    await finalizarVenda(input())
    fake.lancarNaEmissao = false
    const [pend] = await fiscalRepo.listar('contingencia_pendente')
    expect(pend).toBeDefined()
  }

  it('autoriza o documento quando a SEFAZ volta', async () => {
    await criarPendente()
    fake.online = true
    const fila = new ContingenciaQueue(fake)
    const { processados } = await fila.reprocessar()
    expect(processados).toBe(1)
    expect(await fiscalRepo.listar('contingencia_pendente')).toHaveLength(0)
    const [autorizada] = await fiscalRepo.listar('autorizada')
    expect(autorizada.chaveAcesso).toBeTruthy()
  })

  it('mantém na fila enquanto a SEFAZ está offline', async () => {
    await criarPendente()
    fake.online = false
    const fila = new ContingenciaQueue(fake)
    const { processados } = await fila.reprocessar()
    expect(processados).toBe(0)
    expect(await fiscalRepo.listar('contingencia_pendente')).toHaveLength(1)
    expect(fake.retransmissoes).toHaveLength(0)
  })
})
