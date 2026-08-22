import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'node:path'
import { initDb, getDb, schema } from '../electron/db/index'
import { caixaRepo } from '../electron/db/repositories/caixa.repo'
import { vendasRepo } from '../electron/db/repositories/vendas.repo'
import { montarCupomFechamento } from '../electron/hardware/printer'
import { somarContagem } from '../src/components/ContagemGaveta'
import { RASCUNHO_ID } from '../shared/types'
import type { FinalizarVendaInput } from '../shared/types'

// Fechamento de caixa (RF-11/RF-13) sobre o caixaRepo real em SQLite in-memory.
const MIGRATIONS = join(__dirname, '..', 'electron', 'db', 'migrations')

beforeEach(() => {
  initDb(':memory:', MIGRATIONS)
  const db = getDb()
  const agora = new Date().toISOString()
  db.insert(schema.usuarios)
    .values([
      { nome: 'Op', login: 'op', senhaHash: 'x', perfil: 'operador', ativo: true, criadoEm: agora },
      { nome: 'Sup', login: 'sup', senhaHash: 'x', perfil: 'supervisor', ativo: true, criadoEm: agora },
      { nome: 'Outro', login: 'outro', senhaHash: 'x', perfil: 'operador', ativo: true, criadoEm: agora },
    ])
    .run()
  db.insert(schema.produtos)
    .values({
      codigoInterno: '1', ean: '789', descricao: 'Arroz', unidade: 'UN', pesavel: false,
      precoCusto: 1000, precoVenda: 2000, estoqueAtual: 100, estoqueMinimo: 2, ativo: true,
      ncm: '1', cfop: '5102', origem: '0', csosn: '102', criadoEm: agora, atualizadoEm: agora,
    })
    .run()
})

const venda = (
  caixaId: number,
  forma: 'dinheiro' | 'debito',
  valorPago: number,
): FinalizarVendaInput => ({
  caixaId,
  usuarioId: 1,
  clienteCpf: null,
  itens: [
    { produtoId: 1, descricao: 'Arroz', quantidade: 1, peso: null, precoUnitario: 2000, desconto: 0 },
  ],
  descontoVenda: 0,
  pagamentos: [{ forma, valor: valorPago }],
  emitirNfce: false,
})

describe('composição do esperado (RF-11)', () => {
  it('as linhas somam exatamente o esperado', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    vendasRepo.finalizar(venda(caixa.id, 'dinheiro', 5000)) // total 2000, troco 3000
    caixaRepo.movimentar(caixa.id, 'suprimento', 5000, 'reforço', 1, 2)
    caixaRepo.movimentar(caixa.id, 'sangria', 3000, 'retirada', 1, 2)

    const { linhas, total } = await caixaRepo.composicaoEsperado(caixa.id)
    expect(linhas.reduce((a, l) => a + l.valor, 0)).toBe(total)
    // 10000 abertura + 5000 suprimento - 3000 sangria + 5000 recebido - 3000 troco
    expect(total).toBe(14000)
    expect(await caixaRepo.saldoEsperado(caixa.id)).toBe(total)
  })

  it('desconta o troco — o erro clássico da conferência', async () => {
    const caixa = caixaRepo.abrir(1, 0)
    vendasRepo.finalizar(venda(caixa.id, 'dinheiro', 5000)) // total 2000 → troco 3000
    const { linhas } = await caixaRepo.composicaoEsperado(caixa.id)
    expect(linhas.find((l) => l.rotulo === 'Troco devolvido')?.valor).toBe(-3000)
    expect(await caixaRepo.saldoEsperado(caixa.id)).toBe(2000)
  })

  it('venda em cartão não entra no esperado da gaveta', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    vendasRepo.finalizar(venda(caixa.id, 'debito', 2000))
    expect(await caixaRepo.saldoEsperado(caixa.id)).toBe(10000)
  })

  it('sangria aparece com sinal negativo na composição', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    caixaRepo.movimentar(caixa.id, 'sangria', 2500, 'retirada', 1, 2)
    const { linhas } = await caixaRepo.composicaoEsperado(caixa.id)
    expect(linhas.find((l) => l.rotulo === 'Sangrias')?.valor).toBe(-2500)
  })
})

describe('bloqueios de fechamento (RF-11)', () => {
  it('venda em espera impede o fechamento', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    getDb()
      .insert(schema.vendasEspera)
      .values({ id: 'v1', payloadJson: '{}', criadoEm: new Date().toISOString() })
      .run()
    const bloqueios = await caixaRepo.bloqueiosFechamento(caixa.id, 1)
    expect(bloqueios.some((b) => /espera/i.test(b))).toBe(true)
  })

  it('rascunho de venda em andamento impede o fechamento', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    getDb()
      .insert(schema.vendasEspera)
      .values({ id: RASCUNHO_ID, payloadJson: '{}', criadoEm: new Date().toISOString() })
      .run()
    const bloqueios = await caixaRepo.bloqueiosFechamento(caixa.id, 1)
    expect(bloqueios.some((b) => /andamento/i.test(b))).toBe(true)
  })

  it('operador não fecha caixa aberto por outro operador', async () => {
    const caixa = caixaRepo.abrir(1, 10000) // aberto pelo usuário 1
    const bloqueios = await caixaRepo.bloqueiosFechamento(caixa.id, 3) // outro operador
    expect(bloqueios.some((b) => /próprio caixa/i.test(b))).toBe(true)
  })

  it('supervisor fecha caixa de qualquer operador', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    expect(await caixaRepo.bloqueiosFechamento(caixa.id, 2)).toEqual([])
  })

  it('caixa já fechado não fecha de novo', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    await caixaRepo.fechar(caixa.id, 1, 10000)
    const bloqueios = await caixaRepo.bloqueiosFechamento(caixa.id, 1)
    expect(bloqueios.some((b) => /já está fechado/i.test(b))).toBe(true)
  })
})

describe('resumo pré-fechamento — conferência cega', () => {
  it('não expõe nenhum valor monetário', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    vendasRepo.finalizar(venda(caixa.id, 'dinheiro', 2000))
    const resumo = await caixaRepo.resumoPreFechamento(caixa.id, 1)

    // O contrato do resumo é justamente NÃO carregar dinheiro: se o esperado
    // chega ao renderer antes da contagem, o operador digita o que está na tela.
    const serializado = JSON.stringify(resumo)
    expect(serializado).not.toContain('10000')
    expect(serializado).not.toContain('esperado')
    expect(Object.keys(resumo).sort()).toEqual(
      ['abertoEm', 'bloqueios', 'caixaId', 'operadorAbertura', 'quantidadeVendas', 'temRascunho', 'vendasEmEspera'],
    )
    expect(resumo.quantidadeVendas).toBe(1)
    expect(resumo.operadorAbertura).toBe('Op')
  })
})

describe('relatório de fechamento (RF-13)', () => {
  it('recalcula o esperado em vez de ler texto persistido', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    vendasRepo.finalizar(venda(caixa.id, 'dinheiro', 2000))
    await caixaRepo.fechar(caixa.id, 2, 11500, 'quebra de caixa', 2)

    const r = await caixaRepo.relatorioFechamento(caixa.id)
    expect(r.conferencia.esperado).toBe(12000)
    expect(r.conferencia.contado).toBe(11500)
    expect(r.conferencia.diferenca).toBe(-500)
    expect(r.conferencia.motivo).toBe('quebra de caixa')
    expect(r.operadorAbertura).toBe('Op')
    expect(r.operadorFechamento).toBe('Sup')
  })

  it('separa totais por forma de pagamento, líquidos de troco', async () => {
    const caixa = caixaRepo.abrir(1, 0)
    vendasRepo.finalizar(venda(caixa.id, 'dinheiro', 5000)) // 2000 líquido
    vendasRepo.finalizar(venda(caixa.id, 'debito', 2000))
    await caixaRepo.fechar(caixa.id, 1, 2000)

    const r = await caixaRepo.relatorioFechamento(caixa.id)
    const dinheiro = r.porForma.find((f) => f.forma === 'dinheiro')!
    const debito = r.porForma.find((f) => f.forma === 'debito')!
    expect(dinheiro.valor).toBe(2000)
    expect(debito.valor).toBe(2000)
    expect(r.vendas.quantidade).toBe(2)
    expect(r.vendas.total).toBe(4000)
  })

  it('traz as movimentações com motivo e autorizador', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    caixaRepo.movimentar(caixa.id, 'sangria', 3000, 'depósito bancário', 1, 2)
    await caixaRepo.fechar(caixa.id, 1, 7000)

    const r = await caixaRepo.relatorioFechamento(caixa.id)
    const sangria = r.movimentos.find((m) => m.tipo === 'sangria')!
    expect(sangria.motivo).toBe('depósito bancário')
    expect(sangria.operador).toBe('Op')
    expect(sangria.autorizadoPor).toBe('Sup')
  })

  it('o movimento de fechamento não entra no esperado', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    await caixaRepo.fechar(caixa.id, 1, 99999) // contado absurdo
    const r = await caixaRepo.relatorioFechamento(caixa.id)
    expect(r.conferencia.esperado).toBe(10000) // não somou o contado
  })
})

describe('cupom de fechamento (RF-13)', () => {
  it('é montável sem impressora e traz esperado, contado e diferença', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    vendasRepo.finalizar(venda(caixa.id, 'dinheiro', 2000))
    caixaRepo.movimentar(caixa.id, 'sangria', 1000, 'retirada', 1, 2)
    await caixaRepo.fechar(caixa.id, 2, 11000, 'conferido', 2)

    const linhas = montarCupomFechamento(await caixaRepo.relatorioFechamento(caixa.id))
    const texto = linhas.join('\n')
    expect(texto).toContain('FECHAMENTO DE CAIXA')
    expect(texto).toContain('ESPERADO')
    expect(texto).toContain('CONTADO')
    expect(texto).toMatch(/SOBRA|FALTA|SEM DIFERENCA/)
    expect(texto).toContain('conferido')
    expect(texto).toContain('SANGRIA')
  })

  it('respeita a largura da bobina', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    await caixaRepo.fechar(caixa.id, 1, 10000)
    const linhas = montarCupomFechamento(await caixaRepo.relatorioFechamento(caixa.id), 32)
    expect(linhas.every((l) => l.length <= 32)).toBe(true)
  })

  it('marca "SEM DIFERENCA" quando bate exato', async () => {
    const caixa = caixaRepo.abrir(1, 10000)
    await caixaRepo.fechar(caixa.id, 1, 10000)
    const texto = montarCupomFechamento(await caixaRepo.relatorioFechamento(caixa.id)).join('\n')
    expect(texto).toContain('SEM DIFERENCA')
  })
})

describe('contagem por denominação', () => {
  it('soma cédulas e moedas em centavos', () => {
    // 2×R$50 + 3×R$10 + 1×R$0,25 = 10000 + 3000 + 25
    expect(somarContagem({ 5000: 2, 1000: 3, 25: 1 })).toBe(13025)
  })

  it('quantidade ausente ou zero não altera o total', () => {
    expect(somarContagem({})).toBe(0)
    expect(somarContagem({ 5000: 0, 100: 2 })).toBe(200)
  })
})
