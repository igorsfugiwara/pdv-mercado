import { useEffect, useState } from 'react'
import type { Produto } from '@shared/types'
import { useAuthStore } from '../store/authStore'

export default function EstoqueScreen() {
  const usuario = useAuthStore((s) => s.usuario)!
  const [alertas, setAlertas] = useState<Produto[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])

  async function recarregar() {
    setAlertas(await window.api.estoque.alertasMinimo())
    setProdutos(await window.api.produtos.listar(false))
  }
  useEffect(() => { void recarregar() }, [])

  async function entrada(p: Produto) {
    const qtd = prompt(`Entrada de mercadoria — ${p.descricao}\nQuantidade:`)
    if (!qtd) return
    const motivo = prompt('Motivo/NF de referência:') ?? ''
    await window.api.estoque.entrada(p.id, parseFloat(qtd.replace(',', '.')), usuario.id, motivo)
    await recarregar()
  }

  async function ajuste(p: Produto) {
    const saldo = prompt(`Ajuste de inventário — ${p.descricao}\nNovo saldo:`, String(p.estoqueAtual))
    if (saldo == null) return
    const motivo = prompt('Motivo do ajuste:') ?? ''
    await window.api.estoque.ajuste(p.id, parseFloat(saldo.replace(',', '.')), usuario.id, motivo)
    await recarregar()
  }

  return (
    <div className="p-4">
      <h1 className="mb-4 font-display text-2xl text-primary">Estoque</h1>

      {alertas.length > 0 && (
        <div className="card mb-4 border-warning/50">
          <h2 className="mb-2 text-sm font-semibold uppercase text-warning">
            Alerta de estoque mínimo ({alertas.length})
          </h2>
          <ul className="grid grid-cols-2 gap-1 text-sm">
            {alertas.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{p.descricao}</span>
                <span className="font-mono text-warning">
                  {p.estoqueAtual} / mín {p.estoqueMinimo}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-text-muted">
          <tr className="border-b border-border">
            <th className="py-2">Produto</th>
            <th className="text-right">Saldo</th>
            <th className="text-right">Mínimo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {produtos.map((p) => (
            <tr key={p.id} className="border-b border-border/40">
              <td className="py-2">{p.descricao}</td>
              <td className="text-right font-mono">{p.estoqueAtual}</td>
              <td className="text-right font-mono">{p.estoqueMinimo}</td>
              <td className="space-x-3 text-right">
                <button className="text-success" onClick={() => entrada(p)}>entrada</button>
                <button className="text-primary" onClick={() => ajuste(p)}>ajuste</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
