import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCarrinhoStore } from '../src/store/carrinhoStore'
import type { Produto } from '../shared/types'

/**
 * Fatia 03 — a parte da regra que vive na store: remover o item certo e
 * descontar no item certo. O PRD é explícito: antes só dava para tirar o
 * último, e se o cliente desistisse do terceiro de dez não havia caminho.
 */
const produto = (id: number, descricao: string, preco: number): Produto =>
  ({
    id,
    codigoInterno: String(id),
    ean: `789${id}`,
    descricao,
    unidade: 'UN',
    pesavel: false,
    precoCusto: Math.round(preco / 2),
    precoVenda: preco,
    estoqueAtual: 10,
    estoqueMinimo: 1,
    ativo: true,
    ncm: '19059090',
    cfop: '5102',
    origem: '0',
    csosn: '102',
    criadoEm: '',
    atualizadoEm: '',
  }) as Produto

// O carrinho persiste rascunho a cada mudança; no teste basta o stub
// (mesma convenção de tests/carrinho-store.test.ts).
beforeEach(() => {
  ;(globalThis as any).window = {
    api: { vendas: { salvarRascunho: vi.fn().mockResolvedValue(undefined) } },
  }
  useCarrinhoStore.setState({ itens: [], descontoVenda: 0, clienteCpf: null, multiplicador: 1 })
})

describe('cancelamento seletivo de item', () => {
  it('remove o item do meio, não o último', () => {
    const cart = useCarrinhoStore.getState()
    cart.adicionarProduto(produto(1, 'Arroz', 2000))
    cart.adicionarProduto(produto(2, 'Feijão', 900))
    cart.adicionarProduto(produto(3, 'Café', 1800))

    // O cliente desistiu do segundo item.
    useCarrinhoStore.getState().removerItem(1)

    const itens = useCarrinhoStore.getState().itens
    expect(itens).toHaveLength(2)
    expect(itens.map((i) => i.descricao)).toEqual(['Arroz', 'Café'])
  })

  it('remover o 3º de 10 tira exatamente aquele', () => {
    const cart = useCarrinhoStore.getState()
    for (let i = 1; i <= 10; i++) cart.adicionarProduto(produto(i, `Item ${i}`, 100 * i))

    useCarrinhoStore.getState().removerItem(2) // índice 2 = terceiro

    const itens = useCarrinhoStore.getState().itens
    expect(itens).toHaveLength(9)
    expect(itens.find((i) => i.descricao === 'Item 3')).toBeUndefined()
    expect(itens.map((i) => i.descricao)).toEqual([
      'Item 1', 'Item 2', 'Item 4', 'Item 5', 'Item 6',
      'Item 7', 'Item 8', 'Item 9', 'Item 10',
    ])
  })
})

describe('desconto por item', () => {
  it('aplica no índice certo e não vaza para os vizinhos', () => {
    const cart = useCarrinhoStore.getState()
    cart.adicionarProduto(produto(1, 'Arroz', 2000))
    cart.adicionarProduto(produto(2, 'Feijão', 1000))

    useCarrinhoStore.getState().aplicarDescontoItem(1, 250)

    const itens = useCarrinhoStore.getState().itens
    expect(itens[0].desconto).toBe(0)
    expect(itens[1].desconto).toBe(250)
  })

  it('entra no subtotal, abatendo só daquele item', () => {
    const cart = useCarrinhoStore.getState()
    cart.adicionarProduto(produto(1, 'Arroz', 2000))
    cart.adicionarProduto(produto(2, 'Feijão', 1000))

    expect(useCarrinhoStore.getState().subtotal()).toBe(3000)

    useCarrinhoStore.getState().aplicarDescontoItem(1, 250)
    expect(useCarrinhoStore.getState().subtotal()).toBe(2750)
  })

  it('desconto de venda e de item somam sem se anular', () => {
    const cart = useCarrinhoStore.getState()
    cart.adicionarProduto(produto(1, 'Arroz', 2000))

    useCarrinhoStore.getState().aplicarDescontoItem(0, 200)
    useCarrinhoStore.getState().aplicarDescontoVenda(300)

    expect(useCarrinhoStore.getState().subtotal()).toBe(1800)
    expect(useCarrinhoStore.getState().total()).toBe(1500)
  })

  it('o total nunca fica negativo', () => {
    const cart = useCarrinhoStore.getState()
    cart.adicionarProduto(produto(1, 'Arroz', 1000))
    useCarrinhoStore.getState().aplicarDescontoVenda(999999)

    expect(useCarrinhoStore.getState().total()).toBe(0)
  })
})

describe('carrinho vazio', () => {
  it('não tem o que cancelar nem o que auditar', () => {
    // Critério 7: F12 com carrinho vazio limpa sem pedir PIN — a tela decide
    // por este estado.
    expect(useCarrinhoStore.getState().itens).toHaveLength(0)
    expect(useCarrinhoStore.getState().total()).toBe(0)
  })
})
