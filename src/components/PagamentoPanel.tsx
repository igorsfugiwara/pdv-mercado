import { useState } from 'react'
import type { FormaPagamento, PagamentoInput } from '@shared/types'
import { formatBRL, parseBRL } from '../lib/money'

// RF-07: múltiplas formas de pagamento na mesma venda; dinheiro com troco.
export default function PagamentoPanel({
  total,
  formas,
  onConfirmar,
  onFechar,
}: {
  total: number
  formas: { forma: FormaPagamento; label: string }[]
  onConfirmar: (pagamentos: PagamentoInput[], emitirNfce: boolean) => void
  onFechar: () => void
}) {
  const [pagamentos, setPagamentos] = useState<PagamentoInput[]>([])
  const [valor, setValor] = useState('')
  const [emitirNfce, setEmitirNfce] = useState(true)

  const pago = pagamentos.reduce((a, p) => a + p.valor, 0)
  const restante = total - pago
  const troco = Math.max(0, pago - total)

  /**
   * RF-10: o pagamento inteiro por teclado.
   *
   * Alt+1..5 lança a forma correspondente (a ordem é a da lista), Enter
   * finaliza quando não falta valor, Esc fecha. Sem isto o operador precisa do
   * mouse justamente no passo mais repetido do dia.
   */
  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onFechar()
      return
    }
    if (e.altKey && /^[1-9]$/.test(e.key)) {
      const escolhida = formas[Number(e.key) - 1]
      if (escolhida) {
        e.preventDefault()
        adicionar(escolhida.forma)
      }
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      // Enter com valor digitado e nada lançado ainda: assume dinheiro, que é
      // o caso esmagadoramente mais comum.
      if (pagamentos.length === 0) {
        adicionar(formas[0].forma)
        return
      }
      if (restante <= 0) onConfirmar(pagamentos, emitirNfce)
    }
  }

  function adicionar(forma: FormaPagamento) {
    const v = valor ? parseBRL(valor) : Math.max(0, restante)
    if (v <= 0) return
    setPagamentos((ps) => [...ps, { forma, valor: v }])
    setValor('')
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/60"
      onClick={onFechar}
      onKeyDown={aoTeclar}
    >
      <div className="card w-[560px] space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl text-primary">Pagamento</h2>
          <span className="font-mono text-3xl">{formatBRL(total)}</span>
        </div>

        <input
          className="input font-mono text-lg"
          autoFocus
          placeholder={`Valor (padrão: restante ${formatBRL(Math.max(0, restante))})`}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />

        <div className="grid grid-cols-3 gap-2">
          {formas.map((f, i) => (
            <button key={f.forma} className="btn-ghost" onClick={() => adicionar(f.forma)}>
              {f.label}
              <span className="ml-1 text-xs text-text-muted">Alt+{i + 1}</span>
            </button>
          ))}
        </div>

        {pagamentos.length > 0 && (
          <ul className="space-y-1 rounded-md bg-surface-alt p-2 text-sm">
            {pagamentos.map((p, i) => (
              <li key={i} className="flex justify-between">
                <span className="capitalize">{p.forma}</span>
                <span className="font-mono">
                  {formatBRL(p.valor)}
                  <button
                    className="ml-2 text-danger"
                    onClick={() => setPagamentos((ps) => ps.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-between font-mono">
          <span className={restante > 0 ? 'text-warning' : 'text-success'}>
            {restante > 0 ? `Falta ${formatBRL(restante)}` : `Troco ${formatBRL(troco)}`}
          </span>
        </div>

        <label className="flex items-center gap-2 text-sm text-text-muted">
          <input type="checkbox" checked={emitirNfce} onChange={(e) => setEmitirNfce(e.target.checked)} />
          Emitir NFC-e
        </label>

        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onFechar}>
            Cancelar
          </button>
          <button
            className="btn-primary flex-1 py-3"
            disabled={restante > 0}
            onClick={() => onConfirmar(pagamentos, emitirNfce)}
          >
            Finalizar <span className="text-xs opacity-70">(Enter)</span>
          </button>
        </div>
      </div>
    </div>
  )
}
