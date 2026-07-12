import log from 'electron-log'
import { pulsoGaveta } from './printer'

// Gaveta de dinheiro: abre por pulso ESC/POS via impressora (kick).
// Aciona em venda paga em dinheiro e em sangria.
export async function abrirGaveta(): Promise<{ ok: boolean; detalhe: string }> {
  try {
    await pulsoGaveta()
    log.info('[gaveta] pulso de abertura enviado')
    return { ok: true, detalhe: 'Comando de abertura enviado.' }
  } catch (e) {
    log.error('[gaveta] falha ao abrir', e)
    return { ok: false, detalhe: String(e) }
  }
}
