import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { initDb, getDb, schema } from '../electron/db/index'
import { finalizarVenda } from '../electron/services/vendaService'
import { _setFiscalParaTestes, initFiscal, getEstadoFiscal, getFiscalProvider } from '../electron/fiscal'
import { SimuladoProvider } from '../electron/fiscal/SimuladoProvider'
import { fiscalRepo } from '../electron/db/repositories/fiscal.repo'
import { configRepo } from '../electron/db/repositories/config.repo'
import { montarChaveNfce, chaveValida, lerChave, dvModulo11 } from '../shared/chaveFiscal'
import type { FinalizarVendaInput, VendaFiscal } from '../shared/types'

// Fatia 01 — provider simulado, seleção por configuração e degradação limpa.
const MIGRATIONS = join(__dirname, '..', 'electron', 'db', 'migrations')

function semear() {
  initDb(':memory:', MIGRATIONS)
  const db = getDb()
  const agora = new Date().toISOString()
  db.insert(schema.usuarios)
    .values({ nome: 'Op', login: 'op', senhaHash: 'x', perfil: 'operador', ativo: true, criadoEm: agora })
    .run()
  db.insert(schema.produtos)
    .values({
      codigoInterno: '1', ean: '7891000100103', descricao: 'Arroz', unidade: 'UN', pesavel: false,
      precoCusto: 1000, precoVenda: 2000, estoqueAtual: 10, estoqueMinimo: 2, ativo: true,
      ncm: '19059090', cfop: '5102', origem: '0', csosn: '102', criadoEm: agora, atualizadoEm: agora,
    })
    .run()
  db.insert(schema.caixas)
    .values({ usuarioAberturaId: 1, valorAbertura: 10000, abertoEm: agora, status: 'aberto' })
    .run()
}

const venda = (): FinalizarVendaInput => ({
  caixaId: 1,
  usuarioId: 1,
  clienteCpf: null,
  itens: [{ produtoId: 1, descricao: 'Arroz', quantidade: 1, peso: null, precoUnitario: 2000, desconto: 0 }],
  descontoVenda: 0,
  pagamentos: [{ forma: 'dinheiro', valor: 2000 }],
  emitirNfce: true,
})

const vendaFiscal = (vendaId = 1): VendaFiscal => ({
  vendaId,
  clienteCpf: null,
  itens: [{ descricao: 'Arroz', ncm: '19059090', cfop: '5102', csosn: '102', quantidade: 1, unidade: 'UN', valorUnitario: 2000, ean: '7891000100103' }],
  pagamentos: [{ forma: 'dinheiro', valor: 2000 }],
  total: 2000,
})

beforeEach(() => semear())
afterEach(() => {
  _setFiscalParaTestes(null)
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------- 2.1 chave
describe('chave de acesso', () => {
  it('tem 44 dígitos e DV módulo 11 correto', async () => {
    const p = new SimuladoProvider({ cnpj: '11222333000181' })
    const r = await p.emitir(vendaFiscal())
    expect(r.status).toBe('autorizada')
    if (r.status !== 'autorizada') return
    expect(r.chave).toHaveLength(44)
    expect(chaveValida(r.chave)).toBe(true)
  })

  it('respeita o layout posicional da NFC-e', () => {
    const chave = montarChaveNfce({
      uf: '35',
      cnpj: '11222333000181',
      numero: 42,
      serie: 1,
      tpEmis: 1,
      cNF: '12345678',
      emitidaEm: new Date(2026, 8, 20), // setembro/2026
    })
    const c = lerChave(chave)
    expect(c.uf).toBe('35')
    expect(c.aamm).toBe('2609')
    expect(c.cnpj).toBe('11222333000181')
    expect(c.modelo).toBe('65')
    expect(c.serie).toBe('001')
    expect(c.numero).toBe('000000042')
    expect(c.tpEmis).toBe('1')
    expect(c.cNF).toBe('12345678')
    expect(chaveValida(chave)).toBe(true)
  })

  it('o DV recusa chave adulterada', () => {
    const chave = montarChaveNfce({ uf: '35', cnpj: '11222333000181', numero: 7, serie: 1 })
    const trocado = String((Number(chave[10]) + 1) % 10)
    const adulterada = chave.slice(0, 10) + trocado + chave.slice(11)
    expect(chaveValida(adulterada)).toBe(false)
  })

  it('resto 0 ou 1 no módulo 11 vira DV 0', () => {
    // Regra da NT: não existe DV 10 nem 11.
    expect(['0','1','2','3','4','5','6','7','8','9']).toContain(dvModulo11('1'.repeat(43)))
    expect(Number(dvModulo11('0'.repeat(43)))).toBe(0)
  })
})

// ------------------------------------------------------- 2.2 seleção/fallback
describe('seleção de provider', () => {
  it('sem configuração usa simulado', async () => {
    await initFiscal()
    expect(getEstadoFiscal().provider).toBe('simulado')
    expect(getEstadoFiscal().simulado).toBe(true)
    expect(getFiscalProvider()).toBeInstanceOf(SimuladoProvider)
  })

  it('com acbr quebrado cai para simulado sem lançar', async () => {
    await configRepo.definir('fiscal.provider', 'acbr')
    // Sem libPath/certificado válidos, inicializar() falha — que é o caso real
    // de uma máquina sem ACBrLib.
    const alertas: string[] = []
    await expect(initFiscal((m) => alertas.push(m))).resolves.toBeDefined()

    const estado = getEstadoFiscal()
    expect(estado.provider).toBe('simulado')
    expect(estado.simulado).toBe(true)
    expect(estado.motivoFallback).toBeTruthy()
    expect(alertas.join(' ')).toMatch(/simulado/i)
  })

  it('o estado informa o modo de falha configurado', async () => {
    await configRepo.definir('fiscal.simulado.falha', 'rejeicao')
    await initFiscal()
    expect(getEstadoFiscal().modoFalha).toBe('rejeicao')
  })
})

// ---------------------------------------------------------- 2.3 não mente
describe('honestidade do simulado', () => {
  it('validarCertificado devolve inválido', async () => {
    const p = new SimuladoProvider()
    expect(await p.validarCertificado()).toEqual({ valido: false, expiraEm: null })
  })

  it('statusServico diz que é simulação', async () => {
    const s = await new SimuladoProvider().statusServico()
    expect(s.ambiente).toBe('homologacao')
    expect(s.mensagem.toLowerCase()).toContain('simulado')
  })
})

// ------------------------------------------------- 2.1 falhas + invariante 1
describe('modos de falha mantêm a venda', () => {
  it('timeout → documento em contingência e venda persistida', async () => {
    _setFiscalParaTestes(new SimuladoProvider({ falha: 'timeout' }))
    const r = await finalizarVenda(venda())

    expect(r.venda.id).toBeGreaterThan(0)
    const docs = await fiscalRepo.listar()
    expect(docs).toHaveLength(1)
    expect(docs[0].status).toBe('contingencia_pendente')

    const vendas = getDb().select().from(schema.vendas).all()
    expect(vendas).toHaveLength(1)
  })

  it('rejeicao → documento rejeitado com motivo e venda persistida', async () => {
    _setFiscalParaTestes(new SimuladoProvider({ falha: 'rejeicao' }))
    const r = await finalizarVenda(venda())

    expect(r.venda.id).toBeGreaterThan(0)
    const docs = await fiscalRepo.listar()
    expect(docs[0].status).toBe('rejeitada')
    expect(docs[0].motivoRejeicao).toMatch(/539/)

    expect(getDb().select().from(schema.vendas).all()).toHaveLength(1)
  })

  it('sem falha → autorizada com chave válida no banco', async () => {
    _setFiscalParaTestes(new SimuladoProvider({ cnpj: '11222333000181' }))
    await finalizarVenda(venda())

    const docs = await fiscalRepo.listar()
    expect(docs[0].status).toBe('autorizada')
    expect(chaveValida(docs[0].chaveAcesso ?? '')).toBe(true)
  })
})

// ------------------------------------------ 2.4 periférico ausente não quebra
describe('periféricos ausentes', () => {
  it('falha de impressão de DANFE não desfaz a venda', async () => {
    const printer = await import('../electron/hardware/printer')
    vi.spyOn(printer, 'imprimirDanfe').mockRejectedValue(new Error('Impressora ausente'))

    _setFiscalParaTestes(new SimuladoProvider())
    const r = await finalizarVenda(venda())

    expect(r.venda.id).toBeGreaterThan(0)
    expect(getDb().select().from(schema.vendas).all()).toHaveLength(1)
    const docs = await fiscalRepo.listar()
    expect(docs[0].status).toBe('autorizada')
  })

  it('falha da gaveta não desfaz a venda', async () => {
    const printer = await import('../electron/hardware/printer')
    vi.spyOn(printer, 'pulsoGaveta').mockRejectedValue(new Error('Gaveta ausente'))

    _setFiscalParaTestes(new SimuladoProvider())
    const r = await finalizarVenda(venda())

    expect(r.venda.id).toBeGreaterThan(0)
    expect(getDb().select().from(schema.vendas).all()).toHaveLength(1)
  })
})
