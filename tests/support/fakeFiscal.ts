import type { FiscalProvider } from '../../electron/fiscal/FiscalProvider'
import type {
  VendaFiscal,
  ResultadoEmissao,
  ResultadoCancelamento,
  StatusSefaz,
  DocumentoFiscal,
} from '../../shared/types'

const AUTORIZADA: ResultadoEmissao = {
  status: 'autorizada',
  chave: 'NFCe35240100000000000165550010000000011000000010',
  protocolo: '135240000000001',
  xml: '<nfeProc/>',
}

/**
 * FiscalProvider fake p/ testes: comportamento controlável (online/offline,
 * resposta de emissão e de retransmissão), sem depender da ACBrLib.
 */
export class FakeFiscalProvider implements FiscalProvider {
  online = true
  proximaEmissao: ResultadoEmissao = AUTORIZADA
  proximaRetransmissao: ResultadoEmissao = AUTORIZADA
  lancarNaEmissao = false
  readonly emissoes: VendaFiscal[] = []
  readonly retransmissoes: DocumentoFiscal[] = []

  async emitir(venda: VendaFiscal): Promise<ResultadoEmissao> {
    this.emissoes.push(venda)
    if (this.lancarNaEmissao) throw new Error('SEFAZ indisponível (fake timeout)')
    return this.proximaEmissao
  }

  async retransmitir(doc: DocumentoFiscal): Promise<ResultadoEmissao> {
    this.retransmissoes.push(doc)
    return this.proximaRetransmissao
  }

  async cancelar(): Promise<ResultadoCancelamento> {
    return { ok: true, protocolo: 'C-1' }
  }

  async inutilizar(): Promise<void> {}

  async statusServico(): Promise<StatusSefaz> {
    return {
      online: this.online,
      ambiente: 'homologacao',
      tempoRespostaMs: this.online ? 10 : null,
      mensagem: this.online ? 'ok' : 'offline',
    }
  }

  async validarCertificado(): Promise<{ valido: boolean; expiraEm: Date | null }> {
    return { valido: true, expiraEm: new Date('2030-01-01') }
  }
}
