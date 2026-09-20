/**
 * Idade e urgência de documento em contingência (RF-27).
 *
 * A fila já reprocessa sozinha, com backoff. O que faltava era **consequência**:
 * um documento de 3 minutos e um de 3 dias apareciam iguais no painel. E
 * contingência tem prazo — NFC-e emitida offline precisa ser transmitida em até
 * 24 h; depois disso não é aviso amarelo, é problema fiscal com multa.
 */

export type ClasseContingencia = 'normal' | 'atencao' | 'urgente' | 'vencido'

/** Prazo legal de transmissão, em horas. */
export const PRAZO_CONTINGENCIA_HORAS = 24

export const CHAVE_PRAZO_CONTINGENCIA = 'fiscal.contingencia.prazoHoras'

export interface SituacaoContingencia {
  classe: ClasseContingencia
  horas: number
  /** Quanto falta para vencer. Negativo quando já venceu. */
  horasRestantes: number
  mensagem: string
}

/**
 * Classifica pela idade desde a **emissão**, não desde a última tentativa: o
 * prazo corre a partir do momento em que a nota foi emitida offline, e
 * reprocessar sem sucesso não reinicia relógio nenhum.
 *
 * As faixas são proporcionais ao prazo, e não valores fixos: quem configurar
 * um prazo diferente continua tendo escalonamento coerente.
 */
export function classificarContingencia(
  emitidaEm: string | null,
  agora: number = Date.now(),
  prazoHoras: number = PRAZO_CONTINGENCIA_HORAS,
): SituacaoContingencia {
  // Documento sem data de emissão não dá para classificar — e chutar "vencido"
  // criaria alarme falso num dado incompleto.
  if (!emitidaEm) {
    return {
      classe: 'normal',
      horas: 0,
      horasRestantes: prazoHoras,
      mensagem: 'Sem data de emissão registrada.',
    }
  }

  const emitido = new Date(emitidaEm).getTime()
  if (!Number.isFinite(emitido)) {
    return {
      classe: 'normal',
      horas: 0,
      horasRestantes: prazoHoras,
      mensagem: 'Data de emissão inválida.',
    }
  }

  const horas = Math.max(0, (agora - emitido) / 3_600_000)
  const horasRestantes = prazoHoras - horas

  // As bordas caem na faixa de cima: 1 h já é atenção, 12 h já é urgente,
  // e no instante do prazo já é vencido. Arredondar para baixo aqui daria
  // folga que a lei não dá.
  const classe: ClasseContingencia =
    horas >= prazoHoras
      ? 'vencido'
      : horas >= prazoHoras / 2
        ? 'urgente'
        : horas >= prazoHoras / 24
          ? 'atencao'
          : 'normal'

  const mensagem =
    classe === 'vencido'
      ? `Emitido há ${formatarHoras(horas)} — o prazo de ${prazoHoras} h para transmitir já passou.`
      : classe === 'urgente'
        ? `Emitido há ${formatarHoras(horas)} — restam ${formatarHoras(horasRestantes)} para transmitir.`
        : `Emitido há ${formatarHoras(horas)}.`

  return { classe, horas, horasRestantes, mensagem }
}

/** A classe mais grave de um conjunto — é a que o painel mostra. */
export function piorClasse(classes: ClasseContingencia[]): ClasseContingencia {
  const ordem: ClasseContingencia[] = ['normal', 'atencao', 'urgente', 'vencido']
  return classes.reduce<ClasseContingencia>(
    (pior, c) => (ordem.indexOf(c) > ordem.indexOf(pior) ? c : pior),
    'normal',
  )
}

export function formatarHoras(horas: number): string {
  const abs = Math.abs(horas)
  if (abs < 1) return `${Math.round(abs * 60)} min`
  if (abs < 48) return `${Math.round(abs * 10) / 10} h`
  return `${Math.round(abs / 24)} dias`
}
