import { and, gte, lte, eq, sql, desc } from 'drizzle-orm'
import { getDb } from '../index'
import { vendas, vendaItens, vendaPagamentos, produtos, grupos, usuarios } from '../schema'
import type {
  RelatorioVendas,
  LinhaCurvaAbc,
  ClasseAbc,
  MediaDiariaProduto,
} from '@shared/types'
import type { RelatorioVendasFiltro } from '@shared/ipc'
import { diasNoPeriodo } from '@shared/periodo'

// Constrói a cláusula de período/operador reutilizada por todas as agregações.
// `ate` é estendido para o fim do dia (criado_em é ISO-8601, comparação lexicográfica).
function condicoes(filtro: RelatorioVendasFiltro) {
  const conds = [
    eq(vendas.status, 'finalizada'),
    gte(vendas.criadoEm, filtro.de),
    lte(vendas.criadoEm, `${filtro.ate}T23:59:59.999`),
  ]
  if (filtro.usuarioId) conds.push(eq(vendas.usuarioId, filtro.usuarioId))
  return and(...conds)
}




export const relatoriosRepo = {
  async vendas(filtro: RelatorioVendasFiltro): Promise<RelatorioVendas> {
    const db = getDb()
    const where = condicoes(filtro)

    const [resumo] = await db
      .select({
        quantidadeVendas: sql<number>`count(*)`,
        subtotal: sql<number>`coalesce(sum(${vendas.subtotal}), 0)`,
        desconto: sql<number>`coalesce(sum(${vendas.desconto}), 0)`,
        total: sql<number>`coalesce(sum(${vendas.total}), 0)`,
      })
      .from(vendas)
      .where(where)

    const porForma = await db
      .select({
        forma: vendaPagamentos.forma,
        // Líquido: desconta o troco (só existe em dinheiro) p/ bater com o faturamento.
        valor: sql<number>`coalesce(sum(${vendaPagamentos.valor} - ${vendaPagamentos.troco}), 0)`,
        quantidade: sql<number>`count(*)`,
      })
      .from(vendaPagamentos)
      .innerJoin(vendas, eq(vendaPagamentos.vendaId, vendas.id))
      .where(where)
      .groupBy(vendaPagamentos.forma)

    const porOperador = await db
      .select({
        usuarioId: vendas.usuarioId,
        nome: usuarios.nome,
        quantidade: sql<number>`count(*)`,
        total: sql<number>`coalesce(sum(${vendas.total}), 0)`,
      })
      .from(vendas)
      .innerJoin(usuarios, eq(vendas.usuarioId, usuarios.id))
      .where(where)
      .groupBy(vendas.usuarioId)
      .orderBy(desc(sql`coalesce(sum(${vendas.total}), 0)`))

    const porProduto = await db
      .select({
        produtoId: vendaItens.produtoId,
        descricao: vendaItens.descricao,
        quantidade: sql<number>`coalesce(sum(${vendaItens.quantidade}), 0)`,
        total: sql<number>`coalesce(sum(${vendaItens.total}), 0)`,
      })
      .from(vendaItens)
      .innerJoin(vendas, eq(vendaItens.vendaId, vendas.id))
      .where(where)
      .groupBy(vendaItens.produtoId)
      .orderBy(desc(sql`coalesce(sum(${vendaItens.total}), 0)`))

    const porGrupo = await db
      .select({
        grupoId: produtos.grupoId,
        nome: sql<string>`coalesce(${grupos.nome}, 'Sem grupo')`,
        total: sql<number>`coalesce(sum(${vendaItens.total}), 0)`,
      })
      .from(vendaItens)
      .innerJoin(vendas, eq(vendaItens.vendaId, vendas.id))
      .innerJoin(produtos, eq(vendaItens.produtoId, produtos.id))
      .leftJoin(grupos, eq(produtos.grupoId, grupos.id))
      .where(where)
      .groupBy(produtos.grupoId)
      .orderBy(desc(sql`coalesce(sum(${vendaItens.total}), 0)`))

    const ticketMedio =
      resumo.quantidadeVendas > 0 ? Math.round(resumo.total / resumo.quantidadeVendas) : 0

    return {
      resumo: { ...resumo, ticketMedio },
      porForma,
      porOperador,
      porProduto,
      porGrupo,
    }
  },

  // RF-23: Curva ABC por faturamento (A=80%, B=95%, C=resto do acumulado).
  async curvaAbc(de: string, ate: string): Promise<LinhaCurvaAbc[]> {
    const db = getDb()
    const where = condicoes({ de, ate })

    const linhas = await db
      .select({
        produtoId: vendaItens.produtoId,
        descricao: vendaItens.descricao,
        quantidade: sql<number>`coalesce(sum(${vendaItens.quantidade}), 0)`,
        faturamento: sql<number>`coalesce(sum(${vendaItens.total}), 0)`,
      })
      .from(vendaItens)
      .innerJoin(vendas, eq(vendaItens.vendaId, vendas.id))
      .where(where)
      .groupBy(vendaItens.produtoId)
      .orderBy(desc(sql`coalesce(sum(${vendaItens.total}), 0)`))

    const totalGeral = linhas.reduce((a, l) => a + l.faturamento, 0)
    let acumulado = 0
    return linhas.map((l) => {
      const percentual = totalGeral > 0 ? (l.faturamento / totalGeral) * 100 : 0
      // Classe pelo acumulado ANTES deste item: garante que o 1º item (mesmo
      // dominante, >80%) seja sempre A, e que o item que cruza a faixa entre nela.
      const classe: ClasseAbc = acumulado < 80 ? 'A' : acumulado < 95 ? 'B' : 'C'
      acumulado += percentual
      return { ...l, percentual, percentualAcumulado: acumulado, classe }
    })
  },
  /**
   * Média de venda diária por produto no período (RF-18).
   *
   * Serve ao painel para dizer **quantos dias de estoque restam**. "Arroz: 8
   * unidades" não diz nada; "Arroz: 8 unidades, ~2 dias" diz quando comprar.
   *
   * Produto sem venda no período simplesmente não aparece na lista — quem
   * consome trata como "sem histórico" em vez de dividir por zero.
   *
   * Devolve array, não Map: o alvo web serializa em JSON, e Map viraria `{}`.
   */
  async mediaDiariaPorProduto(de: string, ate: string): Promise<MediaDiariaProduto[]> {
    const db = getDb()
    const dias = diasNoPeriodo(de, ate)

    const linhas = await db
      .select({
        produtoId: vendaItens.produtoId,
        quantidade: sql<number>`coalesce(sum(${vendaItens.quantidade}), 0)`,
      })
      .from(vendaItens)
      .innerJoin(vendas, eq(vendaItens.vendaId, vendas.id))
      .where(condicoes({ de, ate }))
      .groupBy(vendaItens.produtoId)

    return linhas
      .filter((l) => l.quantidade > 0)
      .map((l) => ({ produtoId: l.produtoId, mediaDiaria: l.quantidade / dias }))
  },
}
