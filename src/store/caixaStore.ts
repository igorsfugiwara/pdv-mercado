import { create } from 'zustand'
import type { Caixa, ResultadoFechamento } from '@shared/types'

interface CaixaState {
  caixa: Caixa | null
  carregar: () => Promise<void>
  abrir: (usuarioId: number, valor: number) => Promise<void>
  fechar: (
    usuarioId: number,
    contado: number,
    motivo?: string | null,
    autorizadoPorId?: number | null,
  ) => Promise<ResultadoFechamento>
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
  async fechar(usuarioId, contado, motivo = null, autorizadoPorId = null) {
    const caixa = get().caixa
    if (!caixa) throw new Error('Nenhum caixa aberto')
    const r = await window.api.caixa.fechar(
      caixa.id,
      usuarioId,
      contado,
      motivo,
      autorizadoPorId,
    )
    // Só zera o caixa local quando ele realmente fechou — `bloqueado` e
    // `requer_justificativa` deixam o turno aberto e o operador segue na tela.
    if (r.status === 'fechado') set({ caixa: null })
    return r
  },
}))
