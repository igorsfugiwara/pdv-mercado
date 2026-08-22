import type {
  VendaFiscal,
  ResultadoEmissao,
  ResultadoCancelamento,
  StatusSefaz,
  DocumentoFiscal,
} from '@shared/types'
// Type-only: some a compilação, então `server/` não carrega nada de `electron/`
// em runtime — só reaproveita o contrato da seção 7.2 do PRD.
import type { FiscalProvider } from '../electron/fiscal/FiscalProvider'

/**
 * SIMULAÇÃO fiscal para a versão web.
 *
 * Emissão real de NFC-e precisa da ACBrLib nativa + certificado A1 no disco —
 * nada disso existe numa serverless function. A implementação de verdade é a
 * `AcbrNfceProvider` do app desktop (`electron/fiscal/`); esta aqui devolve o
 * mesmo formato de resposta para a UI funcionar ponta a ponta, com chave de
 * acesso estruturalmente válida (layout NFC-e + DV mód-11).
 *
 * Documentos gerados aqui NÃO têm valor fiscal.
 */
export class FiscalWebSimulado implements FiscalProvider {
  private readonly cnpj: string
  private readonly uf = '35' // SP

  constructor(cnpj = '00000000000000') {
    this.cnpj = cnpj.replace(/\D/g, '').padStart(14, '0').slice(0, 14)
  }

  async emitir(venda: VendaFiscal): Promise<ResultadoEmissao> {
    const chave = this.montarChave(venda.vendaId, 1)
    return {
      status: 'autorizada',
      chave,
      protocolo: `1${Date.now()}`.slice(0, 15),
      xml: `<nfeProc versao="4.00"><!-- simulado --><chNFe>${chave}</chNFe></nfeProc>`,
      qrCode: this.qrCode(chave),
    }
  }

  async retransmitir(doc: DocumentoFiscal): Promise<ResultadoEmissao> {
    const chave = doc.chaveAcesso ?? this.montarChave(doc.vendaId, 1)
    return {
      status: 'autorizada',
      chave,
      protocolo: `1${Date.now()}`.slice(0, 15),
      xml: `<nfeProc versao="4.00"><!-- simulado --><chNFe>${chave}</chNFe></nfeProc>`,
      qrCode: this.qrCode(chave),
    }
  }

  async cancelar(): Promise<ResultadoCancelamento> {
    return { ok: true, protocolo: `1${Date.now()}`.slice(0, 15) }
  }

  async inutilizar(): Promise<void> {}

  async statusServico(): Promise<StatusSefaz> {
    return {
      online: true,
      ambiente: 'homologacao',
      tempoRespostaMs: 1,
      mensagem: 'Simulação web — sem comunicação real com a SEFAZ.',
    }
  }

  async validarCertificado(): Promise<{ valido: boolean; expiraEm: Date | null }> {
    return { valido: false, expiraEm: null }
  }

  /** Layout da chave (NT 2015/002): cUF AAMM CNPJ mod serie nNF tpEmis cNF cDV. */
  private montarChave(numero: number, serie: number, tpEmis = 1): string {
    const agora = new Date()
    const aamm = `${String(agora.getFullYear()).slice(2)}${String(agora.getMonth() + 1).padStart(2, '0')}`
    const cNF = String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
    const base =
      this.uf +
      aamm +
      this.cnpj +
      '65' +
      String(serie).padStart(3, '0') +
      String(numero).padStart(9, '0') +
      String(tpEmis) +
      cNF
    return base + this.dvModulo11(base)
  }

  /** DV da chave: módulo 11 com pesos 2..9 cíclicos, da direita para a esquerda. */
  private dvModulo11(base: string): string {
    let soma = 0
    let peso = 2
    for (let i = base.length - 1; i >= 0; i--) {
      soma += Number(base[i]) * peso
      peso = peso === 9 ? 2 : peso + 1
    }
    const resto = soma % 11
    return String(resto === 0 || resto === 1 ? 0 : 11 - resto)
  }

  private qrCode(chave: string): string {
    return `https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode?p=${chave}|2|2|1|SIMULADO`
  }
}

let _provider: FiscalProvider | null = null

/** Devolve o contrato, não a classe: o resto do servidor só conhece FiscalProvider. */
export function getFiscalProvider(cnpj?: string): FiscalProvider {
  if (!_provider) _provider = new FiscalWebSimulado(cnpj)
  return _provider
}
