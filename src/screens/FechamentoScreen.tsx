import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  RelatorioFechamento,
  ResumoPreFechamento,
  FormaPagamento,
} from '@shared/types'
import { useCaixaStore } from '../store/caixaStore'
import { useAuthStore } from '../store/authStore'
import { formatBRL, parseBRL } from '../lib/money'
import ContagemGaveta from '../components/ContagemGaveta'

const ROTULO_FORMA: Record<FormaPagamento, string> = {
  dinheiro: 'Dinheiro',
  debito: 'Cartão de débito',
  credito: 'Cartão de crédito',
  pix: 'PIX',
  voucher: 'Voucher',
}

type Etapa = 'resumo' | 'contagem' | 'justificativa' | 'relatorio'

/**
 * RF-11/RF-13: fechamento de caixa com conferência cega.
 *
 * A etapa `resumo` mostra de propósito NENHUM valor em dinheiro — se o esperado
 * aparecer antes, o operador digita o que está na tela e a conferência não vale
 * nada. O esperado só chega ao renderer dentro do relatório, depois que o
 * contado foi enviado.
 */
export default function FechamentoScreen() {
  const navigate = useNavigate()
  const { caixa, carregar, fechar } = useCaixaStore()
  const usuario = useAuthStore((s) => s.usuario)!

  const [etapa, setEtapa] = useState<Etapa>('resumo')
  const [resumo, setResumo] = useState<ResumoPreFechamento | null>(null)
  const [contado, setContado] = useState(0)
  const [modoContagem, setModoContagem] = useState<'total' | 'denominacao'>('total')
  const [totalTexto, setTotalTexto] = useState('0,00')
  const [pendencia, setPendencia] = useState<{ diferenca: number; limite: number } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [pin, setPin] = useState('')
  const [relatorio, setRelatorio] = useState<RelatorioFechamento | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    void carregar()
  }, [carregar])

  const carregarResumo = useCallback(async () => {
    if (!caixa) return
    setResumo(await window.api.caixa.resumoPreFechamento(caixa.id, usuario.id))
  }, [caixa, usuario.id])

  useEffect(() => {
    void carregarResumo()
  }, [carregarResumo])

  async function enviarContagem(motivoJust?: string, autorizadoPorId?: number) {
    setOcupado(true)
    setErro(null)
    try {
      const r = await fechar(usuario.id, contado, motivoJust ?? null, autorizadoPorId ?? null)
      if (r.status === 'bloqueado') {
        setErro(r.bloqueios.join(' '))
        setEtapa('resumo')
        await carregarResumo()
      } else if (r.status === 'requer_justificativa') {
        setPendencia({ diferenca: r.diferenca, limite: r.limite })
        setEtapa('justificativa')
      } else {
        setRelatorio(r.relatorio)
        setEtapa('relatorio')
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(false)
    }
  }

  async function confirmarJustificativa() {
    if (!motivo.trim()) return setErro('Informe o motivo da diferença.')
    if (!pin) return setErro('PIN do supervisor é obrigatório.')
    setOcupado(true)
    const auth = await window.api.auth.autorizarSupervisor(pin)
    setPin('')
    setOcupado(false)
    if (!auth.ok || !auth.usuario) return setErro('Autorização de supervisor negada.')
    await enviarContagem(motivo.trim(), auth.usuario.id)
  }

  async function imprimir() {
    if (!relatorio) return
    const r = await window.api.caixa.imprimirFechamento(relatorio.caixaId)
    setErro(r.ok ? null : r.detalhe)
  }

  if (!caixa && etapa !== 'relatorio') {
    return (
      <div className="p-6">
        <div className="card max-w-lg space-y-3">
          <h2 className="font-display text-xl text-primary">Nenhum caixa aberto</h2>
          <p className="text-sm text-text-muted">Não há turno em andamento para fechar.</p>
          <button className="btn-primary" onClick={() => navigate('/caixa')}>
            Ir para o caixa
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 font-display text-2xl text-primary">Fechamento de caixa</h1>

      {erro && (
        <div className="mb-4 rounded border border-danger bg-danger/10 px-3 py-2 text-sm text-danger">
          {erro}
        </div>
      )}

      {etapa === 'resumo' && resumo && (
        <div className="card max-w-2xl space-y-4">
          <h2 className="text-sm font-semibold uppercase text-text-muted">Turno</h2>
          {/* Sem valores em dinheiro: a conferência é cega (RF-11). */}
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-text-muted">Caixa</dt>
            <dd className="text-text">#{resumo.caixaId}</dd>
            <dt className="text-text-muted">Aberto em</dt>
            <dd className="text-text">{new Date(resumo.abertoEm).toLocaleString('pt-BR')}</dd>
            <dt className="text-text-muted">Operador da abertura</dt>
            <dd className="text-text">{resumo.operadorAbertura}</dd>
            <dt className="text-text-muted">Vendas no turno</dt>
            <dd className="text-text">{resumo.quantidadeVendas}</dd>
          </dl>

          <p className="rounded bg-surface-alt px-3 py-2 text-xs text-text-muted">
            Conte a gaveta antes de continuar. O valor esperado pelo sistema só aparece depois
            que você informar o contado — é o que torna a conferência confiável.
          </p>

          {resumo.bloqueios.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-danger">Resolva antes de fechar:</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-text">
                {resumo.bloqueios.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <button className="btn-ghost" onClick={() => navigate('/caixa')}>
                Voltar ao caixa
              </button>
            </div>
          ) : (
            <button className="btn-primary" autoFocus onClick={() => setEtapa('contagem')}>
              Iniciar conferência
            </button>
          )}
        </div>
      )}

      {etapa === 'contagem' && (
        <div className="card max-w-2xl space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-sm font-semibold uppercase text-text-muted">
              Contagem da gaveta
            </h2>
            <button
              className={modoContagem === 'total' ? 'btn-primary text-xs' : 'btn-ghost text-xs'}
              onClick={() => setModoContagem('total')}
            >
              Total
            </button>
            <button
              className={
                modoContagem === 'denominacao' ? 'btn-primary text-xs' : 'btn-ghost text-xs'
              }
              onClick={() => setModoContagem('denominacao')}
            >
              Por cédula
            </button>
          </div>

          {modoContagem === 'total' ? (
            <div>
              <label className="mb-1 block text-sm text-text-muted">Total contado (R$)</label>
              <input
                className="input font-mono text-lg"
                autoFocus
                value={totalTexto}
                onChange={(e) => {
                  setTotalTexto(e.target.value)
                  setContado(parseBRL(e.target.value))
                }}
                onKeyDown={(e) => e.key === 'Enter' && void enviarContagem()}
              />
            </div>
          ) : (
            <ContagemGaveta onTotal={setContado} />
          )}

          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={ocupado || contado <= 0}
              onClick={() => void enviarContagem()}
            >
              Confirmar contagem
            </button>
            <button className="btn-ghost" onClick={() => setEtapa('resumo')}>
              Voltar
            </button>
          </div>
        </div>
      )}

      {etapa === 'justificativa' && pendencia && (
        <div className="card max-w-2xl space-y-4">
          <h2 className="text-sm font-semibold uppercase text-text-muted">
            Diferença acima do limite
          </h2>
          <div className="rounded bg-surface-alt px-3 py-3">
            <p className="text-sm text-text-muted">
              {pendencia.diferenca > 0 ? 'Sobra' : 'Falta'} de
            </p>
            <p
              className={`font-mono text-3xl ${pendencia.diferenca > 0 ? 'text-success' : 'text-danger'}`}
            >
              {formatBRL(Math.abs(pendencia.diferenca))}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Limite sem justificativa: {formatBRL(pendencia.limite)}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm text-text-muted">Motivo da diferença</label>
            <textarea
              className="input min-h-20"
              autoFocus
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-text-muted">PIN do supervisor</label>
            <input
              className="input font-mono"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void confirmarJustificativa()}
            />
          </div>

          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={ocupado}
              onClick={() => void confirmarJustificativa()}
            >
              Autorizar e fechar
            </button>
            <button className="btn-ghost" onClick={() => setEtapa('contagem')}>
              Recontar
            </button>
          </div>
        </div>
      )}

      {etapa === 'relatorio' && relatorio && (
        <div className="max-w-3xl space-y-4">
          <Conferencia relatorio={relatorio} />
          <Movimentacoes relatorio={relatorio} />
          <Totais relatorio={relatorio} />
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => void imprimir()}>
              Imprimir cupom
            </button>
            <button className="btn-ghost" onClick={() => navigate('/caixa')}>
              Concluir
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Conferencia({ relatorio }: { relatorio: RelatorioFechamento }) {
  const { composicao, esperado, contado, diferenca, motivo } = relatorio.conferencia
  return (
    <section className="card space-y-3">
      <h2 className="text-sm font-semibold uppercase text-text-muted">Conferência de gaveta</h2>
      {/* A composição aparece aberta: "esperado R$ 843,20" sem decomposição não
          ajuda ninguém a achar de onde veio a diferença. */}
      <table className="w-full text-sm">
        <tbody>
          {composicao.map((l) => (
            <tr key={l.rotulo}>
              <td className="py-1 text-text-muted">{l.rotulo}</td>
              <td className="py-1 text-right font-mono text-text">
                {l.valor < 0 ? '−' : ''}
                {formatBRL(Math.abs(l.valor))}
              </td>
            </tr>
          ))}
          <tr className="border-t border-border">
            <td className="py-1 font-semibold text-text">Esperado</td>
            <td className="py-1 text-right font-mono font-semibold text-text">
              {formatBRL(esperado)}
            </td>
          </tr>
          <tr>
            <td className="py-1 font-semibold text-text">Contado</td>
            <td className="py-1 text-right font-mono font-semibold text-text">
              {formatBRL(contado)}
            </td>
          </tr>
        </tbody>
      </table>
      <div
        className={`rounded px-3 py-2 ${
          diferenca === 0
            ? 'bg-surface-alt'
            : diferenca > 0
              ? 'bg-success/10 text-success'
              : 'bg-danger/10 text-danger'
        }`}
      >
        <span className="text-sm">
          {diferenca === 0 ? 'Sem diferença' : diferenca > 0 ? 'Sobra' : 'Falta'}
        </span>
        <span className="ml-2 font-mono text-xl">{formatBRL(Math.abs(diferenca))}</span>
      </div>
      {motivo && <p className="text-sm text-text-muted">Justificativa: {motivo}</p>}
    </section>
  )
}

function Movimentacoes({ relatorio }: { relatorio: RelatorioFechamento }) {
  const movs = relatorio.movimentos.filter(
    (m) => m.tipo === 'sangria' || m.tipo === 'suprimento',
  )
  if (movs.length === 0) return null
  return (
    <section className="card space-y-2">
      <h2 className="text-sm font-semibold uppercase text-text-muted">Movimentações</h2>
      <table className="w-full text-sm">
        <tbody>
          {movs.map((m, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              <td className="py-1 capitalize text-text">{m.tipo}</td>
              <td className="py-1 text-text-muted">{m.motivo ?? '—'}</td>
              <td className="py-1 text-xs text-text-muted">
                {m.autorizadoPor ? `aut. ${m.autorizadoPor}` : ''}
              </td>
              <td className="py-1 text-right font-mono text-text">
                {m.tipo === 'sangria' ? '−' : '+'}
                {formatBRL(m.valor)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Totais({ relatorio }: { relatorio: RelatorioFechamento }) {
  const { vendas, porForma, documentos } = relatorio
  const ticket = vendas.quantidade > 0 ? Math.round(vendas.total / vendas.quantidade) : 0
  return (
    <section className="card space-y-3">
      <h2 className="text-sm font-semibold uppercase text-text-muted">Turno</h2>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded bg-surface-alt px-2 py-3">
          <p className="text-xs text-text-muted">Vendas</p>
          <p className="font-mono text-xl text-text">{vendas.quantidade}</p>
        </div>
        <div className="rounded bg-surface-alt px-2 py-3">
          <p className="text-xs text-text-muted">Faturamento</p>
          <p className="font-mono text-xl text-primary">{formatBRL(vendas.total)}</p>
        </div>
        <div className="rounded bg-surface-alt px-2 py-3">
          <p className="text-xs text-text-muted">Ticket médio</p>
          <p className="font-mono text-xl text-text">{formatBRL(ticket)}</p>
        </div>
      </div>

      <table className="w-full text-sm">
        <tbody>
          {porForma.map((f) => (
            <tr key={f.forma}>
              <td className="py-1 text-text-muted">
                {ROTULO_FORMA[f.forma]} ({f.quantidade})
              </td>
              <td className="py-1 text-right font-mono text-text">{formatBRL(f.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {documentos.length > 0 && (
        <div className="border-t border-border pt-2 text-sm">
          <p className="mb-1 text-text-muted">Documentos fiscais</p>
          <ul className="flex flex-wrap gap-x-4 text-text">
            {documentos.map((d) => (
              <li key={d.status}>
                {d.status}: {d.quantidade}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
