import type { Usuario } from '@shared/types'

// Estado de sessão do processo main (cliente único — seção 2.3).
// Guardado no main, nunca no renderer.
let operadorAtual: Usuario | null = null

export const session = {
  get(): Usuario | null {
    return operadorAtual
  },
  set(u: Usuario | null) {
    operadorAtual = u
  },
  exigir(): Usuario {
    if (!operadorAtual) throw new Error('Nenhum operador autenticado.')
    return operadorAtual
  },
}
