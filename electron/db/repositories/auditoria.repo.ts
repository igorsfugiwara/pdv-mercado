import { desc } from 'drizzle-orm'
import { getDb } from '../index'
import { auditoria } from '../schema'

// RF-21: auditoria imutável (apenas append). Nunca update/delete.
export const auditoriaRepo = {
  registrar(usuarioId: number | null, acao: string, detalhe?: Record<string, unknown>) {
    const db = getDb()
    return db.insert(auditoria).values({
      usuarioId,
      acao,
      detalheJson: detalhe ? JSON.stringify(detalhe) : null,
      criadoEm: new Date().toISOString(),
    })
  },

  async listar(limite = 200) {
    const db = getDb()
    return db.select().from(auditoria).orderBy(desc(auditoria.criadoEm)).limit(limite)
  },
}
