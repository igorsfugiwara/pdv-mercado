import type { Caixa, Produto, DocumentoFiscal, MediaDiariaProduto } from '@shared/types'
import type { VereditoRelogio } from '@shared/relogio'

/**
 * Lógica pura do painel (RF-18).
 *
 * Fica fora do componente para ser testável sem montar React: são regras de
 * negócio — o que é alerta, qual a gravidade, quantos dias de estoque restam —
 * e não apresentação.
 */

export type Gravidade = 'alta' | 'media' | 'baixa'

export interface Alerta {
  id: string
  titulo: string
  detalhe: string
  gravidade: Gravidade
  /** Para onde o clique leva — alerta que não leva à ação é ruído. */
  rota: string
  quantidade: number
}

export const ORDEM_GRAVIDADE: Record<Gravidade, number> = { alta: 0, media: 1, baixa: 2 }

/** Horas a partir das quais um caixa aberto vira alerta de turno esquecido. */
export const HORAS_TURNO_LONGO = 12

export interface EntradaAlertas {
  contingencia: DocumentoFiscal[]
  rejeitados: DocumentoFiscal[]
  estoqueMinimo: Produto[]
  inativosPorFiscal: Produto[]
  caixa: Caixa | null
  emEspera: unknown[]
  /** Veredito da última verificação de relógio (fatia 09). */
  relogio?: VereditoRelogio | null
  agora?: Date
}

/**
 * Monta a lista de ações pendentes, já ordenada por gravidade.
 * Origem vazia não vira alerta — o bloco some em vez de mostrar "0".
 */
export function montarAlertas(e: EntradaAlertas): Alerta[] {
  const agora = e.agora ?? new Date()
  const alertas: Alerta[] = []

  // Relógio errado tem consequência fiscal direta: entra na mesma classe de
  // gravidade da contingência, e antes dela por ser causa e não sintoma.
  if (e.relogio && e.relogio.gravidade !== 'ok') {
    alertas.push({
      id: 'relogio',
      titulo: 'Relógio da máquina fora de hora',
      detalhe: e.relogio.mensagem,
      gravidade: 'alta',
      rota: '/config',
      quantidade: 1,
    })
  }

  if (e.contingencia.length > 0) {
    alertas.push({
      id: 'contingencia',
      titulo: 'Documentos em contingência',
      detalhe: 'Precisam ser retransmitidos à SEFAZ — há prazo.',
      gravidade: 'alta',
      rota: '/fiscal',
      quantidade: e.contingencia.length,
    })
  }

  if (e.rejeitados.length > 0) {
    alertas.push({
      id: 'rejeitados',
      titulo: 'Documentos rejeitados',
      detalhe: 'Rejeitados pela SEFAZ e ainda sem correção.',
      gravidade: 'alta',
      rota: '/fiscal',
      quantidade: e.rejeitados.length,
    })
  }

  if (e.estoqueMinimo.length > 0) {
    alertas.push({
      id: 'estoque',
      titulo: 'Produtos abaixo do estoque mínimo',
      detalhe: 'Repor antes de faltar na gôndola.',
      gravidade: 'media',
      rota: '/estoque',
      quantidade: e.estoqueMinimo.length,
    })
  }

  if (e.inativosPorFiscal.length > 0) {
    alertas.push({
      id: 'fiscal-incompleto',
      titulo: 'Produtos sem campos fiscais',
      detalhe: 'Não podem ser ativados até NCM, CFOP, origem e CSOSN estarem preenchidos.',
      gravidade: 'media',
      rota: '/produtos',
      quantidade: e.inativosPorFiscal.length,
    })
  }

  if (e.caixa && horasAberto(e.caixa, agora) >= HORAS_TURNO_LONGO) {
    alertas.push({
      id: 'turno-longo',
      titulo: 'Caixa aberto há muito tempo',
      detalhe: `Aberto há ${Math.floor(horasAberto(e.caixa, agora))} h — turno provavelmente esquecido.`,
      gravidade: 'media',
      rota: '/fechamento',
      quantidade: 1,
    })
  }

  if (e.emEspera.length > 0) {
    alertas.push({
      id: 'espera',
      titulo: 'Vendas em espera',
      detalhe: 'Aguardando retomada ou cancelamento.',
      gravidade: 'baixa',
      rota: '/caixa',
      quantidade: e.emEspera.length,
    })
  }

  return alertas.sort((a, b) => ORDEM_GRAVIDADE[a.gravidade] - ORDEM_GRAVIDADE[b.gravidade])
}

export function horasAberto(caixa: Caixa, agora = new Date()): number {
  return (agora.getTime() - new Date(caixa.abertoEm).getTime()) / 3_600_000
}

export interface LinhaEstoque {
  produto: Produto
  /** `null` quando não há venda no período — "sem histórico", não zero. */
  diasRestantes: number | null
}

/**
 * Quantos dias de venda o saldo ainda cobre.
 *
 * "Arroz: 8 unidades" não diz nada; "Arroz: 8 unidades, ~2 dias" diz quando
 * comprar. Produto sem venda no período não estima — é o caso que dividiria
 * por zero.
 */
export function estimarDiasRestantes(
  produtos: Produto[],
  medias: MediaDiariaProduto[],
): LinhaEstoque[] {
  const porProduto = new Map(medias.map((m) => [m.produtoId, m.mediaDiaria]))

  return produtos.map((produto) => {
    const media = porProduto.get(produto.id)
    if (!media || media <= 0) return { produto, diasRestantes: null }
    return { produto, diasRestantes: Math.floor(produto.estoqueAtual / media) }
  })
}

/** Ticket médio em centavos. Sem venda, zero — não é divisão por zero disfarçada. */
export function ticketMedio(total: number, quantidadeVendas: number): number {
  if (quantidadeVendas <= 0) return 0
  return Math.round(total / quantidadeVendas)
}

/** Rota inicial por perfil: quem opera o caixa abre o sistema para trabalhar nele. */
export function rotaInicial(perfil: string): string {
  return perfil === 'operador' ? '/caixa' : '/painel'
}
