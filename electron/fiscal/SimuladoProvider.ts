import log from 'electron-log'
import type { FiscalProvider } from './FiscalProvider'
import { montarChaveNfce } from '@shared/chaveFiscal'
import type {
  VendaFiscal,
  ResultadoEmissao,
  ResultadoCancelamento,
  StatusSefaz,
  DocumentoFiscal,
} from '@shared/types'

/**
 * Como o simulado deve falhar. É o que permite exercitar contingência e
 * rejeição sem derrubar rede nem esperar a SEFAZ cair.
 */
export type ModoFalhaSimulado = 'nenhuma' | 'timeout' | 'rejeicao'

export interface OpcoesSimulado {
  cnpj?: string
  uf?: string
  serie?: number
  /** Latência artificial, para exercitar a UI de espera. */
  latenciaMs?: number
  falha?: ModoFalhaSimulado
}

/**
 * Provider fiscal SIMULADO — código de aplicação, não de teste.
 *
 * Existe para o app subir, vender e fechar turno numa máquina sem ACBrLib, sem
 * certificado A1 e sem periférico. Os documentos que ele gera **não têm valor
 * fiscal**: a chave é estruturalmente válida (layout + DV mód-11) para a UI e o
 * banco funcionarem ponta a ponta, mas nada é transmitido à SEFAZ.
 *
 * Diferente do `FakeFiscalProvider` de `tests/support/`: aquele é controlado
 * pelo teste lance a lance; este é para o operador rodar.
 */
export class SimuladoProvider implements FiscalProvider {
  private readonly cnpj: string
  private readonly uf: string
  private readonly serie: number
  private readonly latenciaMs: number
  private falha: ModoFalhaSimulado

  constructor(opcoes: OpcoesSimulado = {}) {
    this.cnpj = (opcoes.cnpj ?? '').replace(/\D/g, '').padStart(14, '0').slice(0, 14)
    this.uf = opcoes.uf ?? '35' // SP
    this.serie = opcoes.serie ?? 1
    this.latenciaMs = Math.max(0, opcoes.latenciaMs ?? 0)
    this.falha = opcoes.falha ?? 'nenhuma'
  }

  /** Permite a tela de configuração trocar o modo sem recriar o provider. */
  definirFalha(modo: ModoFalhaSimulado) {
    this.falha = modo
  }

  modoFalha(): ModoFalhaSimulado {
    return this.falha
  }

  private async esperar() {
    if (this.latenciaMs > 0) await new Promise((r) => setTimeout(r, this.latenciaMs))
  }

  private chave(numero: number, tpEmis: 1 | 9 = 1): string {
    return montarChaveNfce({
      uf: this.uf,
      cnpj: this.cnpj,
      numero,
      serie: this.serie,
      tpEmis,
    })
  }

  private qrCode(chave: string): string {
    return `https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode?p=${chave}|2|2|1|SIMULADO`
  }

  async emitir(venda: VendaFiscal): Promise<ResultadoEmissao> {
    await this.esperar()

    // Timeout: lança, como a lib real lançaria. O vendaService trata no catch
    // e marca contingência — a venda continua existindo (invariante 1).
    if (this.falha === 'timeout') {
      throw new Error('SEFAZ indisponível (simulação: modo timeout).')
    }

    if (this.falha === 'rejeicao') {
      return {
        status: 'rejeitada',
        codigo: '539',
        motivo: 'Rejeição simulada: duplicidade de NF-e com diferença na chave de acesso.',
      }
    }

    const chave = this.chave(venda.vendaId)
    return {
      status: 'autorizada',
      chave,
      protocolo: `1${Date.now()}`.slice(0, 15),
      xml: `<nfeProc versao="4.00"><!-- SIMULADO, sem valor fiscal --><chNFe>${chave}</chNFe></nfeProc>`,
      qrCode: this.qrCode(chave),
    }
  }

  async retransmitir(doc: DocumentoFiscal): Promise<ResultadoEmissao> {
    await this.esperar()
    if (this.falha === 'timeout') {
      throw new Error('SEFAZ indisponível (simulação: modo timeout).')
    }
    const chave = doc.chaveAcesso ?? this.chave(doc.vendaId)
    return {
      status: 'autorizada',
      chave,
      protocolo: `1${Date.now()}`.slice(0, 15),
      xml: `<nfeProc versao="4.00"><!-- SIMULADO, sem valor fiscal --><chNFe>${chave}</chNFe></nfeProc>`,
      qrCode: this.qrCode(chave),
    }
  }

  async cancelar(chave: string, justificativa: string): Promise<ResultadoCancelamento> {
    await this.esperar()
    log.info('[fiscal:simulado] cancelamento simulado', { chave, justificativa })
    return { ok: true, protocolo: `1${Date.now()}`.slice(0, 15) }
  }

  async inutilizar(
    serie: number,
    numIni: number,
    numFim: number,
    justificativa: string,
  ): Promise<void> {
    await this.esperar()
    log.info('[fiscal:simulado] inutilização simulada', { serie, numIni, numFim, justificativa })
  }

  async statusServico(): Promise<StatusSefaz> {
    await this.esperar()
    return {
      online: this.falha !== 'timeout',
      ambiente: 'homologacao',
      tempoRespostaMs: this.latenciaMs,
      mensagem:
        this.falha === 'timeout'
          ? 'Modo simulado — falha de comunicação injetada. Documentos sem valor fiscal.'
          : 'Modo simulado — sem comunicação real com a SEFAZ. Documentos sem valor fiscal.',
    }
  }

  /** Não existe certificado nenhum aqui, e dizer o contrário seria mentira. */
  async validarCertificado(): Promise<{ valido: boolean; expiraEm: Date | null }> {
    return { valido: false, expiraEm: null }
  }
}
