import { useEffect, useState } from 'react'
import { useCaixaStore } from '../store/caixaStore'
import { useAuthStore } from '../store/authStore'
import { parseBRL } from '../lib/money'
import type { VereditoRelogio } from '@shared/relogio'

// RF-11: abertura de caixa com fundo de troco.
export default function AberturaCaixa() {
  const abrir = useCaixaStore((s) => s.abrir)
  const usuario = useAuthStore((s) => s.usuario)!
  const [valor, setValor] = useState('0,00')
  const [ocupado, setOcupado] = useState(false)
  const [relogio, setRelogio] = useState<VereditoRelogio | null>(null)
  const [cienteDoRelogio, setCiente] = useState(false)

  // Relógio errado tem consequência fiscal: o operador precisa saber ANTES de
  // abrir o turno, não depois da primeira nota recusada.
  useEffect(() => {
    void window.api.relogio
      .verificar()
      .then((v) => setRelogio(v.gravidade === 'ok' ? null : v))
      .catch(() => setRelogio(null))
  }, [])

  // Não bloqueia: uma loja que não pode vender perde mais do que uma nota com
  // hora torta. Mas ninguém segue sem saber.
  const exigeCiencia = relogio?.gravidade === 'bloqueio' && !cienteDoRelogio

  async function confirmar() {
    if (exigeCiencia) return
    setOcupado(true)
    await abrir(usuario.id, parseBRL(valor))
    setOcupado(false)
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="card w-96 space-y-4">
        <h2 className="font-display text-2xl text-primary">Abertura de caixa</h2>
        <p className="text-sm text-text-muted">Informe o fundo de troco para iniciar o dia.</p>

        {relogio && (
          <div
            role="alert"
            className="rounded-md border border-danger/40 border-l-4 border-l-danger bg-danger/10 px-3 py-2"
          >
            <p className="text-sm text-danger">Relógio fora de hora</p>
            <p className="mt-1 text-xs text-text-muted">{relogio.mensagem}</p>
            {relogio.gravidade === 'bloqueio' && (
              <label className="mt-2 flex items-center gap-2 text-xs text-text">
                <input
                  type="checkbox"
                  checked={cienteDoRelogio}
                  onChange={(e) => setCiente(e.target.checked)}
                />
                Estou ciente e quero abrir o caixa assim mesmo
              </label>
            )}
          </div>
        )}
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
              if (e.key === 'Enter' && !ocupado && !exigeCiencia) confirmar()
            }}
          />
        </div>
        <button className="btn-primary w-full" onClick={confirmar} disabled={ocupado || exigeCiencia}>
          Abrir caixa
        </button>
      </div>
    </div>
  )
}
