import type { Perfil } from './types'

/**
 * Regra de autorização de desconto (RF-05).
 *
 * Função pura, num arquivo compartilhado, porque a regra precisa valer nos dois
 * lados: a UI usa para decidir se pede PIN, e o **main usa para decidir se
 * concede**. Um renderer comprometido não pode conceder desconto acima do teto —
 * a tela é conveniência, a regra é aqui.
 *
 * Limites em **basis points**: 500 = 5,00%. Percentual é o que o dono do mercado
 * raciocina, e inteiro evita float em cima de dinheiro.
 */

export interface LimitesDesconto {
  operador: number
  supervisor: number
  admin: number
}

/** Tetos padrão, usados quando a configuração não existe. */
export const LIMITES_PADRAO: LimitesDesconto = {
  operador: 500, // 5,00%
  supervisor: 1500, // 15,00%
  admin: 10000, // 100,00%
}

export const CHAVES_LIMITE: Record<keyof LimitesDesconto, string> = {
  operador: 'desconto.limite.operador',
  supervisor: 'desconto.limite.supervisor',
  admin: 'desconto.limite.admin',
}

/**
 * Teto do perfil. Perfil desconhecido cai no **mais restritivo**: se a regra não
 * souber quem é, ela nega mais, não menos.
 */
export function limiteDoPerfil(perfil: Perfil | string, limites: LimitesDesconto): number {
  switch (perfil) {
    case 'admin':
      return limites.admin
    case 'supervisor':
      return limites.supervisor
    case 'operador':
      return limites.operador
    default:
      return Math.min(limites.operador, limites.supervisor, limites.admin)
  }
}

/**
 * O desconto pedido passa do que este perfil concede sozinho?
 *
 * A comparação é `>` e não `>=`: um operador com teto de 5% **pode** dar 5%
 * exatos sem pedir PIN. É a borda que toda implementação erra.
 */
export function exigeAutorizacao(
  perfil: Perfil | string,
  descontoBps: number,
  limites: LimitesDesconto,
): boolean {
  return descontoBps > limiteDoPerfil(perfil, limites)
}

export type ResultadoAutorizacao =
  | { ok: true }
  | { ok: false; motivo: string }

/**
 * Quem autorizou tem alçada para este desconto?
 *
 * Um supervisor com teto de 15% não autoriza 50% — e a resposta certa é recusa
 * com o motivo, não um segundo pedido de PIN.
 */
export function podeAutorizar(
  perfilAutorizador: Perfil | string,
  descontoBps: number,
  limites: LimitesDesconto,
): ResultadoAutorizacao {
  const teto = limiteDoPerfil(perfilAutorizador, limites)
  if (descontoBps <= teto) return { ok: true }
  return {
    ok: false,
    motivo: `Desconto de ${formatarBps(descontoBps)} acima do limite de ${formatarBps(teto)} deste perfil.`,
  }
}

/** Converte basis points em percentual legível: 1250 → "12,50%". */
export function formatarBps(bps: number): string {
  return `${(bps / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`
}

/**
 * Quanto o desconto representa da base, em basis points.
 * Base zero devolve 0 — não existe percentual de nada, e lançar aqui só
 * empurraria o problema para o chamador.
 */
export function descontoParaBps(descontoCentavos: number, baseCentavos: number): number {
  if (baseCentavos <= 0) return 0
  return Math.round((descontoCentavos * 10000) / baseCentavos)
}

/**
 * Valor do desconto em centavos, a partir do percentual.
 * Arredonda **uma vez, no fim** — arredondar item a item acumula erro.
 */
export function bpsParaCentavos(bps: number, baseCentavos: number): number {
  return Math.round((baseCentavos * bps) / 10000)
}
