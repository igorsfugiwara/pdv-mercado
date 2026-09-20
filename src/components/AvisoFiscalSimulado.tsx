import { useEffect, useState } from 'react'
import type { EstadoFiscal } from '@shared/types'
import {
  classificarContingencia,
  piorClasse,
  CHAVE_PRAZO_CONTINGENCIA,
  PRAZO_CONTINGENCIA_HORAS,
  type ClasseContingencia,
} from '@shared/contingencia'

/**
 * Lê o estado do módulo fiscal uma vez por montagem.
 *
 * O provider não muda em tempo de execução (a troca só vale no próximo boot),
 * então não há polling: seria consulta repetida para um valor constante.
 */
export function useEstadoFiscal(): EstadoFiscal | null {
  const [estado, setEstado] = useState<EstadoFiscal | null>(null)

  useEffect(() => {
    let vivo = true
    window.api.fiscal
      .estado()
      .then((e) => { if (vivo) setEstado(e) })
      .catch(() => { if (vivo) setEstado(null) })
    return () => { vivo = false }
  }, [])

  return estado
}

/**
 * Faixa persistente para a tela fiscal. O operador precisa saber, sem
 * ambiguidade, que os documentos não valem fiscalmente — por isso o texto é
 * direto e a faixa não fecha.
 */
export function FaixaSimulado({ estado }: { estado: EstadoFiscal | null }) {
  if (!estado?.simulado) return null

  return (
    <div
      role="status"
      className="mb-4 rounded-md border border-warning/40 border-l-4 border-l-warning bg-warning/10 px-4 py-3"
    >
      <p className="font-display text-sm text-warning">
        Modo simulado — documentos sem valor fiscal.
      </p>
      <p className="mt-1 text-xs text-text-muted">
        Nada é transmitido à SEFAZ. As chaves de acesso são geradas no formato correto
        apenas para o sistema funcionar ponta a ponta.
        {estado.modoFalha !== 'nenhuma' && (
          <> Falha injetada: <strong>{estado.modoFalha}</strong>.</>
        )}
      </p>
      {estado.motivoFallback && (
        <p className="mt-1 text-xs text-danger">
          O módulo fiscal real foi pedido e não subiu: {estado.motivoFallback}
        </p>
      )}
    </div>
  )
}

/**
 * Indicador discreto e sempre visível para o rodapé do caixa. Pequeno de
 * propósito: não pode disputar atenção com o total da venda, mas não pode
 * sumir.
 */
export function SeloSimulado({ estado }: { estado: EstadoFiscal | null }) {
  if (!estado?.simulado) return null

  return (
    <span
      title="Os documentos emitidos não têm valor fiscal."
      className="inline-flex shrink-0 items-center gap-1.5 rounded border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
    >
      <span aria-hidden="true">●</span>
      Modo simulado — sem valor fiscal
    </span>
  )
}

/**
 * Faixa de contingência vencida ou urgente, no caixa.
 *
 * Reaproveita o padrão de faixa persistente desta tela em vez de inventar
 * outro. Aparece só quando o tempo já conta contra — documento de 10 minutos
 * não interrompe o operador, documento de 25 h não pode ser dispensado.
 */
export function useContingenciaUrgente() {
  const [situacao, setSituacao] = useState<{
    classe: ClasseContingencia
    mensagem: string
    quantidade: number
  } | null>(null)

  useEffect(() => {
    let vivo = true

    async function conferir() {
      try {
        const [fila, prazoBruto] = await Promise.all([
          window.api.fiscal.filaContingencia(),
          window.api.config.obter(CHAVE_PRAZO_CONTINGENCIA),
        ])
        if (!vivo) return
        if (fila.length === 0) {
          setSituacao(null)
          return
        }
        const prazo = Number(prazoBruto)
        const horas = Number.isFinite(prazo) && prazo > 0 ? prazo : PRAZO_CONTINGENCIA_HORAS
        const situacoes = fila.map((d) => classificarContingencia(d.emitidaEm, Date.now(), horas))
        const pior = piorClasse(situacoes.map((x) => x.classe))
        if (pior !== 'urgente' && pior !== 'vencido') {
          setSituacao(null)
          return
        }
        const maisAntiga = situacoes.reduce((a, b) => (b.horas > a.horas ? b : a))
        setSituacao({ classe: pior, mensagem: maisAntiga.mensagem, quantidade: fila.length })
      } catch {
        if (vivo) setSituacao(null)
      }
    }

    void conferir()
    const t = setInterval(conferir, 5 * 60_000)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [])

  return situacao
}

export function FaixaContingencia({
  situacao,
}: {
  situacao: { classe: ClasseContingencia; mensagem: string; quantidade: number } | null
}) {
  if (!situacao) return null
  const vencido = situacao.classe === 'vencido'

  return (
    <div
      role="alert"
      className={`rounded-md border-l-4 px-3 py-2 text-sm ${
        vencido
          ? 'border-l-danger bg-danger/15 text-text'
          : 'border-l-warning bg-warning/10 text-text'
      }`}
    >
      <strong className={vencido ? 'text-danger' : 'text-warning'}>
        {vencido ? 'Contingência VENCIDA' : 'Contingência perto do prazo'}
      </strong>{' '}
      — {situacao.quantidade} documento(s). {situacao.mensagem} Resolva no monitor fiscal.
    </div>
  )
}
