import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Caixa, Produto, RelatorioVendas } from '@shared/types'
import { formatBRL } from '../lib/money'
import {
  montarAlertas,
  estimarDiasRestantes,
  ticketMedio,
  horasAberto,
  type Alerta,
  type LinhaEstoque,
} from '../lib/painel'

/**
 * Painel (RF-18) — a tela que responde "como está a loja agora".
 *
 * Operacional, não analítico: o que exige ação vem primeiro, e cada alerta leva
 * à tela onde se resolve. Gráfico e série temporal são assunto de relatório.
 */

const INTERVALO_MS = 60_000

interface Dados {
  alertas: Alerta[]
  estoque: LinhaEstoque[]
  caixa: Caixa | null
  vendasTurno: number
  totalTurno: number
  hoje: RelatorioVendas | null
}

const hojeISO = () => new Date().toISOString().slice(0, 10)

function diasAtras(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export default function PainelScreen() {
  const navigate = useNavigate()
  const [dados, setDados] = useState<Dados | null>(null)
  const [carregando, setCarregando] = useState(true)

  const carregar = useCallback(async () => {
    const api = window.api
    const hoje = hojeISO()

    // Cinco chamadas em paralelo, não quinze: o painel reaproveita canais que
    // já existem, e a única agregação nova é a média diária.
    const [contingencia, rejeitados, estoqueMinimo, todosProdutos, caixa] = await Promise.all([
      api.fiscal.filaContingencia(),
      api.fiscal.listarDocumentos('rejeitada'),
      api.estoque.alertasMinimo(),
      api.produtos.listar(true),
      api.caixa.atual(),
    ])

    const [emEspera, relHoje, medias] = await Promise.all([
      api.vendas.recuperarEspera(),
      api.relatorios.vendas({ de: hoje, ate: hoje }),
      api.relatorios.mediaDiariaProdutos(diasAtras(30), hoje),
    ])

    const inativosPorFiscal = todosProdutos.filter(
      (p: Produto) => !p.ativo && (!p.ncm || !p.cfop || !p.origem || !p.csosn),
    )

    // Vendas do turno: com caixa aberto, o recorte é de hoje — o fechamento da
    // fatia 04 é quem faz a apuração precisa do turno.
    setDados({
      alertas: montarAlertas({
        contingencia,
        rejeitados,
        estoqueMinimo,
        inativosPorFiscal,
        caixa,
        emEspera,
      }),
      estoque: estimarDiasRestantes(estoqueMinimo, medias),
      caixa,
      vendasTurno: relHoje.resumo.quantidadeVendas,
      totalTurno: relHoje.resumo.total,
      hoje: relHoje,
    })
    setCarregando(false)
  }, [])

  useEffect(() => {
    void carregar()

    // Recarrega ao voltar o foco e a cada minuto — mas só com a janela visível:
    // é PDV local, não painel de parede.
    const aoFocar = () => void carregar()
    window.addEventListener('focus', aoFocar)

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void carregar()
    }, INTERVALO_MS)

    return () => {
      window.removeEventListener('focus', aoFocar)
      clearInterval(timer)
    }
  }, [carregar])

  if (carregando || !dados) {
    return <div className="p-4 text-text-muted">Carregando painel…</div>
  }

  return (
    <div className="space-y-4 p-4">
      <h1 className="font-display text-2xl text-primary">Painel</h1>

      {/* Ações pendentes — some quando não há nada, em vez de mostrar "0" */}
      {dados.alertas.length > 0 && (
        <section className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase text-text-muted">
            Precisa de ação ({dados.alertas.length})
          </h2>
          <ul className="space-y-2">
            {dados.alertas.map((a) => (
              <li key={a.id}>
                <button
                  className={`flex w-full items-center gap-3 rounded border-l-4 px-3 py-2 text-left transition-colors hover:bg-surface-alt ${
                    a.gravidade === 'alta'
                      ? 'border-l-danger bg-danger/5'
                      : a.gravidade === 'media'
                        ? 'border-l-warning bg-warning/5'
                        : 'border-l-border-strong'
                  }`}
                  onClick={() => navigate(a.rota)}
                >
                  <span className="font-mono text-lg text-text">{a.quantidade}</span>
                  <span className="flex-1">
                    <span className="block text-sm text-text">{a.titulo}</span>
                    <span className="block text-xs text-text-muted">{a.detalhe}</span>
                  </span>
                  <span className="text-xs text-text-muted">resolver →</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Turno — só quando há caixa aberto */}
        {dados.caixa && (
          <section className="card">
            <h2 className="mb-3 text-sm font-semibold uppercase text-text-muted">Turno atual</h2>
            <dl className="space-y-1 text-sm">
              <Linha rotulo="Aberto há" valor={`${Math.floor(horasAberto(dados.caixa))} h`} />
              <Linha rotulo="Abertura" valor={formatBRL(dados.caixa.valorAbertura)} />
              <Linha rotulo="Vendas" valor={String(dados.vendasTurno)} />
              <Linha rotulo="Total" valor={formatBRL(dados.totalTurno)} />
              <Linha
                rotulo="Ticket médio"
                valor={formatBRL(ticketMedio(dados.totalTurno, dados.vendasTurno))}
              />
            </dl>
            <button className="btn-ghost mt-3 w-full" onClick={() => navigate('/fechamento')}>
              Fechar caixa
            </button>
          </section>
        )}

        {/* Dia */}
        <section className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase text-text-muted">Hoje</h2>
          <dl className="space-y-1 text-sm">
            <Linha rotulo="Vendas" valor={String(dados.hoje?.resumo.quantidadeVendas ?? 0)} />
            <Linha rotulo="Faturamento" valor={formatBRL(dados.hoje?.resumo.total ?? 0)} />
            <Linha rotulo="Ticket médio" valor={formatBRL(dados.hoje?.resumo.ticketMedio ?? 0)} />
            <Linha rotulo="Desconto" valor={formatBRL(dados.hoje?.resumo.desconto ?? 0)} />
          </dl>
          {dados.hoje && dados.hoje.porForma.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-border pt-2 text-xs text-text-muted">
              {dados.hoje.porForma.map((f) => (
                <li key={f.forma} className="flex justify-between">
                  <span className="capitalize">{f.forma}</span>
                  <span className="font-mono">{formatBRL(f.valor)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Estoque mínimo com utilidade: quantos dias ainda cobre */}
      {dados.estoque.length > 0 && (
        <section className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase text-text-muted">
            Abaixo do estoque mínimo ({dados.estoque.length})
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-text-muted">
                <th className="pb-1">Produto</th>
                <th className="pb-1 text-right">Saldo</th>
                <th className="pb-1 text-right">Mínimo</th>
                <th className="pb-1 text-right">Dura</th>
              </tr>
            </thead>
            <tbody>
              {dados.estoque.map(({ produto, diasRestantes }) => (
                <tr key={produto.id} className="border-t border-border">
                  <td className="py-1">{produto.descricao}</td>
                  <td className="py-1 text-right font-mono text-warning">{produto.estoqueAtual}</td>
                  <td className="py-1 text-right font-mono text-text-muted">
                    {produto.estoqueMinimo}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {diasRestantes === null ? (
                      <span className="text-text-muted">sem histórico</span>
                    ) : (
                      <span className={diasRestantes <= 2 ? 'text-danger' : 'text-text'}>
                        ~{diasRestantes} {diasRestantes === 1 ? 'dia' : 'dias'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn-ghost mt-3 w-full" onClick={() => navigate('/estoque')}>
            Abrir estoque
          </button>
        </section>
      )}
    </div>
  )
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-text-muted">{rotulo}</dt>
      <dd className="font-mono">{valor}</dd>
    </div>
  )
}
