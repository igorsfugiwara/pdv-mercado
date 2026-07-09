import log from 'electron-log'
import type { FiscalProvider } from './FiscalProvider'
import type {
  VendaFiscal,
  ResultadoEmissao,
  ResultadoCancelamento,
  StatusSefaz,
} from '@shared/types'

export interface AcbrConfig {
  libPath: string // caminho da ACBrNFCe (.dll no Windows / .so no Linux)
  ambiente: 'homologacao' | 'producao'
  certPath: string // data/certs/*.pfx
  certSenha: string // decodificada via safeStorage
  cscId: string
  cscToken: string
}

/**
 * Implementação concreta via ACBrLib NFCe carregada com `koffi` no processo main
 * (seção 7.1). Este é o ESQUELETO da Fase 3: a ligação FFI real com a lib é o
 * spike fiscal (Fase 0) — ver docs/FISCAL.md. Enquanto a lib não está integrada,
 * os métodos lançam `NaoImplementadoError` para não simular emissão fiscal falsa.
 *
 * A troca para produção é só de configuração/binário — a UI não muda (seção 7.2).
 */
export class NaoImplementadoError extends Error {
  constructor(metodo: string) {
    super(`ACBrLib ainda não integrada: ${metodo}. Ver docs/FISCAL.md (spike Fase 0).`)
    this.name = 'NaoImplementadoError'
  }
}

export class AcbrNfceProvider implements FiscalProvider {
  private carregada = false

  constructor(private readonly config: AcbrConfig) {}

  /** Inicializa a ACBrLib via koffi. TODO Fase 0/3: carregar símbolos NFCE_*. */
  async inicializar(): Promise<void> {
    // const koffi = require('koffi')
    // this.lib = koffi.load(this.config.libPath)
    // this.NFCE_Inicializar = this.lib.func('NFCE_Inicializar', 'int', ['string','string'])
    // ...configurar ACBrLib.ini com certificado, CSC, ambiente, SEFAZ-SP...
    log.warn('[fiscal] AcbrNfceProvider em modo esqueleto (ACBrLib não carregada).')
    this.carregada = false
  }

  private assertPronto() {
    if (!this.carregada) throw new NaoImplementadoError('provider não inicializado')
  }

  async emitir(_venda: VendaFiscal): Promise<ResultadoEmissao> {
    this.assertPronto()
    throw new NaoImplementadoError('emitir')
  }

  async cancelar(_chave: string, _justificativa: string): Promise<ResultadoCancelamento> {
    this.assertPronto()
    throw new NaoImplementadoError('cancelar')
  }

  async inutilizar(): Promise<void> {
    this.assertPronto()
    throw new NaoImplementadoError('inutilizar')
  }

  async statusServico(): Promise<StatusSefaz> {
    return {
      online: false,
      ambiente: this.config.ambiente,
      tempoRespostaMs: null,
      mensagem: 'ACBrLib não integrada (esqueleto Fase 3).',
    }
  }

  async validarCertificado(): Promise<{ valido: boolean; expiraEm: Date | null }> {
    return { valido: false, expiraEm: null }
  }
}
