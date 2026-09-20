import log from 'electron-log'
import type { FiscalProvider } from './FiscalProvider'
import type {
  VendaFiscal,
  ResultadoEmissao,
  ResultadoCancelamento,
  StatusSefaz,
  DocumentoFiscal,
  FormaPagamento,
} from '@shared/types'

export interface AcbrConfig {
  libPath: string // caminho da ACBrNFCe (.dll no Windows / .so no Linux)
  ambiente: 'homologacao' | 'producao'
  certPath: string // data/certs/*.pfx
  certSenha: string // decodificada via safeStorage
  cscId: string
  cscToken: string
  iniPath?: string // ACBrLib.ini gerado no boot (certificado/CSC/UF/ambiente)
}

// ACBrLib devolve strings via buffer + tamanho (padrão char* / int*).
const BUFFER_RESPOSTA = 64 * 1024

// tPag da NFe (Anexo do Manual): mapeamento aproximado — validar com o contador.
const TPAG: Record<FormaPagamento, string> = {
  dinheiro: '01',
  credito: '03',
  debito: '04',
  pix: '17',
  voucher: '10',
}

/**
 * Implementação concreta via ACBrLib NFCe carregada com `koffi` no processo main
 * (seção 7.1 / docs/FISCAL.md). O carregamento FFI e a bateria de homologação
 * são o SPIKE FISCAL (gate Fase 0/3) e só rodam com a lib nativa + certificado A1
 * reais — não são exercitáveis em CI.
 *
 * Enquanto a lib não está presente/carregável, `inicializar()` mantém o provider
 * em modo esqueleto (`carregada=false`) e os métodos lançam `NaoImplementadoError`,
 * para nunca simular emissão fiscal falsa. A troca p/ produção é só configuração.
 *
 * As partes puras — `montarIniNfce` (INI da NFC-e) e `parseRetornoEnvio` (parse do
 * retorno da SEFAZ) — são exportadas e cobertas por testes.
 */
export class NaoImplementadoError extends Error {
  constructor(metodo: string) {
    super(`ACBrLib ainda não integrada: ${metodo}. Ver docs/FISCAL.md (spike Fase 0).`)
    this.name = 'NaoImplementadoError'
  }
}

export class AcbrNfceProvider implements FiscalProvider {
  private carregada = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private fn: Record<string, any> = {}

  constructor(private readonly config: AcbrConfig) {}

  /**
   * A lib nativa subiu de verdade?
   *
   * `inicializar()` não lança quando a ACBrLib está ausente — fica em modo
   * esqueleto de propósito, para nunca simular emissão falsa. Quem escolhe o
   * provider precisa poder perguntar isto, senão o app anuncia "fiscal real"
   * enquanto toda emissão vai estourar `NaoImplementadoError` no meio da venda.
   */
  get operacional(): boolean {
    return this.carregada
  }

  /** Carrega a ACBrLib via koffi e aplica a configuração fiscal. */
  async inicializar(): Promise<void> {
    if (!this.config.libPath) {
      log.warn('[fiscal] libPath vazio — AcbrNfceProvider em modo esqueleto.')
      this.carregada = false
      return
    }
    try {
      // koffi é módulo nativo CJS; import dinâmico evita custo quando sem lib.
      const koffiMod = await import('koffi')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const koffi: any = (koffiMod as any).default ?? koffiMod
      const lib = koffi.load(this.config.libPath)

      // Assinaturas ACBrLib (prefixo pode ser NFE_ ou NFCE_ conforme o build).
      // Saídas string usam (_Out char* buffer, _Inout int* tamanho).
      const P = 'NFCE_'
      this.fn.Inicializar = lib.func(`int ${P}Inicializar(const char* eArqConfig, const char* eChaveCrypt)`)
      this.fn.Finalizar = lib.func(`int ${P}Finalizar()`)
      this.fn.ConfigGravarValor = lib.func(`int ${P}ConfigGravarValor(const char* eSessao, const char* eChave, const char* eValor)`)
      this.fn.LimparLista = lib.func(`int ${P}LimparLista()`)
      this.fn.CarregarINI = lib.func(`int ${P}CarregarINI(const char* eArquivoOuINI)`)
      this.fn.Enviar = lib.func(`int ${P}Enviar(int ALote, bool AImprimir, bool ASincrono, bool AZipado, _Out char* sResposta, _Inout int* esTamanho)`)
      this.fn.StatusServico = lib.func(`int ${P}StatusServico(_Out char* sResposta, _Inout int* esTamanho)`)
      this.fn.Cancelar = lib.func(`int ${P}Cancelar(const char* eChave, const char* eJustificativa, const char* eCNPJ, int ALote, _Out char* sResposta, _Inout int* esTamanho)`)
      this.fn.Inutilizar = lib.func(`int ${P}Inutilizar(const char* eCNPJ, const char* eJustificativa, int ano, int modelo, int serie, int numeroInicial, int numeroFinal, _Out char* sResposta, _Inout int* esTamanho)`)

      const rc = this.fn.Inicializar(this.config.iniPath ?? '', '')
      if (rc < 0) throw new Error(`NFCE_Inicializar retornou ${rc}`)
      this.aplicarConfig()
      this.carregada = true
      log.info('[fiscal] ACBrLib NFCe carregada e configurada.')
    } catch (e) {
      log.error('[fiscal] falha ao carregar ACBrLib; seguindo em esqueleto.', e)
      this.carregada = false
    }
  }

  /** Grava a configuração fiscal na ACBrLib (certificado A1, CSC, UF-SP, ambiente). */
  private aplicarConfig() {
    const set = (sessao: string, chave: string, valor: string) =>
      this.fn.ConfigGravarValor(sessao, chave, valor)
    set('DFe', 'ArquivoPFX', this.config.certPath)
    set('DFe', 'Senha', this.config.certSenha)
    set('NFCe', 'IdCSC', this.config.cscId)
    set('NFCe', 'CSC', this.config.cscToken)
    set('NFe', 'Ambiente', this.config.ambiente === 'producao' ? '1' : '2')
    set('NFe', 'FormaEmissao', '1') // 1=Normal; 9=contingência offline é tratada na fila
    set('DFe', 'UF', 'SP')
    // TipoResposta=0 (INI) — parseRetornoEnvio espera chave=valor.
    set('Principal', 'TipoResposta', '0')
  }

  /** Executa uma função ACBr com saída em buffer e devolve a resposta como string. */
  private chamarComResposta(fn: (buf: Buffer, tam: number[]) => number, rotulo: string): string {
    const buf = Buffer.alloc(BUFFER_RESPOSTA)
    const tam = [BUFFER_RESPOSTA]
    const rc = fn(buf, tam)
    if (rc < 0) throw new Error(`${rotulo} retornou ${rc}`)
    return buf.toString('utf8', 0, Math.min(tam[0], BUFFER_RESPOSTA))
  }

  private assertPronto() {
    if (!this.carregada) throw new NaoImplementadoError('provider não inicializado')
  }

  async emitir(venda: VendaFiscal): Promise<ResultadoEmissao> {
    this.assertPronto()
    this.fn.LimparLista()
    const rcIni = this.fn.CarregarINI(montarIniNfce(venda, this.config))
    if (rcIni < 0) throw new Error(`CarregarINI retornou ${rcIni}`)
    const resp = this.chamarComResposta(
      (buf, tam) => this.fn.Enviar(1, false, true, false, buf, tam),
      'NFCE_Enviar',
    )
    return parseRetornoEnvio(resp)
  }

  async retransmitir(doc: DocumentoFiscal): Promise<ResultadoEmissao> {
    this.assertPronto()
    // Reenvia o XML já assinado da contingência (tpEmis=9) p/ conciliação.
    // GATE Fase 3: hoje `documentos_fiscais.xmlPath` nunca é gravado (nem em
    // vendaService nem no catch de timeout), então este ramo é sempre pulado e
    // o Enviar iria transmitir lote vazio → doc marcado 'rejeitada'. Ao integrar
    // a lib, persistir o XML assinado da contingência na emissão e carregá-lo aqui.
    if (doc.xmlPath) {
      this.fn.LimparLista()
      const rc = this.fn.CarregarINI(doc.xmlPath)
      if (rc < 0) throw new Error(`CarregarINI(contingência) retornou ${rc}`)
    }
    const resp = this.chamarComResposta(
      (buf, tam) => this.fn.Enviar(1, false, true, false, buf, tam),
      'NFCE_Enviar(retransmissão)',
    )
    return parseRetornoEnvio(resp)
  }

  async cancelar(chave: string, justificativa: string): Promise<ResultadoCancelamento> {
    this.assertPronto()
    const resp = this.chamarComResposta(
      (buf, tam) => this.fn.Cancelar(chave, justificativa, '', 1, buf, tam),
      'NFCE_Cancelar',
    )
    const cStat = valorIni(resp, 'cStat')
    // 101/135/155 = cancelamento homologado.
    const ok = ['101', '135', '155'].includes(cStat ?? '')
    return { ok, protocolo: valorIni(resp, 'nProt') ?? undefined, motivo: valorIni(resp, 'xMotivo') ?? undefined }
  }

  async inutilizar(serie: number, numIni: number, numFim: number, justificativa: string): Promise<void> {
    this.assertPronto()
    const ano = new Date().getFullYear() % 100
    this.chamarComResposta(
      (buf, tam) => this.fn.Inutilizar('', justificativa, ano, 65, serie, numIni, numFim, buf, tam),
      'NFCE_Inutilizar',
    )
  }

  async statusServico(): Promise<StatusSefaz> {
    if (!this.carregada) {
      return {
        online: false,
        ambiente: this.config.ambiente,
        tempoRespostaMs: null,
        mensagem: 'ACBrLib não integrada (esqueleto Fase 3).',
      }
    }
    try {
      const resp = this.chamarComResposta(
        (buf, tam) => this.fn.StatusServico(buf, tam),
        'NFCE_StatusServico',
      )
      const cStat = valorIni(resp, 'cStat')
      return {
        online: cStat === '107', // 107 = Serviço em Operação
        ambiente: this.config.ambiente,
        tempoRespostaMs: null,
        mensagem: valorIni(resp, 'xMotivo') ?? 'sem retorno',
      }
    } catch (e) {
      return {
        online: false,
        ambiente: this.config.ambiente,
        tempoRespostaMs: null,
        mensagem: String(e),
      }
    }
  }

  async validarCertificado(): Promise<{ valido: boolean; expiraEm: Date | null }> {
    // TODO Fase 3: NFCE_GetCertDataVenc / consultar via ConfigLerValor. Sem lib → inválido.
    return { valido: false, expiraEm: null }
  }
}

/** Lê `chave=valor` de um retorno INI da ACBrLib (case-insensitive na chave). */
export function valorIni(texto: string, chave: string): string | null {
  const re = new RegExp(`^\\s*${chave}\\s*=\\s*(.+)\\s*$`, 'im')
  const m = texto.match(re)
  return m ? m[1].trim() : null
}

/**
 * Interpreta o retorno de `NFCE_Enviar` (INI) e mapeia para `ResultadoEmissao`.
 * cStat 100/150 = autorizada; demais = rejeitada (código+motivo).
 */
export function parseRetornoEnvio(resp: string): ResultadoEmissao {
  // GATE Fase 3: `valorIni` pega o PRIMEIRO cStat do retorno. Num lote INI da
  // ACBr, o cStat do envelope (ex.: 104 "Lote processado") pode preceder o da
  // nota (100). Validar o formato real e, se necessário, ler o cStat da seção
  // da NF-e (protNFe) em vez do topo. Idem para nProt/chNFe.
  const cStat = valorIni(resp, 'cStat') ?? ''
  const xMotivo = valorIni(resp, 'xMotivo') ?? 'sem motivo'
  const chave = valorIni(resp, 'chNFe') ?? valorIni(resp, 'chave') ?? ''
  const protocolo = valorIni(resp, 'nProt') ?? valorIni(resp, 'protocolo') ?? ''
  const xml = valorIni(resp, 'XML') ?? valorIni(resp, 'xml') ?? ''
  const qrCode = valorIni(resp, 'qrCode') ?? valorIni(resp, 'urlChave') ?? valorIni(resp, 'infNFeSupl') ?? ''

  if (['100', '150'].includes(cStat)) {
    return { status: 'autorizada', chave, protocolo, xml, qrCode }
  }
  return { status: 'rejeitada', codigo: cStat || 'ERRO', motivo: xMotivo }
}

/**
 * Monta o INI da NFC-e no formato aceito por `NFCE_CarregarINI` (pura/testável).
 * Subconjunto pragmático — os campos tributários completos (PIS/COFINS/CEST) e a
 * numeração dependem do cadastro fiscal e do contador (docs/FISCAL.md).
 *
 * GATE Fase 3 (validar com a lib/contador antes de produção):
 *  - Descontos: `VendaFiscal` não carrega desconto de item/venda, então vProd sai
 *    cheio e sem vDesc; com desconto, sum(vProd) > sum(vPag) → SEFAZ rejeita.
 *    Threadar o desconto por item + vDesc, ou emitir vDesc no total.
 *  - Pesáveis: vUnCom com 2 casas pode quebrar qCom*vUnCom=vProd (a NF-e admite
 *    até ~10 casas em vUnCom). Usar precisão maior para itens fracionários.
 */
export function montarIniNfce(venda: VendaFiscal, config: AcbrConfig): string {
  const L: string[] = []
  L.push('[infNFe]', 'versao=4.00', '')
  L.push('[Identificacao]')
  L.push('natOp=Venda ao consumidor')
  L.push('mod=65', 'serie=1', 'tpNF=1', 'idDest=1')
  L.push('tpImp=4', 'tpEmis=1', 'finNFe=1', 'indFinal=1', 'indPres=1')
  L.push(`tpAmb=${config.ambiente === 'producao' ? 1 : 2}`, '')

  if (venda.clienteCpf) {
    L.push('[Destinatario]', `CNPJCPF=${venda.clienteCpf}`, 'indIEDest=9', '')
  }

  venda.itens.forEach((it, i) => {
    const n = String(i + 1).padStart(3, '0')
    const totalItem = Math.round(it.valorUnitario * it.quantidade)
    L.push(`[Produto${n}]`)
    L.push(`cProd=${i + 1}`)
    L.push(`cEAN=${it.ean ?? 'SEM GTIN'}`)
    L.push(`xProd=${it.descricao}`)
    L.push(`NCM=${it.ncm || '00000000'}`)
    L.push(`CFOP=${it.cfop || '5102'}`)
    L.push(`uCom=${it.unidade}`)
    L.push(`qCom=${it.quantidade}`)
    L.push(`vUnCom=${(it.valorUnitario / 100).toFixed(2)}`)
    L.push(`vProd=${(totalItem / 100).toFixed(2)}`)
    L.push(`cEANTrib=${it.ean ?? 'SEM GTIN'}`)
    L.push(`uTrib=${it.unidade}`)
    L.push(`qTrib=${it.quantidade}`)
    L.push(`vUnTrib=${(it.valorUnitario / 100).toFixed(2)}`)
    L.push(`indTot=1`, '')
    // Simples Nacional → ICMS por CSOSN.
    L.push(`[ICMS${n}]`, 'orig=0', `CSOSN=${it.csosn || '102'}`, '')
    L.push(`[PIS${n}]`, 'CST=49', '')
    L.push(`[COFINS${n}]`, 'CST=49', '')
  })

  venda.pagamentos.forEach((p, i) => {
    const n = String(i + 1).padStart(3, '0')
    L.push(`[pag${n}]`, `tPag=${TPAG[p.forma]}`, `vPag=${(p.valor / 100).toFixed(2)}`, '')
  })

  return L.join('\r\n')
}
