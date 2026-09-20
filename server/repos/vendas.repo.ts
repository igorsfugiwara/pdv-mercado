import { eq, sql, and, gte, lte, desc, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import {
  vendas,
  vendaItens,
  vendaPagamentos,
  documentosFiscais,
  estoqueMovimentos,
  produtos,
  contadoresFiscais,
  usuarios,
} from '../schema.pg'
import type {
  Venda,
  DocumentoFiscal,
  FinalizarVendaInput,
  VendaResumo,
  FiltroVendas,
  StatusVenda,
  StatusDocumentoFiscal,
  FormaPagamento,
} from '@shared/types'
import { validarFinalizacao } from '@shared/vendaValidacao'

const SERIE_PADRAO = 1

/**
 * Invariante 1: finalização de venda é UMA transação única
 * (vendas + venda_itens + venda_pagamentos + estoque_movimentos + documentos_fiscais).
 * A emissão fiscal ocorre DEPOIS, fora da transação (seção 7.3); aqui o doc nasce 'pendente'.
 */
export const vendasRepo = {
  async finalizar(
    input: FinalizarVendaInput,
  ): Promise<{ venda: Venda; documento: DocumentoFiscal | null }> {
    validarFinalizacao(input)
    const db = getDb()
    const agora = new Date().toISOString()

    const subtotal = input.itens.reduce(
      (acc, i) => acc + Math.round(i.precoUnitario * i.quantidade) - i.desconto,
      0,
    )
    const total = subtotal - input.descontoVenda

    return db.transaction(async (tx) => {
      const [venda] = await tx
        .insert(vendas)
        .values({
          caixaId: input.caixaId,
          usuarioId: input.usuarioId,
          clienteCpf: input.clienteCpf,
          subtotal,
          desconto: input.descontoVenda,
          total,
          status: 'finalizada',
          criadoEm: agora,
        })
        .returning()

      for (const item of input.itens) {
        const itemTotal = Math.round(item.precoUnitario * item.quantidade) - item.desconto
        await tx.insert(vendaItens).values({
          vendaId: venda.id,
          produtoId: item.produtoId,
          descricao: item.descricao,
          quantidade: item.quantidade,
          peso: item.peso,
          precoUnitario: item.precoUnitario,
          desconto: item.desconto,
          total: itemTotal,
        })

        // RF-16: baixa de estoque transacional.
        await tx
          .update(produtos)
          .set({ estoqueAtual: sql`${produtos.estoqueAtual} - ${item.quantidade}` })
          .where(eq(produtos.id, item.produtoId))

        await tx.insert(estoqueMovimentos).values({
          produtoId: item.produtoId,
          tipo: 'venda',
          quantidade: -item.quantidade,
          referenciaId: venda.id,
          usuarioId: input.usuarioId,
          criadoEm: agora,
        })
      }

      // Troco incide sobre o dinheiro (RF-07): registrado na 1ª linha em dinheiro.
      const totalPago = input.pagamentos.reduce((a, p) => a + p.valor, 0)
      let trocoRestante = Math.max(0, totalPago - total)
      for (const pag of input.pagamentos) {
        let troco = 0
        if (pag.forma === 'dinheiro' && trocoRestante > 0) {
          troco = Math.min(trocoRestante, pag.valor)
          trocoRestante -= troco
        }
        await tx
          .insert(vendaPagamentos)
          .values({ vendaId: venda.id, forma: pag.forma, valor: pag.valor, troco })
      }

      let documento: DocumentoFiscal | null = null
      if (input.emitirNfce) {
        // Numeração sequencial por série, nunca reutilizada (invariante 2).
        // O UPDATE ... RETURNING é atômico: dois caixas concorrentes nunca pegam
        // o mesmo número porque a linha da série fica travada até o commit.
        await tx
          .insert(contadoresFiscais)
          .values({ serie: SERIE_PADRAO, ultimoNumero: 0 })
          .onConflictDoNothing()
        const [contador] = await tx
          .update(contadoresFiscais)
          .set({ ultimoNumero: sql`${contadoresFiscais.ultimoNumero} + 1` })
          .where(eq(contadoresFiscais.serie, SERIE_PADRAO))
          .returning()

        const [doc] = await tx
          .insert(documentosFiscais)
          .values({
            vendaId: venda.id,
            modelo: 65,
            serie: SERIE_PADRAO,
            numero: contador.ultimoNumero,
            status: 'pendente',
            emitidaEm: agora,
          })
          .returning()
        documento = doc as DocumentoFiscal
      }

      return { venda: venda as Venda, documento }
    })
  },

  async cancelar(vendaId: number, usuarioId: number) {
    const db = getDb()
    const agora = new Date().toISOString()
    await db.transaction(async (tx) => {
      // Idempotência: só cancela venda ainda finalizada — evita estorno duplicado
      // de estoque. `for update` trava a linha contra dois cancelamentos simultâneos.
      const [venda] = await tx
        .select()
        .from(vendas)
        .where(eq(vendas.id, vendaId))
        .for('update')
      if (!venda) throw new Error('Venda não encontrada.')
      if (venda.status !== 'finalizada') {
        throw new Error(`Venda #${vendaId} não pode ser cancelada (status: ${venda.status}).`)
      }
      const itens = await tx.select().from(vendaItens).where(eq(vendaItens.vendaId, vendaId))
      // RF-16: estorno de estoque no cancelamento (transacional).
      for (const item of itens) {
        await tx
          .update(produtos)
          .set({ estoqueAtual: sql`${produtos.estoqueAtual} + ${item.quantidade}` })
          .where(eq(produtos.id, item.produtoId))
        await tx.insert(estoqueMovimentos).values({
          produtoId: item.produtoId,
          tipo: 'estorno_venda',
          quantidade: item.quantidade,
          referenciaId: vendaId,
          usuarioId,
          criadoEm: agora,
        })
      }
      await tx
        .update(vendas)
        .set({ status: 'cancelada', canceladaEm: agora, canceladaPorId: usuarioId })
        .where(eq(vendas.id, vendaId))
    })
  },
  /** Espelho de `listar` do desktop (RF-09). */
  async listar(filtro: FiltroVendas): Promise<VendaResumo[]> {
    const db = getDb()
    const conds = filtro.id
      ? [eq(vendas.id, filtro.id)]
      : [
          gte(vendas.criadoEm, filtro.de),
          lte(vendas.criadoEm, `${filtro.ate}T23:59:59.999`),
          ...(filtro.usuarioId ? [eq(vendas.usuarioId, filtro.usuarioId)] : []),
          ...(filtro.status ? [eq(vendas.status, filtro.status)] : []),
        ]

    const linhas = await db
      .select({
        id: vendas.id,
        criadoEm: vendas.criadoEm,
        usuarioId: vendas.usuarioId,
        operador: usuarios.nome,
        total: vendas.total,
        desconto: vendas.desconto,
        status: vendas.status,
        documentoId: documentosFiscais.id,
        documentoStatus: documentosFiscais.status,
        documentoChave: documentosFiscais.chaveAcesso,
        documentoAutorizadaEm: documentosFiscais.autorizadaEm,
      })
      .from(vendas)
      .innerJoin(usuarios, eq(vendas.usuarioId, usuarios.id))
      .leftJoin(documentosFiscais, eq(documentosFiscais.vendaId, vendas.id))
      .where(and(...conds))
      .orderBy(desc(vendas.id))

    if (linhas.length === 0) return []
    const ids = linhas.map((l) => l.id)

    const itens = await db
      .select({ vendaId: vendaItens.vendaId })
      .from(vendaItens)
      .where(inArray(vendaItens.vendaId, ids))
    const pagamentos = await db
      .select({ vendaId: vendaPagamentos.vendaId, forma: vendaPagamentos.forma })
      .from(vendaPagamentos)
      .where(inArray(vendaPagamentos.vendaId, ids))

    const contagem = new Map<number, number>()
    for (const i of itens) contagem.set(i.vendaId, (contagem.get(i.vendaId) ?? 0) + 1)
    const formas = new Map<number, FormaPagamento[]>()
    for (const p of pagamentos) {
      const lista = formas.get(p.vendaId) ?? []
      if (!lista.includes(p.forma as FormaPagamento)) lista.push(p.forma as FormaPagamento)
      formas.set(p.vendaId, lista)
    }

    return linhas.map((l) => ({
      ...l,
      status: l.status as StatusVenda,
      documentoStatus: (l.documentoStatus ?? null) as StatusDocumentoFiscal | null,
      quantidadeItens: contagem.get(l.id) ?? 0,
      formas: formas.get(l.id) ?? [],
    }))
  },
}
