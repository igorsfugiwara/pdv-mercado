import { eq, sql, lte, and, gt } from 'drizzle-orm'
import { getDb } from '../db'
import { produtos, estoqueMovimentos } from '../schema.pg'
import type { Produto } from '@shared/types'

export const estoqueRepo = {
  // RF-17: entrada de mercadoria. (motivo/NF é registrado em auditoria pelo handler)
  async entrada(produtoId: number, quantidade: number, usuarioId: number, _motivo: string) {
    const db = getDb()
    const agora = new Date().toISOString()
    await db.transaction(async (tx) => {
      await tx
        .update(produtos)
        .set({ estoqueAtual: sql`${produtos.estoqueAtual} + ${quantidade}` })
        .where(eq(produtos.id, produtoId))
      await tx
        .insert(estoqueMovimentos)
        .values({ produtoId, tipo: 'entrada', quantidade, usuarioId, criadoEm: agora })
    })
  },

  // RF-17: ajuste de inventário com motivo (registrado em auditoria pelo handler).
  async ajuste(produtoId: number, novoSaldo: number, usuarioId: number) {
    const db = getDb()
    const agora = new Date().toISOString()
    await db.transaction(async (tx) => {
      // Lê dentro da transação: o delta precisa refletir o saldo no momento do ajuste.
      const [p] = await tx.select().from(produtos).where(eq(produtos.id, produtoId))
      if (!p) throw new Error('Produto não encontrado')
      const delta = novoSaldo - p.estoqueAtual
      await tx.update(produtos).set({ estoqueAtual: novoSaldo }).where(eq(produtos.id, produtoId))
      await tx.insert(estoqueMovimentos).values({
        produtoId,
        tipo: 'ajuste_inventario',
        quantidade: delta,
        usuarioId,
        criadoEm: agora,
      })
    })
  },

  // RF-18: alerta de estoque mínimo.
  async alertasMinimo(): Promise<Produto[]> {
    const db = getDb()
    const rows = await db
      .select()
      .from(produtos)
      .where(
        and(
          eq(produtos.ativo, true),
          gt(produtos.estoqueMinimo, 0),
          lte(produtos.estoqueAtual, produtos.estoqueMinimo),
        ),
      )
    return rows as Produto[]
  },
}
