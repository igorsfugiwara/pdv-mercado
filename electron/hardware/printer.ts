import log from 'electron-log'

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

// DANFE NFC-e com QR Code (RF-26). Recebe o XML/dados já formatados pela lib fiscal.
export async function imprimirDanfe(_texto: string, _qrCode: string): Promise<void> {
  const p = await novaImpressora()
  // TODO Fase 3: layout DANFE NFC-e conforme leiaute vigente + p.printQR(qrCode).
  await p.execute()
}
