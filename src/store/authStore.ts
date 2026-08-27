import { create } from 'zustand'
import type { Usuario } from '@shared/types'

interface AuthState {
  usuario: Usuario | null
  erro: string | null
  login: (login: string, senha: string) => Promise<boolean>
  trocarOperador: (pin: string) => Promise<boolean>
  logout: () => Promise<void>
  temPerfil: (...perfis: Usuario['perfil'][]) => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  usuario: null,
  erro: null,
  async login(login, senha) {
    // Sem este catch, uma falha de transporte (IPC indisponível, backend web sem
    // API) vira promise rejeitada e a tela fica presa em "Entrando…" sem dizer
    // nada — indistinguível de senha errada para quem está usando.
    try {
      const r = await window.api.auth.login(login, senha)
      if (r.ok && r.usuario) {
        set({ usuario: r.usuario, erro: null })
        return true
      }
      set({ erro: r.erro ?? 'Falha no login' })
      return false
    } catch (e) {
      set({ erro: e instanceof Error ? e.message : 'Falha ao contatar o servidor.' })
      return false
    }
  },
  async trocarOperador(pin) {
    try {
      const r = await window.api.auth.trocarOperador(pin)
      if (r.ok && r.usuario) {
        set({ usuario: r.usuario, erro: null })
        return true
      }
      set({ erro: r.erro ?? 'PIN inválido' })
      return false
    } catch (e) {
      set({ erro: e instanceof Error ? e.message : 'Falha ao contatar o servidor.' })
      return false
    }
  },
  async logout() {
    await window.api.auth.logout()
    set({ usuario: null })
  },
  temPerfil(...perfis) {
    const u = get().usuario
    return !!u && perfis.includes(u.perfil)
  },
}))
