import { eq, and } from 'drizzle-orm'
import { getDb } from '../db'
import { usuarios } from '../schema.pg'
import { verificar } from '../auth'
import type { Usuario } from '@shared/types'

function toUsuario(row: typeof usuarios.$inferSelect): Usuario {
  const { senhaHash: _s, pinHash: _p, ...rest } = row
  return rest as Usuario
}

export const usuariosRepo = {
  async porLogin(login: string, senha: string): Promise<Usuario | null> {
    const db = getDb()
    const [row] = await db
      .select()
      .from(usuarios)
      .where(and(eq(usuarios.login, login), eq(usuarios.ativo, true)))
    if (!row) return null
    const ok = await verificar(row.senhaHash, senha)
    return ok ? toUsuario(row) : null
  },

  /** Troca rápida de operador / autorização de supervisor por PIN (RF-05/06/20). */
  async porPin(pin: string, perfilMinimo?: Array<Usuario['perfil']>): Promise<Usuario | null> {
    const db = getDb()
    const rows = await db.select().from(usuarios).where(eq(usuarios.ativo, true))
    for (const row of rows) {
      if (perfilMinimo && !perfilMinimo.includes(row.perfil)) continue
      if (await verificar(row.pinHash, pin)) return toUsuario(row)
    }
    return null
  },

  async porId(id: number): Promise<Usuario | null> {
    const db = getDb()
    const [row] = await db.select().from(usuarios).where(eq(usuarios.id, id))
    return row ? toUsuario(row) : null
  },
}
