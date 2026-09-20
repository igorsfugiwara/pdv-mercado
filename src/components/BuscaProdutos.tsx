import { useEffect, useRef, useState } from 'react'
import type { Produto } from '@shared/types'
import { formatBRL } from '../lib/money'

/** Exportado para o teste poder esperar exatamente este intervalo. */
export const ATRASO_BUSCA_MS = 120

// RF-02: busca por EAN, código interno ou nome (autocomplete).
export default function BuscaProdutos({
  onSelecionar,
  onFechar,
}: {
  onSelecionar: (p: Produto) => void
  onFechar: () => void
}) {
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<Produto[]>([])
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounce de 120 ms (RF-02). O `vivo` sozinho evitava o set tardio, mas não
  // evitava a consulta: digitando "arroz" saíam cinco idas ao banco. O atraso é
  // curto o bastante para não ser percebido como lentidão.
  useEffect(() => {
    if (!termo) {
      setResultados([])
      return
    }
    let vivo = true
    const t = setTimeout(() => {
      void window.api.produtos.buscar(termo).then((r) => {
        if (vivo) setResultados(r)
      })
    }, ATRASO_BUSCA_MS)

    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [termo])

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onFechar()
    else if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, resultados.length - 1))
    else if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0))
    else if (e.key === 'Enter' && resultados[sel]) onSelecionar(resultados[sel])
  }

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center bg-black/60 pt-24" onClick={onFechar}>
      <div className="card w-[640px]" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="input mb-3"
          placeholder="Buscar produto por nome, EAN ou código…"
          value={termo}
          onChange={(e) => { setTermo(e.target.value); setSel(0) }}
          onKeyDown={onKey}
        />
        <ul className="max-h-80 overflow-auto">
          {resultados.map((p, i) => (
            <li
              key={p.id}
              className={`flex cursor-pointer items-center justify-between rounded px-3 py-2 ${
                i === sel ? 'bg-primary text-text-inverse' : 'hover:bg-surface-alt'
              }`}
              onClick={() => onSelecionar(p)}
            >
              <span>
                {p.descricao} {p.pesavel && <span className="text-xs">(kg)</span>}
              </span>
              <span className="font-mono">{formatBRL(p.precoVenda)}</span>
            </li>
          ))}
          {termo && resultados.length === 0 && (
            <li className="px-3 py-4 text-center text-text-muted">Nada encontrado.</li>
          )}
        </ul>
      </div>
    </div>
  )
}
