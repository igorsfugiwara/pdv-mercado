import { eq, sql } from 'drizzle-orm'
import { getDb } from '../index'
import {
  vendas,
  vendaItens,
  vendaPagamentos,
  documentosFiscais,
  estoqueMovimentos,
  produtos,
  contadoresFiscais,
} from '../schema'
import type { Venda, DocumentoFiscal, FinalizarVendaInput } from '@shared/types'

const SERIE_PADRAO = 1

/**
 * Invariante 1: finalização de venda é UMA transação única
 * (vendas + venda_itens + venda_pagamentos + estoque_movimentos + documentos_fiscais).
 * A emissão fiscal ocorre DEPOIS, fora da transação (seção 7.3); aqui o doc nasce 'pendente'.
 * Retorna venda + documento fiscal reservado (com número sequencial).
 */
export const vendasRepo = {
  finalizar(input: FinalizarVendaInput): { venda: Venda; documento: DocumentoFiscal | null } {
    const db = getDb()
    const agora = new Date().toISOString()

    const subtotal = input.itens.reduce(
      (acc, i) => acc + Math.round(i.precoUnitario * i.quantidade) - i.desconto,
      0,
    )
    const total = subtotal - input.descontoVenda

    return db.transaction((tx) => {
      const [venda] = tx
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
        .all()

      for (const item of input.itens) {
        const itemTotal = Math.round(item.precoUnitario * item.quantidade) - item.desconto
        tx.insert(vendaItens)
          .values({
            vendaId: venda.id,
            produtoId: item.produtoId,
            descricao: item.descricao,
            quantidade: item.quantidade,
            peso: item.peso,
            precoUnitario: item.precoUnitario,
            desconto: item.desconto,
            total: itemTotal,
          })
          .run()

        // RF-16: baixa de estoque transacional.
        tx.update(produtos)
          .set({ estoqueAtual: sql`${produtos.estoqueAtual} - ${item.quantidade}` })
          .where(eq(produtos.id, item.produtoId))
          .run()

        tx.insert(estoqueMovimentos)
          .values({
            produtoId: item.produtoId,
            tipo: 'venda',
            quantidade: -item.quantidade,
            referenciaId: venda.id,
            usuarioId: input.usuarioId,
            criadoEm: agora,
          })
          .run()
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
        tx.insert(vendaPagamentos)
          .values({ vendaId: venda.id, forma: pag.forma, valor: pag.valor, troco })
          .run()
      }

      let documento: DocumentoFiscal | null = null
      if (input.emitirNfce) {
        // Numeração sequencial por série, nunca reutilizada (invariante 2).
        tx.insert(contadoresFiscais)
          .values({ serie: SERIE_PADRAO, ultimoNumero: 0 })
          .onConflictDoNothing()
          .run()
        tx.update(contadoresFiscais)
          .set({ ultimoNumero: sql`${contadoresFiscais.ultimoNumero} + 1` })
          .where(eq(contadoresFiscais.serie, SERIE_PADRAO))
          .run()
        const [contador] = tx
          .select()
          .from(contadoresFiscais)
          .where(eq(contadoresFiscais.serie, SERIE_PADRAO))
          .all()

        const [doc] = tx
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
          .all()
        documento = doc as DocumentoFiscal
      }

      return { venda: venda as Venda, documento }
    })
  },

  cancelar(vendaId: number, usuarioId: number) {
    const db = getDb()
    const agora = new Date().toISOString()
    db.transaction((tx) => {
      const itens = tx.select().from(vendaItens).where(eq(vendaItens.vendaId, vendaId)).all()
      // RF-16: estorno de estoque no cancelamento (transacional).
      for (const item of itens) {
        tx.update(produtos)
          .set({ estoqueAtual: sql`${produtos.estoqueAtual} + ${item.quantidade}` })
          .where(eq(produtos.id, item.produtoId))
          .run()
        tx.insert(estoqueMovimentos)
          .values({
            produtoId: item.produtoId,
            tipo: 'estorno_venda',
            quantidade: item.quantidade,
            referenciaId: vendaId,
            usuarioId,
            criadoEm: agora,
          })
          .run()
      }
      tx.update(vendas)
        .set({ status: 'cancelada', canceladaEm: agora, canceladaPorId: usuarioId })
        .where(eq(vendas.id, vendaId))
        .run()
    })
  },
}
