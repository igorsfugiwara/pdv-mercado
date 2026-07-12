import log from 'electron-log'
import type { DanfeNfceDados, FormaPagamento } from '@shared/types'

// Impressora térmica ESC/POS (Epson TM-T20X, Elgin i9, Bematech MP-4200 TH).
// Usa `node-thermal-printer`. Aqui: interface + página de teste + kick de gaveta.
export interface PrinterConfig {
  tipo: 'epson' | 'star'
  interface: string // 'printer:auto' | 'tcp://192.168.0.100' | '/dev/usb/lp0'
  larguraColunas: number
}

let config: PrinterConfig | null = null

export function configurarImpressora(cfg: PrinterConfig) {
  config = cfg
}

async function novaImpressora() {
  if (!config) throw new Error('Impressora não configurada (Config → Periféricos).')
  const { ThermalPrinter, PrinterTypes } = await import('node-thermal-printer')
  return new ThermalPrinter({
    type: config.tipo === 'star' ? PrinterTypes.STAR : PrinterTypes.EPSON,
    interface: config.interface,
    width: config.larguraColunas,
    characterSet: 'PC850_MULTILINGUAL' as any,
    removeSpecialCharacters: false,
  })
}

// Config → Periféricos: imprime página de teste.
export async function imprimirTeste(): Promise<{ ok: boolean; detalhe: string }> {
  try {
    const p = await novaImpressora()
    p.alignCenter()
    p.bold(true)
    p.println('PDV MERCADO — TESTE')
    p.bold(false)
    p.println(new Date().toLocaleString('pt-BR'))
    p.drawLine()
    p.alignLeft()
    p.println('Impressora configurada com sucesso.')
    p.cut()
    await p.execute()
    return { ok: true, detalhe: 'Página de teste enviada.' }
  } catch (e) {
    log.error('[printer] teste falhou', e)
    return { ok: false, detalhe: String(e) }
  }
}

const ROTULO_FORMA: Record<FormaPagamento, string> = {
  dinheiro: 'Dinheiro',
  debito: 'Cartao Debito',
  credito: 'Cartao Credito',
  pix: 'PIX',
  voucher: 'Voucher',
}

const brl = (centavos: number) => (centavos / 100).toFixed(2).replace('.', ',')

/** Agrupa a chave de acesso (44 dígitos) em blocos de 4, como no leiaute NFC-e. */
function agruparChave(chave: string): string {
  return chave.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ')
}

function formatCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '')
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : cpf
}

/**
 * Monta as linhas de texto do DANFE NFC-e (RF-26) — função pura e testável.
 * Layout simplificado para bobina térmica; `largura` = colunas da impressora.
 */
export function montarDanfeNfce(d: DanfeNfceDados, largura = 48): string[] {
  const sep = '-'.repeat(largura)
  const lr = (esq: string, dir: string) => {
    const espaco = Math.max(1, largura - esq.length - dir.length)
    return (esq + ' '.repeat(espaco) + dir).slice(0, largura)
  }
  const linhas: string[] = []
  linhas.push(d.emitenteNome)
  linhas.push(`CNPJ ${d.emitenteCnpj}`)
  linhas.push('Documento Auxiliar da NFC-e')
  linhas.push(sep)
  linhas.push(lr('ITEM', 'VL TOTAL'))
  for (const it of d.itens) {
    const qtd = Number.isInteger(it.quantidade)
      ? String(it.quantidade)
      : it.quantidade.toFixed(3).replace('.', ',')
    linhas.push(it.descricao)
    linhas.push(lr(`  ${qtd} x ${brl(it.valorUnitario)}`, brl(it.total)))
  }
  linhas.push(sep)
  linhas.push(`Qtde. total de itens: ${d.itens.length}`)
  if (d.desconto > 0) linhas.push(lr('Descontos', `- ${brl(d.desconto)}`))
  linhas.push(lr('VALOR TOTAL R$', brl(d.total)))
  for (const p of d.pagamentos) linhas.push(lr(ROTULO_FORMA[p.forma], brl(p.valor)))
  if (d.troco > 0) linhas.push(lr('Troco R$', brl(d.troco)))
  linhas.push(sep)
  linhas.push(
    d.consumidorCpf ? `Consumidor CPF: ${formatCpf(d.consumidorCpf)}` : 'CONSUMIDOR NAO IDENTIFICADO',
  )
  if (d.contingencia) {
    linhas.push('EMITIDA EM CONTINGENCIA')
    linhas.push('Pendente de autorizacao pela SEFAZ')
  }
  linhas.push('Chave de acesso:')
  linhas.push(agruparChave(d.chave))
  linhas.push(lr('Protocolo:', d.protocolo ?? '-'))
  linhas.push(new Date(d.emitidaEm).toLocaleString('pt-BR'))
  linhas.push('Consulte em: www.nfce.fazenda.sp.gov.br/consulta')
  return linhas
}

// DANFE NFC-e com QR Code (RF-26). Recebe dados já estruturados pela lib fiscal.
export async function imprimirDanfe(dados: DanfeNfceDados): Promise<void> {
  const p = await novaImpressora()
  for (const linha of montarDanfeNfce(dados, config!.larguraColunas)) p.println(linha)
  p.alignCenter()
  p.printQR(dados.qrCode, { cellSize: 6, correction: 'M', model: 2 })
  p.alignLeft()
  p.cut()
  await p.execute()
}

/** Pulso de abertura da gaveta via ESC/POS, reutilizando a conexão da impressora. */
export async function pulsoGaveta(): Promise<void> {
  const p = await novaImpressora()
  p.openCashDrawer()
  await p.execute()
}
