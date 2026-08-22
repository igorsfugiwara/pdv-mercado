import { eq, and, desc, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { caixas, movimentosCaixa, vendas, vendaPagamentos } from '../schema.pg'
import type { Caixa, MovimentoCaixa } from '@shared/types'

export const caixaRepo = {
  async atual(): Promise<Caixa | null> {
    const db = getDb()
    const [row] = await db
      .select()
      .from(caixas)
      .where(eq(caixas.status, 'aberto'))
      .orderBy(desc(caixas.abertoEm))
      .limit(1)
    return (row as Caixa) ?? null
  },

  // RF-11: abertura com fundo de troco.
  async abrir(usuarioId: number, valorAbertura: number): Promise<Caixa> {
    const db = getDb()
    const agora = new Date().toISOString()
    return db.transaction(async (tx) => {
      const [caixa] = await tx
        .insert(caixas)
        .values({ usuarioAberturaId: usuarioId, valorAbertura, abertoEm: agora, status: 'aberto' })
        .returning()
      await tx.insert(movimentosCaixa).values({
        caixaId: caixa.id,
        tipo: 'abertura',
        valor: valorAbertura,
        usuarioId,
        criadoEm: agora,
      })
      return caixa as Caixa
    })
  },

  // RF-11: fechamento com conferência cega; retorna diferença.
  async fechar(caixaId: number, usuarioId: number, valorContado: number) {
    const db = getDb()
    const agora = new Date().toISOString()
    const esperado = await this.saldoEsperado(caixaId)
    await db
      .update(caixas)
      .set({ status: 'fechado', usuarioFechamentoId: usuarioId, fechadoEm: agora })
      .where(eq(caixas.id, caixaId))
    await db.insert(movimentosCaixa).values({
      caixaId,
      tipo: 'fechamento',
      valor: valorContado,
      motivo: `esperado=${esperado} contado=${valorContado}`,
      usuarioId,
      criadoEm: agora,
    })
    return { diferenca: valorContado - esperado }
  },

  async movimentar(
    caixaId: number,
    tipo: 'sangria' | 'suprimento',
    valor: number,
    motivo: string,
    usuarioId: number,
    autorizadoPorId: number,
  ): Promise<MovimentoCaixa> {
    if (!Number.isInteger(valor) || valor <= 0) {
      throw new Error('Valor de sangria/suprimento deve ser positivo.')
    }
    const db = getDb()
    const [row] = await db
      .insert(movimentosCaixa)
      .values({
        caixaId,
        tipo,
        valor,
        motivo,
        usuarioId,
        autorizadoPorId,
        criadoEm: new Date().toISOString(),
      })
      .returning()
    return row as MovimentoCaixa
  },

  /** Saldo esperado em dinheiro = abertura + suprimentos - sangrias + vendas em dinheiro - troco. */
  async saldoEsperado(caixaId: number): Promise<number> {
    const db = getDb()
    const movs = await db
      .select()
      .from(movimentosCaixa)
      .where(eq(movimentosCaixa.caixaId, caixaId))
    let saldo = 0
    for (const m of movs) {
      if (m.tipo === 'abertura' || m.tipo === 'suprimento') saldo += m.valor
      else if (m.tipo === 'sangria') saldo -= m.valor
      // 'fechamento' não altera o esperado.
    }

    // Vendas em dinheiro do caixa (valor recebido - troco).
    const [dinheiro] = await db
      .select({
        recebido: sql<number>`coalesce(sum(${vendaPagamentos.valor}), 0)::float8`,
        troco: sql<number>`coalesce(sum(${vendaPagamentos.troco}), 0)::float8`,
      })
      .from(vendaPagamentos)
      .innerJoin(vendas, eq(vendaPagamentos.vendaId, vendas.id))
      .where(
        and(
          eq(vendas.caixaId, caixaId),
          eq(vendas.status, 'finalizada'),
          eq(vendaPagamentos.forma, 'dinheiro'),
        ),
      )

    return saldo + (dinheiro?.recebido ?? 0) - (dinheiro?.troco ?? 0)
  },
}
