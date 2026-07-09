import { create } from 'zustand'
import type { Caixa } from '@shared/types'

interface CaixaState {
  caixa: Caixa | null
  carregar: () => Promise<void>
  abrir: (usuarioId: number, valor: number) => Promise<void>
  fechar: (usuarioId: number, contado: number) => Promise<{ diferenca: number }>
}

export const useCaixaStore = create<CaixaState>((set, get) => ({
  caixa: null,
  async carregar() {
    set({ caixa: await window.api.caixa.atual() })
  },
  async abrir(usuarioId, valor) {
    const caixa = await window.api.caixa.abrir(usuarioId, valor)
    set({ caixa })
  },
  async fechar(usuarioId, contado) {
    const caixa = get().caixa
    if (!caixa) throw new Error('Nenhum caixa aberto')
    const r = await window.api.caixa.fechar(caixa.id, usuarioId, contado)
    set({ caixa: null })
    return r
  },
}))
