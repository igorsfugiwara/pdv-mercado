import { useEffect, useState, useCallback } from 'react'
import type { RelatorioVendas, LinhaCurvaAbc } from '@shared/types'
import { formatBRL } from '../lib/money'
import Aviso, { useAviso } from '../components/Aviso'

// RF-22..25: vendas por período/forma/operador/produto/grupo, curva ABC, export CSV.
type Aba = 'resumo' | 'forma' | 'operador' | 'produto' | 'grupo' | 'abc'

const ABAS: { id: Aba; label: string }[] = [
  { id: 'resumo', label: 'Resumo' },
  { id: 'forma', label: 'Por forma de pagamento' },
  { id: 'operador', label: 'Por operador' },
  { id: 'produto', label: 'Por produto' },
  { id: 'grupo', label: 'Por grupo' },
  { id: 'abc', label: 'Curva ABC' },
]

export default function RelatoriosScreen() {
  const hoje = new Date().toISOString().slice(0, 10)
  const [de, setDe] = useState(hoje)
  const [ate, setAte] = useState(hoje)
  const [aba, setAba] = useState<Aba>('resumo')
  const [rel, setRel] = useState<RelatorioVendas | null>(null)
  const [abc, setAbc] = useState<LinhaCurvaAbc[]>([])
  const [carregando, setCarregando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [r, a] = await Promise.all([
      window.api.relatorios.vendas({ de, ate }),
      window.api.relatorios.curvaAbc(de, ate),
    ])
    setRel(r)
    setAbc(a)
    setCarregando(false)
  }, [de, ate])

  useEffect(() => { void carregar() }, [carregar])

  const { aviso, mostrar: avisar, limpar: limparAviso } = useAviso()

  async function exportar() {
    const dados = linhasParaExport(aba, rel, abc)
    if (!dados.length) return
    const r = await window.api.relatorios.exportarCsv(dados, `relatorio-${aba}-${de}_${ate}.csv`)
    if (r.caminho) avisar(`Exportado para ${r.caminho}`, 'sucesso')
  }

  return (
    <div className="p-4">
      <div className="mb-4"><Aviso aviso={aviso} onDispensar={limparAviso} /></div>

      <div className="mb-4 flex items-end gap-3">
        <h1 className="font-display text-2xl text-primary">Relatórios</h1>
        <div className="ml-4">
          <label className="mb-1 block text-xs uppercase text-text-muted">De</label>
          <input type="date" className="input" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase text-text-muted">Até</label>
          <input type="date" className="input" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <button className="btn-ghost" onClick={carregar} disabled={carregando}>
          {carregando ? 'Carregando…' : 'Atualizar'}
        </button>
        <button className="btn-ghost ml-auto" onClick={exportar}>Exportar CSV</button>
      </div>

      <div className="flex gap-4">
        <ul className="w-56 space-y-1">
          {ABAS.map((a) => (
            <li key={a.id}>
              <button
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                  aba === a.id ? 'bg-primary text-text-inverse' : 'hover:bg-surface-alt'
                }`}
                onClick={() => setAba(a.id)}
              >
                {a.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="card flex-1 overflow-auto">
          {!rel ? (
            <p className="text-text-muted">Sem dados.</p>
          ) : aba === 'resumo' ? (
            <Resumo rel={rel} />
          ) : aba === 'abc' ? (
            <CurvaAbc linhas={abc} />
          ) : (
            <Tabela aba={aba} rel={rel} />
          )}
        </div>
      </div>
    </div>
  )
}

function Resumo({ rel }: { rel: RelatorioVendas }) {
  const r = rel.resumo
  const cards = [
    { label: 'Vendas', valor: String(r.quantidadeVendas) },
    { label: 'Faturamento', valor: formatBRL(r.total) },
    { label: 'Descontos', valor: formatBRL(r.desconto) },
    { label: 'Ticket médio', valor: formatBRL(r.ticketMedio) },
  ]
  return (
    <div className="grid grid-cols-4 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-md bg-surface-alt p-4">
          <p className="text-xs uppercase text-text-muted">{c.label}</p>
          <p className="font-mono text-2xl text-primary">{c.valor}</p>
        </div>
      ))}
    </div>
  )
}

function Tabela({ aba, rel }: { aba: Aba; rel: RelatorioVendas }) {
  if (aba === 'forma')
    return (
      <T cols={['Forma', 'Qtd', 'Valor']} rows={rel.porForma.map((f) => [f.forma, f.quantidade, formatBRL(f.valor)])} />
    )
  if (aba === 'operador')
    return (
      <T cols={['Operador', 'Vendas', 'Total']} rows={rel.porOperador.map((o) => [o.nome, o.quantidade, formatBRL(o.total)])} />
    )
  if (aba === 'produto')
    return (
      <T cols={['Produto', 'Qtd', 'Total']} rows={rel.porProduto.map((p) => [p.descricao, p.quantidade, formatBRL(p.total)])} />
    )
  return <T cols={['Grupo', 'Total']} rows={rel.porGrupo.map((g) => [g.nome, formatBRL(g.total)])} />
}

function CurvaAbc({ linhas }: { linhas: LinhaCurvaAbc[] }) {
  return (
    <T
      cols={['Classe', 'Produto', 'Qtd', 'Faturamento', '% acum.']}
      rows={linhas.map((l) => [l.classe, l.descricao, l.quantidade, formatBRL(l.faturamento), `${l.percentualAcumulado.toFixed(1)}%`])}
    />
  )
}

function T({ cols, rows }: { cols: string[]; rows: (string | number)[][] }) {
  if (!rows.length) return <p className="text-text-muted">Nenhum registro no período.</p>
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-text-muted">
        <tr className="border-b border-border">
          {cols.map((c) => <th key={c} className="py-2">{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-border/40">
            {r.map((cell, j) => (
              <td key={j} className={`py-2 ${j === 0 ? '' : 'font-mono'}`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Achata a aba selecionada em linhas planas para o CSV.
function linhasParaExport(
  aba: Aba,
  rel: RelatorioVendas | null,
  abc: LinhaCurvaAbc[],
): unknown[] {
  if (!rel) return []
  switch (aba) {
    case 'resumo': return [rel.resumo]
    case 'forma': return rel.porForma
    case 'operador': return rel.porOperador
    case 'produto': return rel.porProduto
    case 'grupo': return rel.porGrupo
    case 'abc': return abc
  }
}
