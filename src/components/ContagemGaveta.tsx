import { useMemo, useState } from 'react'
import { formatBRL } from '../lib/money'

// Cédulas e moedas em centavos. É como o operador conta na prática — em pilhas,
// não somando de cabeça — e digitar quantidade erra menos que digitar o total.
const DENOMINACOES = [
  { valor: 20000, rotulo: 'R$ 200' },
  { valor: 10000, rotulo: 'R$ 100' },
  { valor: 5000, rotulo: 'R$ 50' },
  { valor: 2000, rotulo: 'R$ 20' },
  { valor: 1000, rotulo: 'R$ 10' },
  { valor: 500, rotulo: 'R$ 5' },
  { valor: 200, rotulo: 'R$ 2' },
  { valor: 100, rotulo: 'R$ 1' },
  { valor: 50, rotulo: 'R$ 0,50' },
  { valor: 25, rotulo: 'R$ 0,25' },
  { valor: 10, rotulo: 'R$ 0,10' },
  { valor: 5, rotulo: 'R$ 0,05' },
] as const

/** Soma pura da contagem por denominação — exportada para teste. */
export function somarContagem(quantidades: Record<number, number>): number {
  return DENOMINACOES.reduce((total, d) => total + d.valor * (quantidades[d.valor] || 0), 0)
}

export default function ContagemGaveta({ onTotal }: { onTotal: (centavos: number) => void }) {
  const [quantidades, setQuantidades] = useState<Record<number, number>>({})

  const total = useMemo(() => somarContagem(quantidades), [quantidades])

  function definir(valor: number, texto: string) {
    const n = parseInt(texto.replace(/\D/g, ''), 10)
    const proximo = { ...quantidades, [valor]: Number.isFinite(n) ? n : 0 }
    setQuantidades(proximo)
    onTotal(somarContagem(proximo))
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {DENOMINACOES.map((d) => (
          <label key={d.valor} className="flex items-center gap-2 rounded bg-surface-alt px-2 py-1">
            <span className="w-20 shrink-0 text-sm text-text-muted">{d.rotulo}</span>
            <input
              className="input w-full py-1 text-right font-mono"
              inputMode="numeric"
              value={quantidades[d.valor] ?? ''}
              placeholder="0"
              onChange={(e) => definir(d.valor, e.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-border pt-2">
        <span className="text-sm text-text-muted">Total contado</span>
        <span className="font-mono text-xl text-primary">{formatBRL(total)}</span>
      </div>
    </div>
  )
}
