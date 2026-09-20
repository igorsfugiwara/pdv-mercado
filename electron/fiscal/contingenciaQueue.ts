import log from 'electron-log'
import type { DocumentoFiscal } from '@shared/types'
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
  private avisouTeto = false
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
        try {
          const status = await this.provider.statusServico()
          if (!status.online) break // SEFAZ ainda offline — mantém a fila intacta

          // Reenvia o XML já assinado da contingência (tpEmis=9) p/ conciliação de protocolo.
          const r = await this.provider.retransmitir(doc)
          if (r.status === 'autorizada') {
            await fiscalRepo.atualizarStatus(doc.id, {
              status: 'autorizada',
              chaveAcesso: r.chave,
              protocolo: r.protocolo,
              autorizadaEm: new Date().toISOString(),
              // Deu certo: o diagnóstico da falha anterior deixa de valer.
              ultimoErro: null,
            })
            processados++
          } else if (r.status === 'rejeitada') {
            await fiscalRepo.atualizarStatus(doc.id, {
              status: 'rejeitada',
              motivoRejeicao: `${r.codigo}: ${r.motivo}`,
            })
            processados++
          } else {
            // Ainda em contingência: mantém pendente, registra por quê e checa
            // o prazo. Sem o motivo gravado, o operador vê "N pendentes" e não
            // sabe se espera a SEFAZ voltar ou se precisa agir.
            await this.registrarFalha(doc, 'SEFAZ ainda não autorizou o documento.')
            this.verificarPrazoAlerta(doc.emitidaEm)
          }
        } catch (e) {
          log.error('[contingencia] falha ao reprocessar doc', doc.id, e)
          await this.registrarFalha(doc, e instanceof Error ? e.message : String(e))
        }
      }
      this.tentativas = processados > 0 ? 0 : this.tentativas + 1
    } finally {
      this.processando = false
      if (!manual) {
        const backoff = Math.min(INTERVALO_BASE_MS * 2 ** this.tentativas, MAX_BACKOFF_MS)
        // Ao chegar no teto, a fila continuava tentando em silêncio. Avisa uma
        // vez: ficar quieto é o que faz documento envelhecer sem ninguém ver.
        if (backoff >= MAX_BACKOFF_MS && !this.avisouTeto) {
          this.avisouTeto = true
          this.onAlerta?.(
            'A fila de contingência não consegue transmitir há bastante tempo. Verifique a conexão e o monitor fiscal.',
          )
        }
        if (backoff < MAX_BACKOFF_MS) this.avisouTeto = false
        this.agendar(backoff)
      }
    }
    return processados
  }

  /** Guarda a última falha no próprio documento, não só no log do main. */
  private async registrarFalha(doc: DocumentoFiscal, motivo: string) {
    try {
      await fiscalRepo.atualizarStatus(doc.id, {
        ultimoErro: motivo,
        ultimaTentativaEm: new Date().toISOString(),
        tentativas: (doc.tentativas ?? 0) + 1,
      })
    } catch (e) {
      // Registrar diagnóstico nunca pode derrubar a fila.
      log.error('[contingencia] falha ao registrar diagnóstico', e)
    }
  }

  private verificarPrazoAlerta(emitidaEm: string | null) {
    if (!emitidaEm) return
    const idadeMs = Date.now() - new Date(emitidaEm).getTime()
    if (idadeMs > LIMITE_ALERTA_MS) {
      this.onAlerta?.('Documento em contingência há mais de 24h sem autorização.')
    }
  }
}
