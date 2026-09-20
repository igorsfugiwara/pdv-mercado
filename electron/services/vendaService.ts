import log from 'electron-log'
import { vendasRepo } from '../db/repositories/vendas.repo'
import { fiscalRepo } from '../db/repositories/fiscal.repo'
import { auditoriaRepo } from '../db/repositories/auditoria.repo'
import { produtosRepo } from '../db/repositories/produtos.repo'
import { configRepo } from '../db/repositories/config.repo'
import { getFiscalProvider } from '../fiscal'
import { imprimirDanfe, pulsoGaveta } from '../hardware/printer'
import type {
  ResultadoCancelamentoVenda,
  FinalizarVendaInput,
  ResultadoVenda,
  VendaFiscal,
  Venda,
  DanfeNfceDados,
} from '@shared/types'

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

  // Abre a gaveta em vendas com dinheiro (best-effort — não bloqueia a venda).
  if (input.pagamentos.some((p) => p.forma === 'dinheiro')) {
    void pulsoGaveta().catch((e) => log.warn('[venda] gaveta indisponível', e))
  }

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
      const danfe = await montarDanfe(input, venda, troco, r.chave, r.protocolo, r.qrCode, false)
      await imprimirDanfe(danfe).catch((e) => log.error('[venda] falha DANFE', e))
    } else if (r.status === 'contingencia') {
      await fiscalRepo.atualizarStatus(documento.id, {
        status: 'contingencia_pendente',
        chaveAcesso: r.chave,
      })
      const danfe = await montarDanfe(input, venda, troco, r.chave, null, r.qrCode, true)
      await imprimirDanfe(danfe).catch((e) => log.error('[venda] falha DANFE cont.', e))
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

async function montarDanfe(
  input: FinalizarVendaInput,
  venda: Venda,
  troco: number,
  chave: string,
  protocolo: string | null,
  qrCode: string,
  contingencia: boolean,
): Promise<DanfeNfceDados> {
  return {
    emitenteNome: (await configRepo.obter('emitente.nome')) ?? 'PDV MERCADO',
    emitenteCnpj: (await configRepo.obter('emitente.cnpj')) ?? '',
    itens: input.itens.map((i) => ({
      descricao: i.descricao,
      quantidade: i.quantidade,
      valorUnitario: i.precoUnitario,
      total: Math.round(i.precoUnitario * i.quantidade) - i.desconto,
    })),
    total: venda.total,
    desconto: venda.desconto,
    pagamentos: input.pagamentos,
    troco,
    chave,
    protocolo,
    qrCode,
    emitidaEm: venda.criadoEm,
    consumidorCpf: input.clienteCpf,
    contingencia,
  }
}

/** Janela legal para cancelar NFC-e, em minutos. SP usa 30. */
export const MINUTOS_CANCELAMENTO_PADRAO = 30

/**
 * Cancela uma venda finalizada (RF-09/RF-16/RF-28).
 *
 * A ordem importa: o banco primeiro, a SEFAZ depois. O estorno de estoque é o
 * que o mercado precisa de volta na gôndola, e não pode ficar refém de a SEFAZ
 * responder. Se o cancelamento fiscal falhar, a venda **continua cancelada** e
 * o documento fica pendente para nova tentativa.
 */
export async function cancelarVenda(
  vendaId: number,
  usuarioId: number,
  justificativa: string,
  autorizadoPorId: number,
): Promise<ResultadoCancelamentoVenda> {
  // A SEFAZ exige 15 caracteres na justificativa do evento; não faz sentido a
  // aplicação aceitar menos do que o fisco.
  if (justificativa.trim().length < 15) {
    return {
      ok: false,
      motivo: `Justificativa precisa de ao menos 15 caracteres (tem ${justificativa.trim().length}).`,
      fiscal: 'sem-documento',
    }
  }

  const documento = (await fiscalRepo.listar()).find((d) => d.vendaId === vendaId) ?? null

  // 1) Banco: estorno de estoque e status, em transação (já existente).
  try {
    vendasRepo.cancelar(vendaId, usuarioId)
  } catch (e) {
    // Segunda tentativa de cancelar a mesma venda cai aqui, sem efeito colateral.
    return {
      ok: false,
      motivo: e instanceof Error ? e.message : String(e),
      fiscal: 'sem-documento',
    }
  }

  await auditoriaRepo.registrar(usuarioId, 'venda_cancelar', {
    vendaId,
    justificativa,
    autorizadoPorId,
  })

  // 2) Fiscal, fora da transação.
  if (!documento || documento.status !== 'autorizada' || !documento.chaveAcesso) {
    return { ok: true, fiscal: 'sem-documento' }
  }

  const limite = Number(
    (await configRepo.obter('fiscal.cancelamento.minutos')) ?? MINUTOS_CANCELAMENTO_PADRAO,
  )
  const referencia = documento.autorizadaEm ?? documento.emitidaEm
  const minutosDesde = referencia
    ? (Date.now() - new Date(referencia).getTime()) / 60_000
    : Number.POSITIVE_INFINITY

  if (minutosDesde > limite) {
    // Fora do prazo o caminho é contábil, não técnico. Dizer que cancelou seria
    // mentira que só aparece meses depois, na apuração.
    await auditoriaRepo.registrar(usuarioId, 'venda_cancelar_fora_prazo', {
      vendaId,
      minutosDesde: Math.round(minutosDesde),
      limite,
    })
    return {
      ok: true,
      fiscal: 'fora-do-prazo',
      detalheFiscal: `A NFC-e foi autorizada há ${Math.round(minutosDesde)} min e o prazo de cancelamento é de ${limite} min. A venda foi cancelada no sistema; o acerto fiscal é com a contabilidade.`,
    }
  }

  try {
    const r = await getFiscalProvider().cancelar(documento.chaveAcesso, justificativa)
    if (!r.ok) {
      return { ok: true, fiscal: 'falhou', detalheFiscal: r.motivo ?? 'SEFAZ recusou o cancelamento.' }
    }
    await fiscalRepo.atualizarStatus(documento.id, {
      status: 'cancelada',
      canceladaEm: new Date().toISOString(),
    })
    return { ok: true, fiscal: 'cancelada' }
  } catch (e) {
    log.warn('[venda] cancelamento fiscal indisponível', e)
    return {
      ok: true,
      fiscal: 'falhou',
      detalheFiscal: e instanceof Error ? e.message : String(e),
    }
  }
}
