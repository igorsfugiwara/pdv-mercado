import type { Usuario, Perfil } from '@shared/types'

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
  /**
   * Exige um dos perfis informados. A checagem mora no main de propósito: o
   * renderer pode esconder o botão, mas quem nega é este lado.
   * A fatia 03 amplia isto para limites por perfil e autorização por PIN.
   */
  exigirPerfil(...perfis: Perfil[]): Usuario {
    const u = this.exigir()
    if (!perfis.includes(u.perfil)) {
      throw new Error(`Ação restrita a: ${perfis.join(', ')}.`)
    }
    return u
  },
}
