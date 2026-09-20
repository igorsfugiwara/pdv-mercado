/**
 * Integridade do relógio (RF-26/27).
 *
 * Todo registro do sistema — emissão fiscal, caixa, auditoria — usa a hora da
 * máquina, e nada conferia se ela está certa. Num PDV isso não é hipótese: a
 * bateria da placa-mãe acabando é o defeito mais comum em caixa antigo, e a
 * SEFAZ recusa NFC-e com data-hora fora da janela de tolerância.
 *
 * Lógica pura, aqui, porque os dois alvos precisam do mesmo veredito.
 */

export type FonteHora = 'sefaz' | 'http' | 'monotonica'

export interface TolerânciasRelogio {
  /** Abaixo disto é ruído de rede e de arredondamento — não alerta. */
  toleranciaSegundos: number
  /** Acima disto a abertura de caixa pede confirmação consciente. */
  bloqueioMinutos: number
}

export const TOLERANCIAS_PADRAO: TolerânciasRelogio = {
  toleranciaSegundos: 120,
  bloqueioMinutos: 60,
}

export const CHAVES_RELOGIO = {
  ultimoVisto: 'relogio.ultimoVisto',
  toleranciaSegundos: 'relogio.tolerancia.segundos',
  bloqueioMinutos: 'relogio.bloqueio.minutos',
} as const

export type GravidadeRelogio = 'ok' | 'alerta' | 'bloqueio'

export interface VereditoRelogio {
  gravidade: GravidadeRelogio
  /** Desvio em segundos. Negativo = relógio atrasado em relação à referência. */
  desvioSegundos: number
  fonte: FonteHora
  mensagem: string
}

const OK: Omit<VereditoRelogio, 'fonte'> = {
  gravidade: 'ok',
  desvioSegundos: 0,
  mensagem: 'Relógio consistente.',
}

/**
 * Compara o relógio local com uma referência confiável (SEFAZ ou HTTP).
 *
 * Aqui o desvio tem sinal e direção conhecidas: é a medida mais útil, porque é
 * exatamente contra esse relógio que a nota será validada.
 */
export function compararComReferencia(
  agoraLocal: number,
  referencia: number,
  fonte: Exclude<FonteHora, 'monotonica'>,
  tol: TolerânciasRelogio = TOLERANCIAS_PADRAO,
): VereditoRelogio {
  const desvioSegundos = Math.round((agoraLocal - referencia) / 1000)
  const absoluto = Math.abs(desvioSegundos)

  if (absoluto <= tol.toleranciaSegundos) return { ...OK, fonte }

  const sentido = desvioSegundos > 0 ? 'adiantado' : 'atrasado'
  const gravidade: GravidadeRelogio =
    absoluto >= tol.bloqueioMinutos * 60 ? 'bloqueio' : 'alerta'

  return {
    gravidade,
    desvioSegundos,
    fonte,
    mensagem: `O relógio desta máquina está ${sentido} ${descreverDuracao(absoluto)} em relação ${
      fonte === 'sefaz' ? 'à SEFAZ' : 'ao servidor de referência'
    }. Notas emitidas assim podem ser recusadas.`,
  }
}

/**
 * Detecção monotônica — a que funciona **sem rede**, que é a condição real da
 * loja.
 *
 * Se o relógio atual é menor que o maior instante já observado, ele andou para
 * trás: ou a bateria morreu, ou alguém mexeu. Nenhum dos dois é normal.
 *
 * Relógio adiantado não é detectável por esta via: para frente é
 * indistinguível de tempo simplesmente passando.
 */
export function compararMonotonico(
  agoraLocal: number,
  ultimoVisto: number | null,
  tol: TolerânciasRelogio = TOLERANCIAS_PADRAO,
): VereditoRelogio {
  // Primeiro boot: não há com o que comparar, e alertar aqui seria alarme falso.
  if (ultimoVisto === null || !Number.isFinite(ultimoVisto)) {
    return { ...OK, fonte: 'monotonica' }
  }

  const desvioSegundos = Math.round((agoraLocal - ultimoVisto) / 1000)
  if (desvioSegundos >= -tol.toleranciaSegundos) {
    return { ...OK, fonte: 'monotonica' }
  }

  const atraso = Math.abs(desvioSegundos)
  const gravidade: GravidadeRelogio =
    atraso >= tol.bloqueioMinutos * 60 ? 'bloqueio' : 'alerta'

  return {
    gravidade,
    desvioSegundos,
    fonte: 'monotonica',
    mensagem: `O relógio voltou ${descreverDuracao(atraso)} em relação ao último uso do sistema. Verifique a data e a hora da máquina — bateria da placa-mãe é a causa mais comum.`,
  }
}

/** O maior instante entre o atual e o último visto — nunca deixa o marco recuar. */
export function proximoUltimoVisto(agoraLocal: number, ultimoVisto: number | null): number {
  if (ultimoVisto === null || !Number.isFinite(ultimoVisto)) return agoraLocal
  return Math.max(agoraLocal, ultimoVisto)
}

export function descreverDuracao(segundos: number): string {
  if (segundos < 60) return `${segundos} s`
  const minutos = Math.round(segundos / 60)
  if (minutos < 60) return `${minutos} min`
  const horas = Math.round(minutos / 6) / 10
  if (horas < 48) return `${horas.toLocaleString('pt-BR')} h`
  return `${Math.round(horas / 24)} dias`
}
