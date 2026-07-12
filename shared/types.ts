// Tipos de domínio compartilhados entre processo main e renderer.
// Convenção monetária: TODOS os valores em centavos (inteiros), como no PDV Casa Ó.

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
