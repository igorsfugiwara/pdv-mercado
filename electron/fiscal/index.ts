import log from 'electron-log'
import { AcbrNfceProvider } from './AcbrNfceProvider'
import { SimuladoProvider, type ModoFalhaSimulado } from './SimuladoProvider'
import { ContingenciaQueue } from './contingenciaQueue'
import type { FiscalProvider } from './FiscalProvider'
import { configRepo } from '../db/repositories/config.repo'
import type { EstadoFiscal, ProviderFiscal } from '@shared/types'

let provider: FiscalProvider | null = null
let queue: ContingenciaQueue | null = null
let estado: EstadoFiscal = {
  provider: 'simulado',
  simulado: true,
  motivoFallback: null,
  modoFalha: 'nenhuma',
}

const MODOS_FALHA: ModoFalhaSimulado[] = ['nenhuma', 'timeout', 'rejeicao']

function lerModoFalha(valor: string | null): ModoFalhaSimulado {
  return MODOS_FALHA.includes(valor as ModoFalhaSimulado)
    ? (valor as ModoFalhaSimulado)
    : 'nenhuma'
}

async function montarSimulado(): Promise<SimuladoProvider> {
  return new SimuladoProvider({
    cnpj: (await configRepo.obter('loja.cnpj')) ?? '',
    uf: (await configRepo.obter('fiscal.uf')) ?? '35',
    serie: Number((await configRepo.obter('fiscal.serie')) ?? 1),
    latenciaMs: Number((await configRepo.obter('fiscal.simulado.latenciaMs')) ?? 0),
    falha: lerModoFalha(await configRepo.obter('fiscal.simulado.falha')),
  })
}

/**
 * Fábrica do módulo fiscal.
 *
 * O provider é escolhido por configuração (`fiscal.provider`), com **simulado
 * como padrão** enquanto a emissão real não for homologada. Se o `acbr` for
 * pedido e não subir — lib nativa ausente, certificado vencido —, o erro é
 * registrado e o módulo cai para simulado: um PDV que não abre porque o
 * certificado venceu é pior do que um que abre avisando.
 */
export async function initFiscal(onAlerta?: (msg: string) => void) {
  const escolhido = (((await configRepo.obter('fiscal.provider')) ?? 'simulado') === 'acbr'
    ? 'acbr'
    : 'simulado') as ProviderFiscal

  let motivoFallback: string | null = null
  let ativo: ProviderFiscal = 'simulado'
  let instancia: FiscalProvider

  if (escolhido === 'acbr') {
    const ambiente = ((await configRepo.obter('fiscal.ambiente')) ?? 'homologacao') as
      | 'homologacao'
      | 'producao'
    try {
      const acbr = new AcbrNfceProvider({
        libPath: (await configRepo.obter('fiscal.libPath')) ?? '',
        ambiente,
        certPath: (await configRepo.obter('fiscal.certPath')) ?? '',
        certSenha: '', // decodificada via safeStorage no boot; nunca persistida em claro
        cscId: (await configRepo.obter('fiscal.cscId')) ?? '',
        cscToken: (await configRepo.obter('fiscal.cscToken')) ?? '',
      })
      await acbr.inicializar()
      // `inicializar()` não lança sem a lib nativa: fica em modo esqueleto, e
      // só estoura na hora de emitir. Aceitar isso como "acbr" faria o app
      // anunciar fiscal real e quebrar no meio da primeira venda.
      if (!acbr.operacional) {
        throw new Error(
          'ACBrLib não carregada (libPath ausente ou inválido) — o módulo ficaria sem emitir.',
        )
      }
      instancia = acbr
      ativo = 'acbr'
    } catch (e) {
      motivoFallback = e instanceof Error ? e.message : String(e)
      log.error('[fiscal] ACBr não inicializou; caindo para simulado', e)
      instancia = await montarSimulado()
      onAlerta?.(
        'Módulo fiscal real indisponível. O caixa abriu em modo simulado — os documentos não têm valor fiscal.',
      )
    }
  } else {
    instancia = await montarSimulado()
  }

  provider = instancia
  estado = {
    provider: ativo,
    simulado: ativo === 'simulado',
    motivoFallback,
    modoFalha:
      instancia instanceof SimuladoProvider ? instancia.modoFalha() : 'nenhuma',
  }

  if (estado.simulado) {
    log.warn('[fiscal] modo SIMULADO ativo — documentos sem valor fiscal')
  }

  queue = new ContingenciaQueue(instancia, onAlerta)
  queue.iniciar()
  return { provider, queue, estado }
}

export function getFiscalProvider(): FiscalProvider {
  if (!provider) throw new Error('Módulo fiscal não inicializado.')
  return provider
}

export function getContingenciaQueue(): ContingenciaQueue {
  if (!queue) throw new Error('Fila de contingência não inicializada.')
  return queue
}

/** Estado para a UI sinalizar o modo simulado (RF-30). */
export function getEstadoFiscal(): EstadoFiscal {
  return estado
}

/**
 * Troca o modo de falha do simulado em tempo de execução, para exercitar
 * contingência e rejeição sem reiniciar o app. Só vale no simulado.
 */
export async function definirModoFalhaSimulado(modo: ModoFalhaSimulado) {
  if (!(provider instanceof SimuladoProvider)) {
    throw new Error('Modo de falha só existe no provider simulado.')
  }
  provider.definirFalha(modo)
  estado = { ...estado, modoFalha: modo }
  await configRepo.definir('fiscal.simulado.falha', modo)
}

/**
 * Injeção de dependência para testes — permite exercitar o fluxo de venda/fila
 * com um FiscalProvider fake, sem a ACBrLib. Não usar em produção.
 */
export function _setFiscalParaTestes(p: FiscalProvider | null, q?: ContingenciaQueue | null) {
  provider = p
  if (q !== undefined) queue = q
}
