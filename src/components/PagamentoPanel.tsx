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

  function adicionar(forma: FormaPagamento) {
    const v = valor ? parseBRL(valor) : Math.max(0, restante)
    if (v <= 0) return
    setPagamentos((ps) => [...ps, { forma, valor: v }])
    setValor('')
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60" onClick={onFechar}>
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
          {formas.map((f) => (
            <button key={f.forma} className="btn-ghost" onClick={() => adicionar(f.forma)}>
              {f.label}
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
            Finalizar
          </button>
        </div>
      </div>
    </div>
  )
}
