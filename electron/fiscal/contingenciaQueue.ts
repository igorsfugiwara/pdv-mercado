import log from 'electron-log'
import type { FiscalProvider } from './FiscalProvider'
import { fiscalRepo } from '../db/repositories/fiscal.repo'

/**
 * Fila de contingência (RF-27): documentos emitidos offline (tpEmis=9) ficam
 * com status 'contingencia_pendente'. Job de retransmissão a cada 2 min com
 * backoff exponencial; após 24h sem sucesso, alerta no monitor fiscal.
 */
const INTERVALO_BASE_MS = 2 * 60 * 1000
const MAX_BACKOFF_MS = 30 * 60 * 1000
const LIMITE_ALERTA_MS = 24 * 60 * 60 * 1000

export class ContingenciaQueue {
  private timer: NodeJS.Timeout | null = null
  private tentativas = 0
  private processando = false

  constructor(
    private readonly provider: FiscalProvider,
    private readonly onAlerta?: (msg: string) => void,
  ) {}

  iniciar() {
    if (this.timer) return
    this.agendar(INTERVALO_BASE_MS)
    log.info('[contingencia] fila iniciada')
  }

  parar() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private agendar(ms: number) {
    this.timer = setTimeout(() => void this.tick(), ms)
  }

  /** Reprocessa manualmente (botão do monitor fiscal). */
  async reprocessar(): Promise<{ processados: number }> {
    return { processados: await this.tick(true) }
  }

  private async tick(manual = false): Promise<number> {
    if (this.processando) return 0
    this.processando = true
    let processados = 0
    try {
      const pendentes = await fiscalRepo.listar('contingencia_pendente')
      for (const doc of pendentes) {
        // conciliação de protocolo: reenvia o XML já assinado da contingência.
        try {
          const status = await this.provider.statusServico()
          if (!status.online) break // SEFAZ ainda offline — mantém na fila
          // TODO Fase 3: chamar consulta/transmissão do XML de contingência via provider.
          // Ao autorizar: fiscalRepo.atualizarStatus(doc.id, { status: 'autorizada', ... })
          this.verificarPrazoAlerta(doc.emitidaEm)
          processados++
        } catch (e) {
          log.error('[contingencia] falha ao reprocessar doc', doc.id, e)
        }
      }
      this.tentativas = processados > 0 ? 0 : this.tentativas + 1
    } finally {
      this.processando = false
      if (!manual) {
        const backoff = Math.min(INTERVALO_BASE_MS * 2 ** this.tentativas, MAX_BACKOFF_MS)
        this.agendar(backoff)
      }
    }
    return processados
  }

  private verificarPrazoAlerta(emitidaEm: string | null) {
    if (!emitidaEm) return
    const idadeMs = Date.now() - new Date(emitidaEm).getTime()
    if (idadeMs > LIMITE_ALERTA_MS) {
      this.onAlerta?.('Documento em contingência há mais de 24h sem autorização.')
    }
  }
}
