import { and, gte, lte, eq, sql, desc } from 'drizzle-orm'
import { getDb } from '../db'
import { vendas, vendaItens, vendaPagamentos, produtos, grupos, usuarios } from '../schema.pg'
import type { RelatorioVendas, LinhaCurvaAbc, ClasseAbc } from '@shared/types'
import type { RelatorioVendasFiltro } from '@shared/ipc'

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

// No Postgres `sum()` sobre integer devolve numeric e `count()` devolve bigint —
// e o driver entrega ambos como STRING para não perder precisão. Sem o cast o
// ticket médio viraria "1234"/3 e os totais concatenariam em vez de somar.
// float8 é exato para inteiros até 2^53, folga enorme para centavos (≠ ::int,
// que estouraria em R$ 21 milhões acumulados).
const somaCentavos = (col: unknown) => sql<number>`coalesce(sum(${col}), 0)::float8`
const contagem = sql<number>`count(*)::int`

export const relatoriosRepo = {
  async vendas(filtro: RelatorioVendasFiltro): Promise<RelatorioVendas> {
    const db = getDb()
    const where = condicoes(filtro)

    const [resumo] = await db
      .select({
        quantidadeVendas: contagem,
        subtotal: somaCentavos(vendas.subtotal),
        desconto: somaCentavos(vendas.desconto),
        total: somaCentavos(vendas.total),
      })
      .from(vendas)
      .where(where)

    const porForma = await db
      .select({
        forma: vendaPagamentos.forma,
        // Líquido: desconta o troco (só existe em dinheiro) p/ bater com o faturamento.
        valor: sql<number>`coalesce(sum(${vendaPagamentos.valor} - ${vendaPagamentos.troco}), 0)::float8`,
        quantidade: contagem,
      })
      .from(vendaPagamentos)
      .innerJoin(vendas, eq(vendaPagamentos.vendaId, vendas.id))
      .where(where)
      .groupBy(vendaPagamentos.forma)

    // Agrupa por usuarios.id (a PK): o Postgres reconhece a dependência funcional
    // e libera usuarios.nome no SELECT sem precisar entrar no GROUP BY.
    const porOperador = await db
      .select({
        usuarioId: usuarios.id,
        nome: usuarios.nome,
        quantidade: contagem,
        total: somaCentavos(vendas.total),
      })
      .from(vendas)
      .innerJoin(usuarios, eq(vendas.usuarioId, usuarios.id))
      .where(where)
      .groupBy(usuarios.id)
      .orderBy(desc(sql`coalesce(sum(${vendas.total}), 0)`))

    // `descricao` é o snapshot gravado no item da venda, não a coluna do produto:
    // se a descrição mudou entre duas vendas, pôr ela no GROUP BY partiria o
    // produto em duas linhas. max() mantém uma linha por produtoId, como no SQLite.
    const porProduto = await db
      .select({
        produtoId: vendaItens.produtoId,
        descricao: sql<string>`max(${vendaItens.descricao})`,
        quantidade: sql<number>`coalesce(sum(${vendaItens.quantidade}), 0)::float8`,
        total: somaCentavos(vendaItens.total),
      })
      .from(vendaItens)
      .innerJoin(vendas, eq(vendaItens.vendaId, vendas.id))
      .where(where)
      .groupBy(vendaItens.produtoId)
      .orderBy(desc(sql`coalesce(sum(${vendaItens.total}), 0)`))

    // grupos.nome é único por grupoId, então incluí-lo no GROUP BY não parte linhas
    // (e produtos sem grupo caem todos no mesmo bucket NULL → 'Sem grupo').
    const porGrupo = await db
      .select({
        grupoId: produtos.grupoId,
        nome: sql<string>`coalesce(${grupos.nome}, 'Sem grupo')`,
        total: somaCentavos(vendaItens.total),
      })
      .from(vendaItens)
      .innerJoin(vendas, eq(vendaItens.vendaId, vendas.id))
      .innerJoin(produtos, eq(vendaItens.produtoId, produtos.id))
      .leftJoin(grupos, eq(produtos.grupoId, grupos.id))
      .where(where)
      .groupBy(produtos.grupoId, grupos.nome)
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
        descricao: sql<string>`max(${vendaItens.descricao})`,
        quantidade: sql<number>`coalesce(sum(${vendaItens.quantidade}), 0)::float8`,
        faturamento: somaCentavos(vendaItens.total),
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
}
