import { useState } from 'react'
import { useCaixaStore } from '../store/caixaStore'
import { useAuthStore } from '../store/authStore'
import { parseBRL } from '../lib/money'

// RF-11: abertura de caixa com fundo de troco.
export default function AberturaCaixa() {
  const abrir = useCaixaStore((s) => s.abrir)
  const usuario = useAuthStore((s) => s.usuario)!
  const [valor, setValor] = useState('0,00')
  const [ocupado, setOcupado] = useState(false)

  async function confirmar() {
    setOcupado(true)
    await abrir(usuario.id, parseBRL(valor))
    setOcupado(false)
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="card w-96 space-y-4">
        <h2 className="font-display text-2xl text-primary">Abertura de caixa</h2>
        <p className="text-sm text-text-muted">Informe o fundo de troco para iniciar o dia.</p>
        <div>
          <label className="mb-1 block text-sm text-text-muted">Fundo de troco (R$)</label>
          <input
            className="input font-mono text-lg"
            autoFocus
            aria-label="Fundo de troco"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            // RF-10: o caixa abre sem tirar a mão do teclado.
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !ocupado) confirmar()
            }}
          />
        </div>
        <button className="btn-primary w-full" onClick={confirmar} disabled={ocupado}>
          Abrir caixa
        </button>
      </div>
    </div>
  )
}
