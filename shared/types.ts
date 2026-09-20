// Tipos de domínio compartilhados entre processo main e renderer.
// Convenção monetária: TODOS os valores em centavos (inteiros), como no PDV Casa Ó.

/** Id reservado da linha de rascunho em `vendas_espera` (invariante 4). */
export const RASCUNHO_ID = '__rascunho__'

export type Perfil = 'admin' | 'supervisor' | 'operador'

export type UnidadeMedida = 'UN' | 'KG'

export type FormaPagamento = 'dinheiro' | 'debito' | 'credito' | 'pix' | 'voucher'

export type StatusVenda = 'aberta' | 'finalizada' | 'cancelada'

export type StatusCaixa = 'aberto' | 'fechado'

export type TipoMovimentoCaixa = 'sangria' | 'suprimento' | 'abertura' | 'fechamento'

export type TipoMovimentoEstoque =
  | 'venda'
  | 'estorno_venda'
  | 'entrada'
  | 'ajuste_inventario'

export type StatusDocumentoFiscal =
  | 'pendente'
  | 'autorizada'
  | 'contingencia_pendente'
  | 'rejeitada'
  | 'cancelada'
  | 'inutilizada'

export interface Usuario {
  id: number
  nome: string
  login: string
  perfil: Perfil
  ativo: boolean
  criadoEm: string
}

// Campos fiscais obrigatórios para ATIVAR o produto (RF-14).
export interface Produto {
  id: number
  codigoInterno: string
  ean: string | null
  descricao: string
  unidade: UnidadeMedida
  pesavel: boolean
  precoCusto: number // centavos
  precoVenda: number // centavos
  estoqueAtual: number
  estoqueMinimo: number
  grupoId: number | null
  imagemPath: string | null
  ativo: boolean
  // Fiscais
  ncm: string | null
  cest: string | null
  cfop: string | null
  origem: string | null // 0..8 (tabela ICMS origem)
  csosn: string | null // Simples Nacional
  cstPis: string | null
  aliqPis: number | null // basis points (ex: 165 = 1,65%)
  cstCofins: string | null
  aliqCofins: number | null
  criadoEm: string
  atualizadoEm: string
}

export interface Grupo {
  id: number
  nome: string
}

export interface Caixa {
  id: number
  usuarioAberturaId: number
  valorAbertura: number
  abertoEm: string
  usuarioFechamentoId: number | null
  fechadoEm: string | null
  status: StatusCaixa
}

export interface MovimentoCaixa {
  id: number
  caixaId: number
  tipo: TipoMovimentoCaixa
  valor: number
  motivo: string | null
  usuarioId: number
  autorizadoPorId: number | null
  criadoEm: string
}

export interface VendaItem {
  id: number
  vendaId: number
  produtoId: number
  descricao: string
  quantidade: number // permite fracionário (KG)
  peso: number | null
  precoUnitario: number
  desconto: number
  total: number
}

export interface VendaPagamento {
  id: number
  vendaId: number
  forma: FormaPagamento
  valor: number
  troco: number
}

export interface Venda {
  id: number
  caixaId: number
  usuarioId: number
  clienteCpf: string | null
  subtotal: number
  desconto: number
  total: number
  status: StatusVenda
  criadoEm: string
  canceladaEm: string | null
  canceladaPorId: number | null
}

export interface DocumentoFiscal {
  id: number
  vendaId: number
  modelo: number // 65
  serie: number
  numero: number
  chaveAcesso: string | null
  status: StatusDocumentoFiscal
  protocolo: string | null
  xmlPath: string | null
  motivoRejeicao: string | null
  emitidaEm: string | null
  autorizadaEm: string | null
  canceladaEm: string | null
  /** Última falha de transmissão (fatia 10). */
  ultimoErro?: string | null
  ultimaTentativaEm?: string | null
  tentativas?: number
}

export interface EstoqueMovimento {
  id: number
  produtoId: number
  tipo: TipoMovimentoEstoque
  quantidade: number
  referenciaId: number | null
  usuarioId: number
  criadoEm: string
}

export interface Auditoria {
  id: number
  usuarioId: number | null
  acao: string
  detalheJson: string | null
  criadoEm: string
}

// ---- DTOs de venda (renderer -> main) ----

export interface ItemCarrinho {
  produtoId: number
  descricao: string
  quantidade: number
  peso: number | null
  precoUnitario: number
  desconto: number // centavos, por item
}

export interface PagamentoInput {
  forma: FormaPagamento
  valor: number
}

export interface FinalizarVendaInput {
  caixaId: number
  usuarioId: number
  clienteCpf: string | null
  itens: ItemCarrinho[]
  descontoVenda: number // centavos, no total
  pagamentos: PagamentoInput[]
  emitirNfce: boolean
}

export interface ResultadoVenda {
  venda: Venda
  documentoFiscal: DocumentoFiscal | null
  troco: number
}

// ---- Fiscal ----

export interface VendaFiscal {
  vendaId: number
  clienteCpf: string | null
  itens: Array<{
    descricao: string
    ncm: string
    cfop: string
    csosn: string
    quantidade: number
    unidade: string
    valorUnitario: number
    ean: string | null
  }>
  pagamentos: PagamentoInput[]
  total: number
}

export type ResultadoEmissao =
  | { status: 'autorizada'; chave: string; protocolo: string; xml: string; qrCode: string }
  | { status: 'contingencia'; chave: string; xml: string; qrCode: string }
  | { status: 'rejeitada'; codigo: string; motivo: string }

// Dados estruturados p/ montar o DANFE NFC-e na impressora térmica (RF-26).
export interface DanfeNfceDados {
  emitenteNome: string
  emitenteCnpj: string
  itens: Array<{ descricao: string; quantidade: number; valorUnitario: number; total: number }>
  total: number
  desconto: number
  pagamentos: PagamentoInput[]
  troco: number
  chave: string
  protocolo: string | null
  qrCode: string
  emitidaEm: string
  consumidorCpf: string | null
  contingencia: boolean
}

export interface ResultadoCancelamento {
  ok: boolean
  protocolo?: string
  motivo?: string
}

export interface StatusSefaz {
  online: boolean
  ambiente: 'homologacao' | 'producao'
  tempoRespostaMs: number | null
  mensagem: string
  /**
   * Data-hora do servidor da SEFAZ (ISO-8601), quando o provider consegue
   * obtê-la. É a melhor referência de relógio que existe para este sistema:
   * é exatamente o relógio contra o qual a nota será validada.
   *
   * O provider simulado **não** preenche — inventar a hora local aqui faria o
   * desvio ser sempre zero e esconderia justamente o problema que a fatia 09
   * existe para achar.
   */
  horaServidor?: string | null
}

/** Implementação fiscal em uso. `simulado` é o padrão enquanto a emissão real não for homologada. */
export type ProviderFiscal = 'simulado' | 'acbr'

/** Falha injetável no provider simulado, para exercitar contingência e rejeição. */
export type ModoFalhaFiscal = 'nenhuma' | 'timeout' | 'rejeicao'

/**
 * Estado do módulo fiscal para a UI sinalizar ao operador (RF-30).
 * `simulado: true` significa documentos SEM valor fiscal — a UI é obrigada a dizer isso.
 */
export interface EstadoFiscal {
  provider: ProviderFiscal
  simulado: boolean
  /** Preenchido quando o `acbr` foi pedido, não subiu, e o módulo caiu para simulado. */
  motivoFallback: string | null
  modoFalha: ModoFalhaFiscal
}

/**
 * Giro médio diário de um produto (RF-18). Só produtos COM venda no período
 * aparecem — sem histórico é ausência, não zero, e é o que evita dividir por
 * zero ao estimar dias restantes de estoque.
 */
export interface MediaDiariaProduto {
  produtoId: number
  mediaDiaria: number
}

/** Uma venda na listagem — o suficiente para achar e decidir cancelar. */
export interface VendaResumo {
  id: number
  criadoEm: string
  usuarioId: number
  operador: string
  total: number
  desconto: number
  status: StatusVenda
  quantidadeItens: number
  formas: FormaPagamento[]
  /** Documento fiscal da venda, quando existe. */
  documentoId: number | null
  documentoStatus: StatusDocumentoFiscal | null
  documentoChave: string | null
  documentoAutorizadaEm: string | null
}

export interface FiltroVendas {
  de: string
  ate: string
  usuarioId?: number
  status?: StatusVenda
  /** Número exato da venda — quando informado, os outros filtros são ignorados. */
  id?: number
}

/** Resultado do cancelamento, incluindo o que aconteceu com o documento fiscal. */
export interface ResultadoCancelamentoVenda {
  ok: boolean
  motivo?: string
  /** O que aconteceu com a NFC-e. */
  fiscal: 'cancelada' | 'fora-do-prazo' | 'falhou' | 'sem-documento'
  detalheFiscal?: string
}

// ---- Relatórios (RF-22..25) ----

export interface RelatorioVendas {
  resumo: {
    quantidadeVendas: number
    subtotal: number
    desconto: number
    total: number
    ticketMedio: number
  }
  porForma: Array<{ forma: FormaPagamento; valor: number; quantidade: number }>
  porOperador: Array<{ usuarioId: number; nome: string; quantidade: number; total: number }>
  porProduto: Array<{ produtoId: number; descricao: string; quantidade: number; total: number }>
  porGrupo: Array<{ grupoId: number | null; nome: string; total: number }>
}

export type ClasseAbc = 'A' | 'B' | 'C'

export interface LinhaCurvaAbc {
  produtoId: number
  descricao: string
  quantidade: number
  faturamento: number
  percentual: number // % do faturamento total
  percentualAcumulado: number
  classe: ClasseAbc
}

// ---- Fechamento de caixa (RF-11/RF-13) ----

/**
 * Resumo mostrado ANTES da contagem. Deliberadamente SEM qualquer valor em
 * dinheiro: a conferência é cega (RF-11), e se o esperado chegar ao renderer
 * antes da contagem ser confirmada, o operador digita o que está na tela.
 */
export interface ResumoPreFechamento {
  caixaId: number
  abertoEm: string
  operadorAbertura: string
  quantidadeVendas: number
  vendasEmEspera: number
  temRascunho: boolean
  /** Impedimentos que precisam ser resolvidos antes de fechar. Vazio = pode fechar. */
  bloqueios: string[]
}

/** Uma linha da composição do saldo esperado, com sinal (sangria é negativa). */
export interface LinhaComposicao {
  rotulo: string
  valor: number
}

export interface MovimentoFechamento {
  tipo: TipoMovimentoCaixa
  valor: number
  motivo: string | null
  operador: string
  autorizadoPor: string | null
  criadoEm: string
}

export interface RelatorioFechamento {
  caixaId: number
  loja: string
  operadorAbertura: string
  operadorFechamento: string | null
  abertoEm: string
  fechadoEm: string | null
  vendas: { quantidade: number; total: number }
  porForma: Array<{ forma: FormaPagamento; quantidade: number; valor: number }>
  movimentos: MovimentoFechamento[]
  conferencia: {
    composicao: LinhaComposicao[]
    esperado: number
    contado: number
    diferenca: number
    motivo: string | null
  }
  documentos: Array<{ status: StatusDocumentoFiscal; quantidade: number }>
}

/**
 * Resultado da tentativa de fechar. É AQUI que o valor esperado chega ao
 * renderer pela primeira vez — nunca antes da contagem ser enviada.
 */
export type ResultadoFechamento =
  | { status: 'fechado'; relatorio: RelatorioFechamento }
  | { status: 'requer_justificativa'; diferenca: number; limite: number }
  | { status: 'bloqueado'; bloqueios: string[] }
