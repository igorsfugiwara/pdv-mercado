import log from 'electron-log'
import { vendasRepo } from '../db/repositories/vendas.repo'
import { fiscalRepo } from '../db/repositories/fiscal.repo'
import { produtosRepo } from '../db/repositories/produtos.repo'
import { getFiscalProvider } from '../fiscal'
import { imprimirDanfe } from '../hardware/printer'
import type { FinalizarVendaInput, ResultadoVenda, VendaFiscal } from '@shared/types'

/**
 * Orquestra a finalização (seção 7.3):
 *   tx SQLite → FiscalProvider.emitir → autorizada | contingência | rejeitada.
 * A transação de banco SEMPRE persiste a venda; a falha fiscal não desfaz a venda.
 */
export async function finalizarVenda(input: FinalizarVendaInput): Promise<ResultadoVenda> {
  // 1) Transação única de banco (invariante 1).
  const { venda, documento } = vendasRepo.finalizar(input)

  // Troco calculado sobre pagamentos em dinheiro.
  const totalPago = input.pagamentos.reduce((a, p) => a + p.valor, 0)
  const troco = Math.max(0, totalPago - venda.total)

  if (!documento) return { venda, documentoFiscal: null, troco }

  // 2) Emissão fiscal fora da transação.
  try {
    const vendaFiscal = await montarVendaFiscal(input, venda.id, venda.total)
    const r = await getFiscalProvider().emitir(vendaFiscal)

    if (r.status === 'autorizada') {
      await fiscalRepo.atualizarStatus(documento.id, {
        status: 'autorizada',
        chaveAcesso: r.chave,
        protocolo: r.protocolo,
        autorizadaEm: new Date().toISOString(),
      })
      await imprimirDanfe(r.xml, r.chave).catch((e) => log.error('[venda] falha DANFE', e))
    } else if (r.status === 'contingencia') {
      await fiscalRepo.atualizarStatus(documento.id, {
        status: 'contingencia_pendente',
        chaveAcesso: r.chave,
      })
      await imprimirDanfe(r.xml, r.chave).catch((e) => log.error('[venda] falha DANFE cont.', e))
    } else {
      await fiscalRepo.atualizarStatus(documento.id, {
        status: 'rejeitada',
        motivoRejeicao: `${r.codigo}: ${r.motivo}`,
      })
    }
  } catch (e) {
    // Timeout / lib indisponível → contingência (tpEmis=9). Venda permanece.
    log.warn('[venda] emissão indisponível, marcando contingência', e)
    await fiscalRepo.atualizarStatus(documento.id, { status: 'contingencia_pendente' })
  }

  const doc = (await fiscalRepo.listar()).find((d) => d.id === documento.id) ?? documento
  return { venda, documentoFiscal: doc, troco }
}

async function montarVendaFiscal(
  input: FinalizarVendaInput,
  vendaId: number,
  total: number,
): Promise<VendaFiscal> {
  const produtos = await produtosRepo.listar(true)
  const byId = new Map(produtos.map((p) => [p.id, p]))
  return {
    vendaId,
    clienteCpf: input.clienteCpf,
    // Total fiscal = total efetivamente cobrado (já com desconto da venda), igual a venda.total.
    total,
    pagamentos: input.pagamentos,
    itens: input.itens.map((i) => {
      const p = byId.get(i.produtoId)
      return {
        descricao: i.descricao,
        ncm: p?.ncm ?? '',
        cfop: p?.cfop ?? '',
        csosn: p?.csosn ?? '',
        quantidade: i.quantidade,
        unidade: p?.unidade ?? 'UN',
        valorUnitario: i.precoUnitario,
        ean: p?.ean ?? null,
      }
    }),
  }
}
