import { useState } from 'react'
import { useAuthStore } from '../store/authStore'

export default function LoginScreen() {
  const { login, erro } = useAuthStore()
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setCarregando(true)
    try {
      await login(usuario, senha)
    } finally {
      // `finally` para o botão nunca ficar preso em "Entrando…".
      setCarregando(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <form onSubmit={entrar} className="card w-96 space-y-4">
        <div className="text-center">
          <h1 className="font-display text-3xl text-primary">PDV Mercado</h1>
          <p className="text-sm text-text-muted">Frente de caixa · NFC-e SEFAZ-SP</p>
        </div>
        <div>
          <label className="mb-1 block text-sm text-text-muted">Usuário</label>
          <input
            className="input"
            autoFocus
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            placeholder="admin"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-text-muted">Senha</label>
          <input
            className="input"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </div>
        {erro && <p className="text-sm text-danger">{erro}</p>}
        <button className="btn-primary w-full" disabled={carregando}>
          {carregando ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="text-center text-xs text-text-muted">
          Dev: admin / admin123 · caixa / caixa123
        </p>
      </form>
    </div>
  )
}
