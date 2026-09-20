import { eq, desc } from 'drizzle-orm'
import { getDb } from '../db'
import { documentosFiscais } from '../schema.pg'
import type { DocumentoFiscal, StatusDocumentoFiscal } from '@shared/types'

export const fiscalRepo = {
  async listar(status?: StatusDocumentoFiscal): Promise<DocumentoFiscal[]> {
    const db = getDb()
    const rows = status
      ? await db
          .select()
          .from(documentosFiscais)
          .where(eq(documentosFiscais.status, status))
          .orderBy(desc(documentosFiscais.id))
      : await db.select().from(documentosFiscais).orderBy(desc(documentosFiscais.id))
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

  async porId(id: number): Promise<DocumentoFiscal | null> {
    const db = getDb()
    const [row] = await db.select().from(documentosFiscais).where(eq(documentosFiscais.id, id))
    return (row as DocumentoFiscal) ?? null
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
