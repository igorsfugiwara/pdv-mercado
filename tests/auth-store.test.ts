import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Caminho de erro do login. Foi exatamente isto que fez um erro trivial
 * (app aberto no navegador, sem /api) virar "não consigo acessar": a promise
 * rejeitava, ninguém capturava, e a tela ficava presa sem mensagem.
 */
const api = {
  auth: {
    login: vi.fn(),
    trocarOperador: vi.fn(),
    logout: vi.fn(),
    autorizarSupervisor: vi.fn(),
  },
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  // O renderer roda no navegador; no teste basta o `window.api` que ele consome.
  ;(globalThis as any).window = { api }
})

async function store() {
  return (await import('../src/store/authStore')).useAuthStore
}

describe('authStore.login', () => {
  it('autentica e guarda o usuário', async () => {
    api.auth.login.mockResolvedValue({ ok: true, usuario: { id: 1, nome: 'Op', perfil: 'operador' } })
    const s = await store()
    expect(await s.getState().login('caixa', 'caixa123')).toBe(true)
    expect(s.getState().usuario?.nome).toBe('Op')
    expect(s.getState().erro).toBeNull()
  })

  it('credencial inválida vira mensagem, não exceção', async () => {
    api.auth.login.mockResolvedValue({ ok: false, erro: 'Credenciais inválidas.' })
    const s = await store()
    expect(await s.getState().login('caixa', 'errada')).toBe(false)
    expect(s.getState().erro).toBe('Credenciais inválidas.')
  })

  it('falha de transporte não rejeita — devolve false com a mensagem do erro', async () => {
    api.auth.login.mockRejectedValue(new Error('API não encontrada.'))
    const s = await store()
    await expect(s.getState().login('caixa', 'caixa123')).resolves.toBe(false)
    expect(s.getState().erro).toBe('API não encontrada.')
    expect(s.getState().usuario).toBeNull()
  })

  it('rejeição sem Error ainda produz mensagem legível', async () => {
    api.auth.login.mockRejectedValue('boom')
    const s = await store()
    expect(await s.getState().login('x', 'y')).toBe(false)
    expect(s.getState().erro).toMatch(/servidor/i)
  })
})

describe('authStore.trocarOperador', () => {
  it('falha de transporte não derruba o caixa no meio do turno', async () => {
    api.auth.trocarOperador.mockRejectedValue(new Error('IPC indisponível'))
    const s = await store()
    await expect(s.getState().trocarOperador('1111')).resolves.toBe(false)
    expect(s.getState().erro).toBe('IPC indisponível')
  })
})
