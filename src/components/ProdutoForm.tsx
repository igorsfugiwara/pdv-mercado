import { useState } from 'react'
import type { ProdutoInput } from '@shared/ipc'
import { formatBRL, parseBRL } from '../lib/money'

// RF-14: cadastro com campos fiscais obrigatórios para ativar.
const OBRIGATORIOS_FISCAIS = ['ncm', 'cfop', 'origem', 'csosn'] as const

export default function ProdutoForm({
  inicial,
  onSalvar,
  onFechar,
}: {
  inicial: ProdutoInput
  onSalvar: (input: ProdutoInput) => void
  onFechar: () => void
}) {
  const [p, setP] = useState<ProdutoInput>(inicial)
  const faltamFiscais = OBRIGATORIOS_FISCAIS.filter((c) => !p[c])

  function set<K extends keyof ProdutoInput>(k: K, v: ProdutoInput[K]) {
    setP((prev) => ({ ...prev, [k]: v }))
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-6" onClick={onFechar}>
      <div className="card max-h-full w-[720px] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 font-display text-2xl text-primary">
          {p.id ? 'Editar produto' : 'Novo produto'}
        </h2>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Código interno">
            <input className="input" value={p.codigoInterno} onChange={(e) => set('codigoInterno', e.target.value)} />
          </Campo>
          <Campo label="EAN">
            <input className="input font-mono" value={p.ean ?? ''} onChange={(e) => set('ean', e.target.value || null)} />
          </Campo>
          <Campo label="Descrição" span>
            <input className="input" value={p.descricao} onChange={(e) => set('descricao', e.target.value)} />
          </Campo>
          <Campo label="Unidade">
            <select className="input" value={p.unidade} onChange={(e) => set('unidade', e.target.value as 'UN' | 'KG')}>
              <option value="UN">UN</option>
              <option value="KG">KG</option>
            </select>
          </Campo>
          <Campo label="Pesável">
            <label className="flex items-center gap-2 py-2">
              <input type="checkbox" checked={p.pesavel} onChange={(e) => set('pesavel', e.target.checked)} />
              <span className="text-sm text-text-muted">lê peso da balança</span>
            </label>
          </Campo>
          <Campo label="Preço custo">
            <input className="input font-mono" defaultValue={formatBRL(p.precoCusto)} onBlur={(e) => set('precoCusto', parseBRL(e.target.value))} />
          </Campo>
          <Campo label="Preço venda">
            <input className="input font-mono" defaultValue={formatBRL(p.precoVenda)} onBlur={(e) => set('precoVenda', parseBRL(e.target.value))} />
          </Campo>
          <Campo label="Estoque atual">
            <input className="input font-mono" type="number" value={p.estoqueAtual} onChange={(e) => set('estoqueAtual', parseFloat(e.target.value) || 0)} />
          </Campo>
          <Campo label="Estoque mínimo">
            <input className="input font-mono" type="number" value={p.estoqueMinimo} onChange={(e) => set('estoqueMinimo', parseFloat(e.target.value) || 0)} />
          </Campo>
        </div>

        <h3 className="mb-2 mt-5 text-sm font-semibold uppercase text-text-muted">Campos fiscais (Simples Nacional)</h3>
        <div className="grid grid-cols-4 gap-3">
          <Campo label="NCM"><input className="input font-mono" value={p.ncm ?? ''} onChange={(e) => set('ncm', e.target.value || null)} /></Campo>
          <Campo label="CEST"><input className="input font-mono" value={p.cest ?? ''} onChange={(e) => set('cest', e.target.value || null)} /></Campo>
          <Campo label="CFOP"><input className="input font-mono" value={p.cfop ?? ''} onChange={(e) => set('cfop', e.target.value || null)} /></Campo>
          <Campo label="Origem"><input className="input font-mono" value={p.origem ?? ''} onChange={(e) => set('origem', e.target.value || null)} /></Campo>
          <Campo label="CSOSN"><input className="input font-mono" value={p.csosn ?? ''} onChange={(e) => set('csosn', e.target.value || null)} /></Campo>
          <Campo label="CST PIS"><input className="input font-mono" value={p.cstPis ?? ''} onChange={(e) => set('cstPis', e.target.value || null)} /></Campo>
          <Campo label="CST COFINS"><input className="input font-mono" value={p.cstCofins ?? ''} onChange={(e) => set('cstCofins', e.target.value || null)} /></Campo>
          <Campo label="Alíq PIS (bp)"><input className="input font-mono" type="number" value={p.aliqPis ?? ''} onChange={(e) => set('aliqPis', e.target.value ? +e.target.value : null)} /></Campo>
        </div>

        <label className="mt-4 flex items-center gap-2">
          <input
            type="checkbox"
            checked={p.ativo}
            disabled={faltamFiscais.length > 0}
            onChange={(e) => set('ativo', e.target.checked)}
          />
          <span className="text-sm">
            Produto ativo
            {faltamFiscais.length > 0 && (
              <span className="ml-2 text-danger">
                (complete os campos fiscais: {faltamFiscais.join(', ')})
              </span>
            )}
          </span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
          <button
            className="btn-primary"
            disabled={!p.codigoInterno || !p.descricao}
            onClick={() => onSalvar(p)}
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

function Campo({ label, span, children }: { label: string; span?: boolean; children: React.ReactNode }) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <label className="mb-1 block text-xs uppercase text-text-muted">{label}</label>
      {children}
    </div>
  )
}
