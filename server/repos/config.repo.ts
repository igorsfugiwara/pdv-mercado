import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { configuracoes } from '../schema.pg'

export const configRepo = {
  async obter(chave: string): Promise<string | null> {
    const db = getDb()
    const [row] = await db.select().from(configuracoes).where(eq(configuracoes.chave, chave))
    return row?.valor ?? null
  },

  async definir(chave: string, valor: string) {
    const db = getDb()
    await db
      .insert(configuracoes)
      .values({ chave, valor })
      .onConflictDoUpdate({ target: configuracoes.chave, set: { valor } })
  },

  async todas(): Promise<Record<string, string>> {
    const db = getDb()
    const rows = await db.select().from(configuracoes)
    return Object.fromEntries(rows.map((r) => [r.chave, r.valor]))
  },
}
