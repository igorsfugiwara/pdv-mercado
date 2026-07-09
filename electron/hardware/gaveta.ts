import log from 'electron-log'

// Gaveta de dinheiro: abre por pulso ESC/POS via impressora (kick).
// Aciona em venda paga em dinheiro e em sangria.
export async function abrirGaveta(): Promise<{ ok: boolean; detalhe: string }> {
  try {
    // TODO Fase 2: reutilizar conexão da impressora e enviar p.openCashDrawer().
    log.info('[gaveta] pulso de abertura solicitado (stub)')
    return { ok: true, detalhe: 'Comando de abertura enviado.' }
  } catch (e) {
    return { ok: false, detalhe: String(e) }
  }
}
