import { create } from 'zustand'
import type { Produto, ItemCarrinho, FormaPagamento, FinalizarVendaInput } from '@shared/types'

interface CarrinhoState {
  itens: ItemCarrinho[]
  descontoVenda: number // centavos
  clienteCpf: string | null
  multiplicador: number // RF-04
  setMultiplicador: (n: number) => void
  hidratar: (input: FinalizarVendaInput) => void
  adicionarProduto: (p: Produto, opts?: { quantidade?: number; peso?: number }) => void
  removerItem: (index: number) => void
  aplicarDescontoItem: (index: number, valor: number) => void
  aplicarDescontoVenda: (valor: number) => void
  setCpf: (cpf: string | null) => void
  limpar: () => void
  subtotal: () => number
  total: () => number
  restante: (pagamentos: { valor: number }[]) => number
}

export const useCarrinhoStore = create<CarrinhoState>((set, get) => ({
  itens: [],
  descontoVenda: 0,
  clienteCpf: null,
  multiplicador: 1,

  setMultiplicador: (n) => set({ multiplicador: Math.max(1, n) }),

  // Invariante 4 / RF-26: restaura um rascunho (pós-queda) ou venda em espera.
  hidratar: (input) => {
    set({
      itens: input.itens,
      descontoVenda: input.descontoVenda,
      clienteCpf: input.clienteCpf,
      multiplicador: 1,
    })
    void persistirRascunho(get)
  },

  adicionarProduto: (p, opts) => {
    const quantidade = opts?.peso ?? opts?.quantidade ?? get().multiplicador
    const item: ItemCarrinho = {
      produtoId: p.id,
      descricao: p.descricao,
      quantidade,
      peso: opts?.peso ?? null,
      precoUnitario: p.precoVenda,
      desconto: 0,
    }
    set((s) => ({ itens: [...s.itens, item], multiplicador: 1 }))
    void persistirRascunho(get)
  },

  removerItem: (index) => {
    set((s) => ({ itens: s.itens.filter((_, i) => i !== index) }))
    void persistirRascunho(get)
  },

  aplicarDescontoItem: (index, valor) => {
    set((s) => ({
      itens: s.itens.map((it, i) => (i === index ? { ...it, desconto: valor } : it)),
    }))
    void persistirRascunho(get)
  },

  aplicarDescontoVenda: (valor) => {
    set({ descontoVenda: valor })
    void persistirRascunho(get)
  },
  setCpf: (cpf) => {
    set({ clienteCpf: cpf })
    void persistirRascunho(get)
  },

  limpar: () => {
    set({ itens: [], descontoVenda: 0, clienteCpf: null, multiplicador: 1 })
    void window.api.vendas.salvarRascunho(null)
  },

  subtotal: () =>
    get().itens.reduce((a, i) => a + Math.round(i.precoUnitario * i.quantidade) - i.desconto, 0),

  total: () => Math.max(0, get().subtotal() - get().descontoVenda),

  restante: (pagamentos) => {
    const pago = pagamentos.reduce((a, p) => a + p.valor, 0)
    return get().total() - pago
  },
}))

// Invariante 4: rascunho persistido a cada item.
function persistirRascunho(get: () => CarrinhoState) {
  const s = get()
  if (s.itens.length === 0) return window.api.vendas.salvarRascunho(null)
  return window.api.vendas.salvarRascunho({
    caixaId: 0,
    usuarioId: 0,
    clienteCpf: s.clienteCpf,
    itens: s.itens,
    descontoVenda: s.descontoVenda,
    pagamentos: [],
    emitirNfce: true,
  })
}

export const FORMAS_PAGAMENTO: { forma: FormaPagamento; label: string }[] = [
  { forma: 'dinheiro', label: 'Dinheiro' },
  { forma: 'debito', label: 'Débito' },
  { forma: 'credito', label: 'Crédito' },
  { forma: 'pix', label: 'PIX' },
  { forma: 'voucher', label: 'Voucher' },
]
