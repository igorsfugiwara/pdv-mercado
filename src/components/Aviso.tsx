import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Faixa de aviso não-bloqueante — substitui `alert()` como canal de resultado.
 *
 * A regra vem da operação, não do visual: aviso de sucesso some sozinho, porque
 * "+ Arroz Branco 5kg" não merece tirar a mão do teclado. **Erro não some**, e
 * exige dispensa explícita: um "PIN inválido" que desaparece sozinho é pior do
 * que nenhum aviso.
 */
export type TipoAviso = 'sucesso' | 'info' | 'erro'

export interface AvisoAtual {
  tipo: TipoAviso
  texto: string
}

const SEGUNDOS_ATE_SUMIR = 4000

export function useAviso() {
  const [aviso, setAviso] = useState<AvisoAtual | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const limpar = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setAviso(null)
  }, [])

  const mostrar = useCallback((texto: string, tipo: TipoAviso = 'info') => {
    if (timer.current) clearTimeout(timer.current)
    setAviso({ tipo, texto })
    // Erro fica até o operador dispensar.
    if (tipo !== 'erro') {
      timer.current = setTimeout(() => setAviso(null), SEGUNDOS_ATE_SUMIR)
    }
  }, [])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return { aviso, mostrar, limpar }
}

const ESTILO: Record<TipoAviso, string> = {
  sucesso: 'border-l-success bg-success/10 text-text',
  info: 'border-l-primary bg-surface-alt text-text',
  erro: 'border-l-danger bg-danger/10 text-text',
}

export default function Aviso({
  aviso,
  onDispensar,
}: {
  aviso: AvisoAtual | null
  onDispensar: () => void
}) {
  if (!aviso) return null

  return (
    <div
      role={aviso.tipo === 'erro' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-md border-l-2 px-3 py-2 text-sm ${ESTILO[aviso.tipo]}`}
    >
      <span className="flex-1 whitespace-pre-line">{aviso.texto}</span>
      {aviso.tipo === 'erro' && (
        <button
          className="shrink-0 text-xs text-text-muted underline"
          onClick={onDispensar}
        >
          Dispensar
        </button>
      )}
    </div>
  )
}
