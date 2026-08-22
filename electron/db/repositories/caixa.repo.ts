import { eq, and, desc, sql, ne } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { getDb } from '../index'
import {
  caixas,
  movimentosCaixa,
  vendas,
  vendaPagamentos,
  vendasEspera,
  usuarios,
  documentosFiscais,
} from '../schema'
import { RASCUNHO_ID } from '@shared/types'
import type {
  Caixa,
  MovimentoCaixa,
  LinhaComposicao,
  ResumoPreFechamento,
  RelatorioFechamento,
} from '@shared/types'

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

  async porId(caixaId: number): Promise<Caixa | null> {
    const db = getDb()
    const [row] = await db.select().from(caixas).where(eq(caixas.id, caixaId))
    return (row as Caixa) ?? null
  },

  // RF-11: abertura com fundo de troco.
  abrir(usuarioId: number, valorAbertura: number): Caixa {
    const db = getDb()
    const agora = new Date().toISOString()
    return db.transaction((tx) => {
      const [caixa] = tx
        .insert(caixas)
        .values({ usuarioAberturaId: usuarioId, valorAbertura, abertoEm: agora, status: 'aberto' })
        .returning()
        .all()
      tx.insert(movimentosCaixa)
        .values({
          caixaId: caixa.id,
          tipo: 'abertura',
          valor: valorAbertura,
          usuarioId,
          criadoEm: agora,
        })
        .run()
      return caixa as Caixa
    })
  },

  /**
   * RF-11: fechamento com conferência cega. `valorContado` é o que o operador
   * contou na gaveta; `motivo` só vem quando a diferença passou do limite.
   * A validação de limite e de bloqueio é do handler — aqui só persiste.
   */
  async fechar(
    caixaId: number,
    usuarioId: number,
    valorContado: number,
    motivo: string | null = null,
    autorizadoPorId: number | null = null,
  ) {
    const db = getDb()
    const agora = new Date().toISOString()
    const esperado = await this.saldoEsperado(caixaId)
    await db
      .update(caixas)
      .set({ status: 'fechado', usuarioFechamentoId: usuarioId, fechadoEm: agora })
      .where(eq(caixas.id, caixaId))
    // `valor` guarda o contado e `motivo` a justificativa do operador. O esperado
    // NÃO é gravado aqui de propósito: o relatório o recalcula a partir dos
    // movimentos e das vendas, em vez de depender de um texto persistido.
    await db.insert(movimentosCaixa).values({
      caixaId,
      tipo: 'fechamento',
      valor: valorContado,
      motivo,
      usuarioId,
      autorizadoPorId,
      criadoEm: agora,
    })
    return { diferenca: valorContado - esperado, esperado }
  },

  movimentar(
    caixaId: number,
    tipo: 'sangria' | 'suprimento',
    valor: number,
    motivo: string,
    usuarioId: number,
    autorizadoPorId: number,
  ): MovimentoCaixa {
    if (!Number.isInteger(valor) || valor <= 0) {
      throw new Error('Valor de sangria/suprimento deve ser positivo.')
    }
    const db = getDb()
    const [row] = db
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
      .all()
    return row as MovimentoCaixa
  },

  /**
   * Composição do saldo esperado em gaveta, linha a linha — "esperado R$ 843,20"
   * sem decomposição não ajuda ninguém a achar de onde veio a diferença.
   * Só dinheiro entra: cartão, PIX e voucher não são conferíveis em gaveta.
   */
  async composicaoEsperado(caixaId: number): Promise<{ linhas: LinhaComposicao[]; total: number }> {
    const db = getDb()
    const movs = await db
      .select()
      .from(movimentosCaixa)
      .where(eq(movimentosCaixa.caixaId, caixaId))

    let abertura = 0
    let suprimentos = 0
    let sangrias = 0
    for (const m of movs) {
      if (m.tipo === 'abertura') abertura += m.valor
      else if (m.tipo === 'suprimento') suprimentos += m.valor
      else if (m.tipo === 'sangria') sangrias += m.valor
      // 'fechamento' não altera o esperado — é o contado, não uma movimentação.
    }

    const [dinheiro] = await db
      .select({
        recebido: sql<number>`coalesce(sum(${vendaPagamentos.valor}), 0)`,
        troco: sql<number>`coalesce(sum(${vendaPagamentos.troco}), 0)`,
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

    const recebido = dinheiro?.recebido ?? 0
    const troco = dinheiro?.troco ?? 0

    const linhas: LinhaComposicao[] = [
      { rotulo: 'Fundo de troco (abertura)', valor: abertura },
      { rotulo: 'Suprimentos', valor: suprimentos },
      { rotulo: 'Sangrias', valor: -sangrias },
      { rotulo: 'Vendas em dinheiro', valor: recebido },
      { rotulo: 'Troco devolvido', valor: -troco },
    ]
    return { linhas, total: linhas.reduce((a, l) => a + l.valor, 0) }
  },

  /** Saldo esperado em dinheiro. Mesma fonte da composição, sem duplicar a regra. */
  async saldoEsperado(caixaId: number): Promise<number> {
    return (await this.composicaoEsperado(caixaId)).total
  },

  /**
   * Impedimentos de fechamento (RF-11). Fechar por cima de venda em espera
   * perde o carrinho de um cliente que ainda está na loja.
   */
  async bloqueiosFechamento(caixaId: number, usuarioId: number): Promise<string[]> {
    const db = getDb()
    const bloqueios: string[] = []

    const caixa = await this.porId(caixaId)
    if (!caixa) return ['Caixa não encontrado.']
    if (caixa.status === 'fechado') return ['Este caixa já está fechado.']

    const [operador] = await db.select().from(usuarios).where(eq(usuarios.id, usuarioId))
    if (!operador) return ['Operador não encontrado.']
    if (operador.perfil === 'operador' && caixa.usuarioAberturaId !== usuarioId) {
      bloqueios.push('Operador só pode fechar o próprio caixa. Peça a um supervisor.')
    }

    const espera = await db.select().from(vendasEspera).where(ne(vendasEspera.id, RASCUNHO_ID))
    if (espera.length > 0) {
      bloqueios.push(
        `${espera.length} venda(s) em espera. Retome e finalize ou cancele antes de fechar.`,
      )
    }

    const [rascunho] = await db
      .select()
      .from(vendasEspera)
      .where(eq(vendasEspera.id, RASCUNHO_ID))
    if (rascunho) {
      bloqueios.push('Há uma venda em andamento não finalizada. Conclua ou cancele antes de fechar.')
    }

    return bloqueios
  },

  /** Etapa cega: tudo que o operador pode ver ANTES de informar o contado. */
  async resumoPreFechamento(caixaId: number, usuarioId: number): Promise<ResumoPreFechamento> {
    const db = getDb()
    const caixa = await this.porId(caixaId)
    if (!caixa) throw new Error('Caixa não encontrado.')

    const [abertura] = await db
      .select({ nome: usuarios.nome })
      .from(usuarios)
      .where(eq(usuarios.id, caixa.usuarioAberturaId))

    const [contagem] = await db
      .select({ n: sql<number>`count(*)` })
      .from(vendas)
      .where(and(eq(vendas.caixaId, caixaId), eq(vendas.status, 'finalizada')))

    const espera = await db.select().from(vendasEspera).where(ne(vendasEspera.id, RASCUNHO_ID))
    const [rascunho] = await db
      .select()
      .from(vendasEspera)
      .where(eq(vendasEspera.id, RASCUNHO_ID))

    return {
      caixaId,
      abertoEm: caixa.abertoEm,
      operadorAbertura: abertura?.nome ?? '—',
      quantidadeVendas: contagem?.n ?? 0,
      vendasEmEspera: espera.length,
      temRascunho: !!rascunho,
      bloqueios: await this.bloqueiosFechamento(caixaId, usuarioId),
    }
  },

  /** RF-13: relatório do turno. Exige caixa já fechado. */
  async relatorioFechamento(caixaId: number): Promise<RelatorioFechamento> {
    const db = getDb()
    const caixa = await this.porId(caixaId)
    if (!caixa) throw new Error('Caixa não encontrado.')

    const operador = alias(usuarios, 'operador')
    const autorizador = alias(usuarios, 'autorizador')

    const [aberturaUser] = await db
      .select({ nome: usuarios.nome })
      .from(usuarios)
      .where(eq(usuarios.id, caixa.usuarioAberturaId))

    const fechamentoUser = caixa.usuarioFechamentoId
      ? (
          await db
            .select({ nome: usuarios.nome })
            .from(usuarios)
            .where(eq(usuarios.id, caixa.usuarioFechamentoId))
        )[0]
      : undefined

    const [resumo] = await db
      .select({
        quantidade: sql<number>`count(*)`,
        total: sql<number>`coalesce(sum(${vendas.total}), 0)`,
      })
      .from(vendas)
      .where(and(eq(vendas.caixaId, caixaId), eq(vendas.status, 'finalizada')))

    const porForma = await db
      .select({
        forma: vendaPagamentos.forma,
        quantidade: sql<number>`count(*)`,
        valor: sql<number>`coalesce(sum(${vendaPagamentos.valor} - ${vendaPagamentos.troco}), 0)`,
      })
      .from(vendaPagamentos)
      .innerJoin(vendas, eq(vendaPagamentos.vendaId, vendas.id))
      .where(and(eq(vendas.caixaId, caixaId), eq(vendas.status, 'finalizada')))
      .groupBy(vendaPagamentos.forma)

    const movimentosRaw = await db
      .select({
        tipo: movimentosCaixa.tipo,
        valor: movimentosCaixa.valor,
        motivo: movimentosCaixa.motivo,
        operador: operador.nome,
        autorizadoPor: autorizador.nome,
        criadoEm: movimentosCaixa.criadoEm,
      })
      .from(movimentosCaixa)
      .innerJoin(operador, eq(movimentosCaixa.usuarioId, operador.id))
      .leftJoin(autorizador, eq(movimentosCaixa.autorizadoPorId, autorizador.id))
      .where(eq(movimentosCaixa.caixaId, caixaId))
      .orderBy(movimentosCaixa.criadoEm)

    const documentos = await db
      .select({
        status: documentosFiscais.status,
        quantidade: sql<number>`count(*)`,
      })
      .from(documentosFiscais)
      .innerJoin(vendas, eq(documentosFiscais.vendaId, vendas.id))
      .where(eq(vendas.caixaId, caixaId))
      .groupBy(documentosFiscais.status)

    const { linhas, total: esperado } = await this.composicaoEsperado(caixaId)
    const fechamento = movimentosRaw.find((m) => m.tipo === 'fechamento')
    const contado = fechamento?.valor ?? 0

    return {
      caixaId,
      loja: 'PDV Mercado',
      operadorAbertura: aberturaUser?.nome ?? '—',
      operadorFechamento: fechamentoUser?.nome ?? null,
      abertoEm: caixa.abertoEm,
      fechadoEm: caixa.fechadoEm,
      vendas: { quantidade: resumo?.quantidade ?? 0, total: resumo?.total ?? 0 },
      porForma,
      movimentos: movimentosRaw,
      conferencia: {
        composicao: linhas,
        esperado,
        contado,
        diferenca: contado - esperado,
        motivo: fechamento?.motivo ?? null,
      },
      documentos,
    }
  },
}
