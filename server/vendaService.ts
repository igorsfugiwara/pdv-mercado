import { vendasRepo } from './repos/vendas.repo'
import { fiscalRepo } from './repos/fiscal.repo'
import { produtosRepo } from './repos/produtos.repo'
import { configRepo } from './repos/config.repo'
import { getFiscalProvider } from './fiscal.web'
import type { FinalizarVendaInput, ResultadoVenda, VendaFiscal } from '@shared/types'

/**
 * Orquestra a finalização (seção 7.3): transação de banco → emissão fiscal.
 * A transação SEMPRE persiste a venda; falha fiscal não desfaz a venda.
 *
 * Diferença vs. desktop: sem gaveta e sem impressão de DANFE — no navegador não
 * há periférico. O cupom é exibido na tela pela UI.
 */
export async function finalizarVenda(input: FinalizarVendaInput): Promise<ResultadoVenda> {
  // 1) Transação única de banco (invariante 1).
  const { venda, documento } = await vendasRepo.finalizar(input)

  const totalPago = input.pagamentos.reduce((a, p) => a + p.valor, 0)
  const troco = Math.max(0, totalPago - venda.total)

  if (!documento) return { venda, documentoFiscal: null, troco }

  // 2) Emissão fiscal fora da transação.
  try {
    const cnpj = (await configRepo.obter('emitente.cnpj')) ?? undefined
    const vendaFiscal = await montarVendaFiscal(input, venda.id, venda.total)
    const r = await getFiscalProvider(cnpj).emitir(vendaFiscal)

    if (r.status === 'autorizada') {
      await fiscalRepo.atualizarStatus(documento.id, {
        status: 'autorizada',
        chaveAcesso: r.chave,
        protocolo: r.protocolo,
        autorizadaEm: new Date().toISOString(),
      })
    } else if (r.status === 'contingencia') {
      await fiscalRepo.atualizarStatus(documento.id, {
        status: 'contingencia_pendente',
        chaveAcesso: r.chave,
      })
    } else {
      await fiscalRepo.atualizarStatus(documento.id, {
        status: 'rejeitada',
        motivoRejeicao: `${r.codigo}: ${r.motivo}`,
      })
    }
  } catch {
    // Emissor indisponível → contingência (tpEmis=9). Venda permanece.
    await fiscalRepo.atualizarStatus(documento.id, { status: 'contingencia_pendente' })
  }

  const doc = (await fiscalRepo.porId(documento.id)) ?? documento
  return { venda, documentoFiscal: doc, troco }
}

async function montarVendaFiscal(
  input: FinalizarVendaInput,
  vendaId: number,
  total: number,
): Promise<VendaFiscal> {
  const lista = await produtosRepo.listar(true)
  const byId = new Map(lista.map((p) => [p.id, p]))
  return {
    vendaId,
    clienteCpf: input.clienteCpf,
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

/** RF-27: retransmite os documentos presos em contingência. */
export async function reprocessarContingencia(): Promise<{ processados: number }> {
  const pendentes = await fiscalRepo.listar('contingencia_pendente')
  const cnpj = (await configRepo.obter('emitente.cnpj')) ?? undefined
  const provider = getFiscalProvider(cnpj)
  let processados = 0

  for (const doc of pendentes) {
    try {
      const r = await provider.retransmitir(doc)
      if (r.status === 'autorizada') {
        await fiscalRepo.atualizarStatus(doc.id, {
          status: 'autorizada',
          chaveAcesso: r.chave,
          protocolo: r.protocolo,
          autorizadaEm: new Date().toISOString(),
        })
        processados++
      } else if (r.status === 'rejeitada') {
        await fiscalRepo.atualizarStatus(doc.id, {
          status: 'rejeitada',
          motivoRejeicao: `${r.codigo}: ${r.motivo}`,
        })
        processados++
      }
      // 'contingencia' → permanece na fila para a próxima tentativa.
    } catch {
      // Continua a fila: um documento problemático não trava os demais.
    }
  }
  return { processados }
}
