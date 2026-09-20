import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Primitiva de diálogo do PDV.
 *
 * Existe para substituir `prompt/alert/confirm`, que num caixa de supermercado
 * são um problema operacional, não estético: o diálogo nativo trava o renderer,
 * e como o leitor de código de barras **é um teclado**, um bip acidental digita
 * dentro dele e o Enter do sufixo confirma com lixo.
 *
 * Resolve num lugar só: portal, foco preso, Esc/Enter, devolução de foco e
 * suspensão dos atalhos globais (ver `dialogoAberto`).
 */

/**
 * Quantos diálogos estão abertos. A `CaixaScreen` consulta isto para suspender
 * os atalhos F2–F12 — sem isso um F10 digitado dentro do diálogo dispara o
 * pagamento por trás dele.
 */
let abertos = 0
export const dialogoAberto = () => abertos > 0

const FOCAVEIS =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface DialogoProps {
  titulo: string
  descricao?: string
  children?: ReactNode
  onConfirmar: () => void
  onCancelar: () => void
  rotuloConfirmar?: string
  rotuloCancelar?: string
  /** Ação destrutiva: botão em vermelho e foco inicial no Cancelar. */
  destrutivo?: boolean
  /** Bloqueia o confirmar enquanto a entrada não é válida. */
  confirmarDesabilitado?: boolean
  erro?: string | null
}

export default function Dialogo({
  titulo,
  descricao,
  children,
  onConfirmar,
  onCancelar,
  rotuloConfirmar = 'Confirmar',
  rotuloCancelar = 'Cancelar',
  destrutivo = false,
  confirmarDesabilitado = false,
  erro = null,
}: DialogoProps) {
  const caixaRef = useRef<HTMLDivElement>(null)
  const tituloId = useId()
  const descricaoId = useId()

  useEffect(() => {
    abertos++
    // Guarda quem tinha o foco para devolver ao fechar — é esse retorno que
    // faz o operador não perder o ritmo entre um diálogo e o próximo bip.
    const anterior = document.activeElement as HTMLElement | null

    const caixa = caixaRef.current
    const alvo = destrutivo
      ? caixa?.querySelector<HTMLElement>('[data-acao="cancelar"]')
      : caixa?.querySelector<HTMLElement>(FOCAVEIS)
    alvo?.focus()
    if (alvo instanceof HTMLInputElement) alvo.select()

    return () => {
      abertos--
      anterior?.focus?.()
    }
  }, [destrutivo])

  function aoTeclar(e: React.KeyboardEvent) {
    // O diálogo consome a tecla: nada sobe para os atalhos globais.
    e.stopPropagation()

    if (e.key === 'Escape') {
      e.preventDefault()
      onCancelar()
      return
    }

    if (e.key === 'Enter' && !(e.target as HTMLElement).matches('textarea')) {
      e.preventDefault()
      if (!confirmarDesabilitado) onConfirmar()
      return
    }

    if (e.key !== 'Tab') return

    // Prende o Tab dentro do diálogo.
    const focaveis = Array.from(caixaRef.current?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? [])
    if (focaveis.length === 0) return
    const primeiro = focaveis[0]
    const ultimo = focaveis[focaveis.length - 1]
    const ativo = document.activeElement

    if (e.shiftKey && ativo === primeiro) {
      e.preventDefault()
      ultimo.focus()
    } else if (!e.shiftKey && ativo === ultimo) {
      e.preventDefault()
      primeiro.focus()
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onKeyDown={aoTeclar}
      // Clique fora cancela; num caixa o mouse é exceção, mas quando usado
      // precisa se comportar.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancelar() }}
    >
      <div
        ref={caixaRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        aria-describedby={descricao ? descricaoId : undefined}
        className="w-full max-w-md rounded-lg border border-border-strong bg-surface p-5 shadow-2xl"
      >
        <h2 id={tituloId} className="font-display text-lg text-primary">
          {titulo}
        </h2>
        {descricao && (
          <p id={descricaoId} className="mt-1 text-sm text-text-muted">
            {descricao}
          </p>
        )}

        <div className="mt-4 space-y-2">{children}</div>

        {erro && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {erro}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button data-acao="cancelar" className="btn-ghost" onClick={onCancelar}>
            {rotuloCancelar} <span className="text-xs text-text-muted">(Esc)</span>
          </button>
          <button
            data-acao="confirmar"
            className={destrutivo ? 'btn-danger' : 'btn-primary'}
            disabled={confirmarDesabilitado}
            onClick={onConfirmar}
          >
            {rotuloConfirmar} <span className="text-xs opacity-70">(Enter)</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
