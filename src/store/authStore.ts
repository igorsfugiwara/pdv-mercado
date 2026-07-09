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
    const r = await window.api.auth.login(login, senha)
    if (r.ok && r.usuario) {
      set({ usuario: r.usuario, erro: null })
      return true
    }
    set({ erro: r.erro ?? 'Falha no login' })
    return false
  },
  async trocarOperador(pin) {
    const r = await window.api.auth.trocarOperador(pin)
    if (r.ok && r.usuario) {
      set({ usuario: r.usuario, erro: null })
      return true
    }
    set({ erro: r.erro ?? 'PIN inválido' })
    return false
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
