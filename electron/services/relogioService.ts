import log from 'electron-log'
import { configRepo } from '../db/repositories/config.repo'
import { auditoriaRepo } from '../db/repositories/auditoria.repo'
import { getFiscalProvider } from '../fiscal'
import {
  compararMonotonico,
  compararComReferencia,
  proximoUltimoVisto,
  CHAVES_RELOGIO,
  TOLERANCIAS_PADRAO,
  type VereditoRelogio,
  type TolerânciasRelogio,
} from '@shared/relogio'

/**
 * Verificação do relógio (fatia 09).
 *
 * Duas fontes, nesta ordem: a SEFAZ quando há rede (é literalmente o relógio
 * contra o qual a nota será validada) e a detecção monotônica sempre — que é a
 * que funciona na loja offline.
 */

let ultimoVeredito: VereditoRelogio | null = null

async function lerTolerancias(): Promise<TolerânciasRelogio> {
  const num = async (chave: string, padrao: number) => {
    const v = Number(await configRepo.obter(chave))
    return Number.isFinite(v) && v > 0 ? v : padrao
  }
  return {
    toleranciaSegundos: await num(
      CHAVES_RELOGIO.toleranciaSegundos,
      TOLERANCIAS_PADRAO.toleranciaSegundos,
    ),
    bloqueioMinutos: await num(
      CHAVES_RELOGIO.bloqueioMinutos,
      TOLERANCIAS_PADRAO.bloqueioMinutos,
    ),
  }
}

/**
 * Confere o relógio e grava o marco. Chamado no boot e a cada venda.
 *
 * Nunca lança: um problema ao verificar a hora não pode impedir a loja de
 * vender — o objetivo é avisar, não bloquear.
 */
export async function verificarRelogio(): Promise<VereditoRelogio> {
  try {
    const tol = await lerTolerancias()
    const agora = Date.now()

    const bruto = await configRepo.obter(CHAVES_RELOGIO.ultimoVisto)
    const ultimoVisto = bruto ? Number(bruto) : null

    // 1) Monotônica primeiro: é a que não depende de rede.
    let veredito = compararMonotonico(agora, ultimoVisto, tol)

    // 2) Se há SEFAZ respondendo, a referência dela é melhor. Só sobrepõe
    //    quando acusa algo — uma SEFAZ muda não invalida a detecção local.
    if (veredito.gravidade === 'ok') {
      const referencia = await horaDaSefaz()
      if (referencia !== null) {
        const porRede = compararComReferencia(agora, referencia, 'sefaz', tol)
        if (porRede.gravidade !== 'ok') veredito = porRede
      }
    }

    // O marco nunca recua: senão um relógio errado "normalizaria" o histórico.
    await configRepo.definir(
      CHAVES_RELOGIO.ultimoVisto,
      String(proximoUltimoVisto(agora, ultimoVisto)),
    )

    if (veredito.gravidade !== 'ok') {
      log.warn('[relogio]', veredito.mensagem)
      await auditoriaRepo.registrar(null, 'relogio_desvio', {
        desvioSegundos: veredito.desvioSegundos,
        fonte: veredito.fonte,
        gravidade: veredito.gravidade,
      })
    }

    ultimoVeredito = veredito
    return veredito
  } catch (e) {
    log.error('[relogio] falha ao verificar', e)
    const neutro: VereditoRelogio = {
      gravidade: 'ok',
      desvioSegundos: 0,
      fonte: 'monotonica',
      mensagem: 'Relógio não verificado.',
    }
    ultimoVeredito = neutro
    return neutro
  }
}

/**
 * Hora da SEFAZ, quando disponível.
 *
 * O provider simulado não tem hora de servidor nenhuma — devolver a hora local
 * ali faria o desvio ser sempre zero e mascararia o problema. Por isso só vale
 * com provider real e online.
 */
async function horaDaSefaz(): Promise<number | null> {
  try {
    const status = await getFiscalProvider().statusServico()
    if (!status.online || !status.horaServidor) return null
    const t = new Date(status.horaServidor).getTime()
    return Number.isFinite(t) ? t : null
  } catch {
    return null
  }
}

export function getVereditoRelogio(): VereditoRelogio | null {
  return ultimoVeredito
}
