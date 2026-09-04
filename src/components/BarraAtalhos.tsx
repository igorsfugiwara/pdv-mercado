export interface Atalho {
  tecla: string
  rotulo: string
  /** Falso = existe, mas não cabe agora. Aparece apagado em vez de sumir. */
  ativo?: boolean
}

/**
 * Barra fixa de atalhos (RF-10).
 *
 * O PRD exige que um operador sem treinamento técnico consiga operar só com
 * teclado. Isso não se resolve com manual: as teclas precisam estar na tela.
 * Atalho indisponível fica apagado em vez de sumir — some da tela ensina que a
 * tecla não existe; apagado ensina que ela existe e por que não cabe agora.
 */
export default function BarraAtalhos({ atalhos }: { atalhos: Atalho[] }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2"
      // Informativo: não entra na ordem de tabulação nem é anunciado item a item.
      aria-hidden="true"
    >
      {atalhos.map((a) => {
        const disponivel = a.ativo !== false
        return (
          <span
            key={a.tecla}
            className={`flex items-center gap-1.5 text-xs ${
              disponivel ? 'text-text' : 'text-text-muted opacity-40'
            }`}
          >
            <kbd className="kbd">{a.tecla}</kbd>
            {a.rotulo}
          </span>
        )
      })}
    </div>
  )
}
