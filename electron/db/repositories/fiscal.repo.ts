import { eq, desc } from 'drizzle-orm'
import { getDb } from '../index'
import { documentosFiscais } from '../schema'
import type { DocumentoFiscal, StatusDocumentoFiscal } from '@shared/types'

export const fiscalRepo = {
  async listar(status?: StatusDocumentoFiscal): Promise<DocumentoFiscal[]> {
    const db = getDb()
    const q = db.select().from(documentosFiscais).orderBy(desc(documentosFiscais.id))
    const rows = status
      ? await db
          .select()
          .from(documentosFiscais)
          .where(eq(documentosFiscais.status, status))
          .orderBy(desc(documentosFiscais.id))
      : await q
    return rows as DocumentoFiscal[]
  },

  async atualizarStatus(
    id: number,
    patch: Partial<
      Pick<
        DocumentoFiscal,
        | 'status'
        | 'chaveAcesso'
        | 'protocolo'
        | 'xmlPath'
        | 'motivoRejeicao'
        | 'autorizadaEm'
        | 'canceladaEm'
        | 'ultimoErro'
        | 'ultimaTentativaEm'
        | 'tentativas'
      >
    >,
  ) {
    const db = getDb()
    await db.update(documentosFiscais).set(patch).where(eq(documentosFiscais.id, id))
  },

  async porChave(chave: string): Promise<DocumentoFiscal | null> {
    const db = getDb()
    const [row] = await db
      .select()
      .from(documentosFiscais)
      .where(eq(documentosFiscais.chaveAcesso, chave))
    return (row as DocumentoFiscal) ?? null
  },
}
