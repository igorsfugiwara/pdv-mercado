import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Produto } from '../shared/types'

// O carrinho persiste rascunho a cada mudança (invariante 4); no teste basta o stub.
const api = { vendas: { salvarRascunho: vi.fn().mockResolvedValue(undefined) } }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  ;(globalThis as any).window = { api }
})

const produto = (over: Partial<Produto> = {}): Produto =>
  ({
    id: 1,
    codigoInterno: '1001',
    ean: '789',
    descricao: 'Arroz Branco 5kg',
    unidade: 'UN',
    pesavel: false,
    precoCusto: 1800,
    precoVenda: 2790,
    estoqueAtual: 40,
    estoqueMinimo: 10,
    grupoId: null,
    imagemPath: null,
    ativo: true,
    ncm: '1',
    cest: null,
    cfop: '5102',
    origem: '0',
    csosn: '102',
    cstPis: null,
    aliqPis: null,
    cstCofins: null,
    aliqCofins: null,
    criadoEm: '',
    atualizadoEm: '',
    ...over,
  }) as Produto

async function carrinho() {
  const { useCarrinhoStore } = await import('../src/store/carrinhoStore')
  return useCarrinhoStore
}

describe('empilhamento de itens iguais', () => {
  it('bipar o mesmo produto duas vezes soma na mesma linha', async () => {
    const c = await carrinho()
    const p = produto()
    expect(c.getState().adicionarProduto(p)).toBe(0)
    expect(c.getState().adicionarProduto(p)).toBe(0)
    expect(c.getState().itens).toHaveLength(1)
    expect(c.getState().itens[0].quantidade).toBe(2)
    expect(c.getState().subtotal()).toBe(5580)
  })

  it('respeita o multiplicador ao somar', async () => {
    const c = await carrinho()
    const p = produto()
    c.getState().adicionarProduto(p)
    c.getState().setMultiplicador(3)
    c.getState().adicionarProduto(p)
    expect(c.getState().itens[0].quantidade).toBe(4)
    // Multiplicador é de uso único (RF-04).
    expect(c.getState().multiplicador).toBe(1)
  })

  it('produtos diferentes ficam em linhas separadas', async () => {
    const c = await carrinho()
    c.getState().adicionarProduto(produto())
    expect(c.getState().adicionarProduto(produto({ id: 2, descricao: 'Feijão' }))).toBe(1)
    expect(c.getState().itens).toHaveLength(2)
  })

  it('pesável NÃO empilha — cada pesagem é uma medição distinta', async () => {
    const c = await carrinho()
    const p = produto({ id: 9, descricao: 'Banana (kg)', pesavel: true, precoVenda: 599 })
    c.getState().adicionarProduto(p, { peso: 1.5 })
    c.getState().adicionarProduto(p, { peso: 0.8 })
    expect(c.getState().itens).toHaveLength(2)
    expect(c.getState().itens.map((i) => i.peso)).toEqual([1.5, 0.8])
  })

  it('linha com desconto por item não recebe soma — mudaria o desconto acordado', async () => {
    const c = await carrinho()
    const p = produto()
    c.getState().adicionarProduto(p)
    c.getState().aplicarDescontoItem(0, 500)
    expect(c.getState().adicionarProduto(p)).toBe(1)
    expect(c.getState().itens).toHaveLength(2)
    expect(c.getState().itens[0].desconto).toBe(500)
    expect(c.getState().itens[1].desconto).toBe(0)
  })

  it('preço remarcado no meio da venda abre linha nova', async () => {
    const c = await carrinho()
    c.getState().adicionarProduto(produto())
    expect(c.getState().adicionarProduto(produto({ precoVenda: 2990 }))).toBe(1)
    expect(c.getState().itens).toHaveLength(2)
  })

  it('o índice devolvido aponta para a linha afetada', async () => {
    const c = await carrinho()
    c.getState().adicionarProduto(produto({ id: 1 }))
    c.getState().adicionarProduto(produto({ id: 2, descricao: 'B' }))
    // Volta ao primeiro produto: deve somar na linha 0, não criar a linha 2.
    expect(c.getState().adicionarProduto(produto({ id: 1 }))).toBe(0)
    expect(c.getState().itens).toHaveLength(2)
    expect(c.getState().itens[0].quantidade).toBe(2)
  })
})
