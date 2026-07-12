import log from 'electron-log'

// Balança serial (Toledo Prix 3/4/5, Filizola CS15) — RS-232/USB (RF-03).
// Protocolo selecionável; timeout 2s com fallback manual.
export interface BalancaConfig {
  porta: string // 'COM3' | '/dev/ttyUSB0'
  baudRate: number // 9600 típico
  protocolo: 'toledo' | 'filizola'
}

let config: BalancaConfig | null = null

export function configurarBalanca(cfg: BalancaConfig) {
  config = cfg
}

const TIMEOUT_MS = 2000

/**
 * Solicita e faz parse do peso (em kg). Envia comando de solicitação e aguarda
 * a resposta; timeout de 2s cai em fallback manual (RF-03).
 */
export async function lerPeso(): Promise<{ ok: boolean; peso?: number; erro?: string }> {
  if (!config) return { ok: false, erro: 'Balança não configurada.' }
  try {
    const { SerialPort } = await import('serialport')
    const port = new SerialPort({ path: config.porta, baudRate: config.baudRate, autoOpen: false })

    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          port.close()
        } catch {
          /* noop */
        }
        resolve({ ok: false, erro: 'Timeout (2s) — informe o peso manualmente.' })
      }, TIMEOUT_MS)

      port.open((err) => {
        if (err) {
          clearTimeout(timer)
          return resolve({ ok: false, erro: String(err) })
        }
        // Comando de solicitação de peso (varia por protocolo).
        port.write(config!.protocolo === 'toledo' ? '\x05' : '\x05')
        port.once('data', (buf: Buffer) => {
          clearTimeout(timer)
          const peso = parsePeso(buf, config!.protocolo)
          port.close()
          resolve(peso != null ? { ok: true, peso } : { ok: false, erro: 'Leitura inválida.' })
        })
      })
    })
  } catch (e) {
    log.error('[balanca] erro', e)
    return { ok: false, erro: String(e) }
  }
}

/**
 * Parse do frame de peso das balanças Toledo Prix (3/4/5) e Filizola (CS15).
 *
 * Ambas respondem em ASCII entre STX (0x02) e ETX (0x03), possivelmente com
 * CR/LF e caracteres de status. O peso pode vir:
 *  - com ponto/vírgula decimal explícito (ex.: "1.500" / "1,500" kg), ou
 *  - como inteiro em gramas num campo fixo (ex.: "001500" = 1,500 kg) — comum
 *    na Toledo, que o parser anterior (regex exigindo decimal) não lia.
 *
 * Peso instável (flag 'I'/'i' sem dígitos) ou zero/negativo → null (fallback manual).
 * O layout exato deve ser validado no modelo alvo — ver docs/TESTES_HARDWARE.md.
 */
export function parsePeso(
  buf: Buffer | string,
  _protocolo: BalancaConfig['protocolo'],
): number | null {
  const bruto = typeof buf === 'string' ? buf : buf.toString('ascii')
  // Remove framing (STX/ETX), CR/LF e espaços.
  const texto = bruto.replace(/[\x02\x03\r\n]/g, '').trim()
  if (!texto) return null
  // Sinal negativo ou instabilidade explícita → leitura inválida.
  if (texto.includes('-')) return null
  if (/^[iI]/.test(texto)) return null

  // 1) Formato com decimal explícito.
  const decimal = texto.match(/(\d+[.,]\d{1,3})/)
  if (decimal) {
    const kg = parseFloat(decimal[1].replace(',', '.'))
    return kg > 0 ? Number(kg.toFixed(3)) : null
  }
  // 2) Formato inteiro em gramas (campo de 4 a 6 dígitos).
  const gramas = texto.match(/(\d{4,6})/)
  if (gramas) {
    const kg = parseInt(gramas[1], 10) / 1000
    return kg > 0 ? kg : null
  }
  return null
}

/**
 * EAN-13 de balança (prefixo 2): layouts código+peso e código+valor (RF-03).
 * Retorna o código do produto e peso (kg) ou valor (centavos), conforme layout.
 */
export function parseEanBalanca(
  ean: string,
  layout: 'peso' | 'valor',
): { codigoProduto: string; peso?: number; valor?: number } | null {
  if (ean.length !== 13 || ean[0] !== '2') return null
  const codigoProduto = ean.slice(1, 6)
  const dados = ean.slice(6, 12) // 6 dígitos de peso/valor + DV na posição 12
  if (layout === 'peso') {
    return { codigoProduto, peso: parseInt(dados, 10) / 1000 } // gramas → kg
  }
  return { codigoProduto, valor: parseInt(dados, 10) } // centavos
}
