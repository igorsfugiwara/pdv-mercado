import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { initDb, getDb, schema } from '../electron/db/index'
import { finalizarVenda, cancelarVenda } from '../electron/services/vendaService'
import { vendasRepo } from '../electron/db/repositories/vendas.repo'
import { fiscalRepo } from '../electron/db/repositories/fiscal.repo'
import { configRepo } from '../electron/db/repositories/config.repo'
import { auditoriaRepo } from '../electron/db/repositories/auditoria.repo'
import { _setFiscalParaTestes } from '../electron/fiscal'
import { SimuladoProvider } from '../electron/fiscal/SimuladoProvider'
import { FakeFiscalProvider } from './support/fakeFiscal'
import type { FinalizarVendaInput } from '../shared/types'

/**
 * Fatia 08 — cancelamento de venda finalizada.
 *
 * O foco é a orquestração que faltava: estoque volta, documento fiscal é
 * cancelado dentro do prazo, e nada disso desfaz o cancelamento da venda
 * quando a SEFAZ falha.
 */
const MIGRATIONS = join(__dirname, '..', 'electron', 'db', 'migrations')

function semear() {
  initDb(':memory:', MIGRATIONS)
  const db = getDb()
  const agora = new Date().toISOString()
  db.insert(schema.usuarios)
    .values({ nome: 'Op', login: 'op', senhaHash: 'x', perfil: 'operador', ativo: true, criadoEm: agora })
    .run()
  db.insert(schema.usuarios)
    .values({ nome: 'Sup', login: 'sup', senhaHash: 'x', perfil: 'supervisor', ativo: true, criadoEm: agora })
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
}

const venda = (): FinalizarVendaInput => ({
  caixaId: 1,
  usuarioId: 1,
  clienteCpf: null,
  itens: [{ produtoId: 1, descricao: 'Arroz', quantidade: 2, peso: null, precoUnitario: 2000, desconto: 0 }],
  descontoVenda: 0,
  pagamentos: [{ forma: 'dinheiro', valor: 4000 }],
  emitirNfce: true,
})

const estoque = () =>
  getDb().select({ e: schema.produtos.estoqueAtual }).from(schema.produtos).all()[0].e

const JUSTIFICATIVA = 'Cliente desistiu da compra no caixa'

beforeEach(() => {
  semear()
  _setFiscalParaTestes(new SimuladoProvider({ cnpj: '11222333000181' }))
})
afterEach(() => _setFiscalParaTestes(null))

describe('justificativa', () => {
  it('recusa com 14 caracteres e diz quantos tem', async () => {
    // A SEFAZ exige 15 no evento; a borda é exatamente aqui.
    const r = await cancelarVenda(1, 1, 'a'.repeat(14), 2)
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('14')
  })

  it('aceita com 15 caracteres', async () => {
    await finalizarVenda(venda())
    const r = await cancelarVenda(1, 1, 'a'.repeat(15), 2)
    expect(r.ok).toBe(true)
  })

  it('espaço em branco não conta', async () => {
    const r = await cancelarVenda(1, 1, '   curto   ', 2)
    expect(r.ok).toBe(false)
  })
})

describe('estorno de estoque', () => {
  it('devolve exatamente a quantidade vendida', async () => {
    expect(estoque()).toBe(10)
    await finalizarVenda(venda())
    expect(estoque()).toBe(8)

    await cancelarVenda(1, 1, JUSTIFICATIVA, 2)
    expect(estoque()).toBe(10)
  })

  it('cancelar duas vezes não estorna duas vezes', async () => {
    await finalizarVenda(venda())
    await cancelarVenda(1, 1, JUSTIFICATIVA, 2)
    expect(estoque()).toBe(10)

    const segunda = await cancelarVenda(1, 1, JUSTIFICATIVA, 2)
    expect(segunda.ok).toBe(false)
    // O ponto: o estoque não passou de 10.
    expect(estoque()).toBe(10)
  })

  it('a venda fica com status cancelada', async () => {
    await finalizarVenda(venda())
    await cancelarVenda(1, 1, JUSTIFICATIVA, 2)

    const v = getDb().select().from(schema.vendas).all()[0]
    expect(v.status).toBe('cancelada')
  })
})

describe('documento fiscal', () => {
  it('dentro do prazo, a NFC-e é cancelada', async () => {
    await finalizarVenda(venda())
    const r = await cancelarVenda(1, 1, JUSTIFICATIVA, 2)

    expect(r.fiscal).toBe('cancelada')
    const doc = (await fiscalRepo.listar())[0]
    expect(doc.status).toBe('cancelada')
    expect(doc.canceladaEm).toBeTruthy()
  })

  it('fora do prazo, o documento NÃO é alterado', async () => {
    await finalizarVenda(venda())
    const doc = (await fiscalRepo.listar())[0]

    // Empurra a autorização para 2 h atrás — fora dos 30 min.
    await fiscalRepo.atualizarStatus(doc.id, {
      status: 'autorizada',
      autorizadaEm: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    })

    const r = await cancelarVenda(1, 1, JUSTIFICATIVA, 2)
    expect(r.ok).toBe(true)
    expect(r.fiscal).toBe('fora-do-prazo')
    expect(r.detalheFiscal).toMatch(/contabilidade/i)

    // O documento continua autorizado: dizer que cancelou seria mentira.
    expect((await fiscalRepo.listar())[0].status).toBe('autorizada')
    // Mas a venda foi cancelada e o estoque voltou.
    expect(estoque()).toBe(10)
  })

  it('o prazo é configurável', async () => {
    await configRepo.definir('fiscal.cancelamento.minutos', '600')
    await finalizarVenda(venda())
    const doc = (await fiscalRepo.listar())[0]
    await fiscalRepo.atualizarStatus(doc.id, {
      status: 'autorizada',
      autorizadaEm: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    })

    // 2 h dentro de um limite de 600 min (10 h) passa.
    const r = await cancelarVenda(1, 1, JUSTIFICATIVA, 2)
    expect(r.fiscal).toBe('cancelada')
  })

  it('falha da SEFAZ não desfaz o cancelamento da venda', async () => {
    await finalizarVenda(venda())

    // Provider que estoura no cancelamento.
    const fake = new FakeFiscalProvider()
    fake.cancelar = async () => {
      throw new Error('SEFAZ indisponível')
    }
    _setFiscalParaTestes(fake)

    const r = await cancelarVenda(1, 1, JUSTIFICATIVA, 2)
    expect(r.ok).toBe(true)
    expect(r.fiscal).toBe('falhou')

    // A venda continua cancelada e o estoque voltou — é o que o mercado precisa.
    expect(getDb().select().from(schema.vendas).all()[0].status).toBe('cancelada')
    expect(estoque()).toBe(10)
  })

  it('venda sem documento autorizado cancela sem parte fiscal', async () => {
    await finalizarVenda({ ...venda(), emitirNfce: false })
    const r = await cancelarVenda(1, 1, JUSTIFICATIVA, 2)
    expect(r.ok).toBe(true)
    expect(['sem-documento', 'cancelada']).toContain(r.fiscal)
  })
})

describe('auditoria', () => {
  it('registra justificativa e autorizador', async () => {
    await finalizarVenda(venda())
    await cancelarVenda(1, 1, JUSTIFICATIVA, 2)

    const linhas = await auditoriaRepo.listar()
    const registro = linhas.find((l) => l.acao === 'venda_cancelar')
    expect(registro).toBeDefined()

    const detalhe = JSON.parse(registro!.detalheJson ?? '{}')
    expect(detalhe.justificativa).toBe(JUSTIFICATIVA)
    expect(detalhe.autorizadoPorId).toBe(2)
    expect(registro!.usuarioId).toBe(1)
    expect(detalhe.autorizadoPorId).not.toBe(registro!.usuarioId)
  })

  it('fora do prazo deixa registro próprio', async () => {
    await finalizarVenda(venda())
    const doc = (await fiscalRepo.listar())[0]
    await fiscalRepo.atualizarStatus(doc.id, {
      status: 'autorizada',
      autorizadaEm: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    })
    await cancelarVenda(1, 1, JUSTIFICATIVA, 2)

    const linhas = await auditoriaRepo.listar()
    expect(linhas.some((l) => l.acao === 'venda_cancelar_fora_prazo')).toBe(true)
  })
})

describe('listagem de vendas', () => {
  it('traz operador, itens, formas e documento', async () => {
    await finalizarVenda(venda())
    const hoje = new Date().toISOString().slice(0, 10)

    const lista = await vendasRepo.listar({ de: hoje, ate: hoje })
    expect(lista).toHaveLength(1)
    expect(lista[0].operador).toBe('Op')
    expect(lista[0].quantidadeItens).toBe(1)
    expect(lista[0].formas).toEqual(['dinheiro'])
    expect(lista[0].documentoStatus).toBe('autorizada')
  })

  it('filtra por status', async () => {
    await finalizarVenda(venda())
    await finalizarVenda(venda())
    await cancelarVenda(1, 1, JUSTIFICATIVA, 2)

    const hoje = new Date().toISOString().slice(0, 10)
    const canceladas = await vendasRepo.listar({ de: hoje, ate: hoje, status: 'cancelada' })
    const finalizadas = await vendasRepo.listar({ de: hoje, ate: hoje, status: 'finalizada' })

    expect(canceladas).toHaveLength(1)
    expect(finalizadas).toHaveLength(1)
  })

  it('busca por número ignora o período', async () => {
    await finalizarVenda(venda())
    // Período no passado, mas o id manda.
    const lista = await vendasRepo.listar({ de: '2020-01-01', ate: '2020-01-02', id: 1 })
    expect(lista).toHaveLength(1)
    expect(lista[0].id).toBe(1)
  })

  it('período sem venda devolve lista vazia', async () => {
    const lista = await vendasRepo.listar({ de: '2020-01-01', ate: '2020-01-02' })
    expect(lista).toEqual([])
  })
})
