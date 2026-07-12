import { AcbrNfceProvider } from './AcbrNfceProvider'
import { ContingenciaQueue } from './contingenciaQueue'
import type { FiscalProvider } from './FiscalProvider'
import { configRepo } from '../db/repositories/config.repo'

let provider: FiscalProvider | null = null
let queue: ContingenciaQueue | null = null

// Fábrica do módulo fiscal. Lê configuração persistida (ambiente, certificado, CSC).
export async function initFiscal(onAlerta?: (msg: string) => void) {
  const ambiente = ((await configRepo.obter('fiscal.ambiente')) ?? 'homologacao') as
    | 'homologacao'
    | 'producao'
  const acbr = new AcbrNfceProvider({
    libPath: (await configRepo.obter('fiscal.libPath')) ?? '',
    ambiente,
    certPath: (await configRepo.obter('fiscal.certPath')) ?? '',
    certSenha: '', // decodificada via safeStorage no boot; nunca persistida em claro
    cscId: (await configRepo.obter('fiscal.cscId')) ?? '',
    cscToken: (await configRepo.obter('fiscal.cscToken')) ?? '',
  })
  await acbr.inicializar()
  provider = acbr
  queue = new ContingenciaQueue(acbr, onAlerta)
  queue.iniciar()
  return { provider, queue }
}

export function getFiscalProvider(): FiscalProvider {
  if (!provider) throw new Error('Módulo fiscal não inicializado.')
  return provider
}

export function getContingenciaQueue(): ContingenciaQueue {
  if (!queue) throw new Error('Fila de contingência não inicializada.')
  return queue
}

/**
 * Injeção de dependência para testes — permite exercitar o fluxo de venda/fila
 * com um FiscalProvider fake, sem a ACBrLib. Não usar em produção.
 */
export function _setFiscalParaTestes(p: FiscalProvider | null, q?: ContingenciaQueue | null) {
  provider = p
  if (q !== undefined) queue = q
}
