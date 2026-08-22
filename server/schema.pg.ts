import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  doublePrecision,
  index,
} from 'drizzle-orm/pg-core'

// Espelho Postgres do schema SQLite de `electron/db/schema.ts` (seção 4 do PRD).
// Mesmas invariantes: dinheiro em centavos (integer), datas ISO-8601 (text — a
// comparação lexicográfica dos relatórios depende disso), booleanos nativos.
//
// Diferenças deliberadas vs. SQLite:
//   · `real` do SQLite é f64; o `real` do Postgres é f32 → usamos doublePrecision
//     para quantidades/estoque, senão 25.5 kg vira 25.499999.
//   · autoincrement → serial.

export const usuarios = pgTable('usuarios', {
  id: serial('id').primaryKey(),
  nome: text('nome').notNull(),
  login: text('login').notNull().unique(),
  senhaHash: text('senha_hash').notNull(),
  pinHash: text('pin_hash'),
  perfil: text('perfil', { enum: ['admin', 'supervisor', 'operador'] }).notNull(),
  ativo: boolean('ativo').notNull().default(true),
  criadoEm: text('criado_em').notNull(),
})

export const grupos = pgTable('grupos', {
  id: serial('id').primaryKey(),
  nome: text('nome').notNull().unique(),
})

export const produtos = pgTable(
  'produtos',
  {
    id: serial('id').primaryKey(),
    codigoInterno: text('codigo_interno').notNull().unique(),
    ean: text('ean'),
    descricao: text('descricao').notNull(),
    unidade: text('unidade', { enum: ['UN', 'KG'] }).notNull().default('UN'),
    pesavel: boolean('pesavel').notNull().default(false),
    precoCusto: integer('preco_custo').notNull().default(0),
    precoVenda: integer('preco_venda').notNull().default(0),
    estoqueAtual: doublePrecision('estoque_atual').notNull().default(0),
    estoqueMinimo: doublePrecision('estoque_minimo').notNull().default(0),
    grupoId: integer('grupo_id').references(() => grupos.id),
    imagemPath: text('imagem_path'),
    ativo: boolean('ativo').notNull().default(false),
    // Fiscais (RF-14) — obrigatórios para ativar
    ncm: text('ncm'),
    cest: text('cest'),
    cfop: text('cfop'),
    origem: text('origem'),
    csosn: text('csosn'),
    cstPis: text('cst_pis'),
    aliqPis: integer('aliq_pis'),
    cstCofins: text('cst_cofins'),
    aliqCofins: integer('aliq_cofins'),
    criadoEm: text('criado_em').notNull(),
    atualizadoEm: text('atualizado_em').notNull(),
  },
  (t) => ({
    eanIdx: index('idx_produtos_ean').on(t.ean),
    descricaoIdx: index('idx_produtos_descricao').on(t.descricao),
  }),
)

export const caixas = pgTable('caixas', {
  id: serial('id').primaryKey(),
  usuarioAberturaId: integer('usuario_abertura_id')
    .notNull()
    .references(() => usuarios.id),
  valorAbertura: integer('valor_abertura').notNull().default(0),
  abertoEm: text('aberto_em').notNull(),
  usuarioFechamentoId: integer('usuario_fechamento_id').references(() => usuarios.id),
  fechadoEm: text('fechado_em'),
  status: text('status', { enum: ['aberto', 'fechado'] }).notNull().default('aberto'),
})

export const movimentosCaixa = pgTable('movimentos_caixa', {
  id: serial('id').primaryKey(),
  caixaId: integer('caixa_id')
    .notNull()
    .references(() => caixas.id),
  tipo: text('tipo', {
    enum: ['sangria', 'suprimento', 'abertura', 'fechamento'],
  }).notNull(),
  valor: integer('valor').notNull(),
  motivo: text('motivo'),
  usuarioId: integer('usuario_id')
    .notNull()
    .references(() => usuarios.id),
  autorizadoPorId: integer('autorizado_por_id').references(() => usuarios.id),
  criadoEm: text('criado_em').notNull(),
})

export const vendas = pgTable(
  'vendas',
  {
    id: serial('id').primaryKey(),
    caixaId: integer('caixa_id')
      .notNull()
      .references(() => caixas.id),
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuarios.id),
    clienteCpf: text('cliente_cpf'),
    subtotal: integer('subtotal').notNull(),
    desconto: integer('desconto').notNull().default(0),
    total: integer('total').notNull(),
    status: text('status', { enum: ['aberta', 'finalizada', 'cancelada'] })
      .notNull()
      .default('finalizada'),
    criadoEm: text('criado_em').notNull(),
    canceladaEm: text('cancelada_em'),
    canceladaPorId: integer('cancelada_por_id').references(() => usuarios.id),
  },
  (t) => ({
    criadoIdx: index('idx_vendas_criado').on(t.criadoEm),
  }),
)

export const vendaItens = pgTable('venda_itens', {
  id: serial('id').primaryKey(),
  vendaId: integer('venda_id')
    .notNull()
    .references(() => vendas.id),
  produtoId: integer('produto_id')
    .notNull()
    .references(() => produtos.id),
  descricao: text('descricao').notNull(),
  quantidade: doublePrecision('quantidade').notNull(),
  peso: doublePrecision('peso'),
  precoUnitario: integer('preco_unitario').notNull(),
  desconto: integer('desconto').notNull().default(0),
  total: integer('total').notNull(),
})

export const vendaPagamentos = pgTable('venda_pagamentos', {
  id: serial('id').primaryKey(),
  vendaId: integer('venda_id')
    .notNull()
    .references(() => vendas.id),
  forma: text('forma', {
    enum: ['dinheiro', 'debito', 'credito', 'pix', 'voucher'],
  }).notNull(),
  valor: integer('valor').notNull(),
  troco: integer('troco').notNull().default(0),
})

export const documentosFiscais = pgTable(
  'documentos_fiscais',
  {
    id: serial('id').primaryKey(),
    vendaId: integer('venda_id')
      .notNull()
      .references(() => vendas.id),
    modelo: integer('modelo').notNull().default(65),
    serie: integer('serie').notNull().default(1),
    numero: integer('numero').notNull(),
    chaveAcesso: text('chave_acesso'),
    status: text('status', {
      enum: [
        'pendente',
        'autorizada',
        'contingencia_pendente',
        'rejeitada',
        'cancelada',
        'inutilizada',
      ],
    })
      .notNull()
      .default('pendente'),
    protocolo: text('protocolo'),
    xmlPath: text('xml_path'),
    motivoRejeicao: text('motivo_rejeicao'),
    emitidaEm: text('emitida_em'),
    autorizadaEm: text('autorizada_em'),
    canceladaEm: text('cancelada_em'),
  },
  (t) => ({
    statusIdx: index('idx_docfiscais_status').on(t.status),
  }),
)

export const estoqueMovimentos = pgTable('estoque_movimentos', {
  id: serial('id').primaryKey(),
  produtoId: integer('produto_id')
    .notNull()
    .references(() => produtos.id),
  tipo: text('tipo', {
    enum: ['venda', 'estorno_venda', 'entrada', 'ajuste_inventario'],
  }).notNull(),
  quantidade: doublePrecision('quantidade').notNull(),
  referenciaId: integer('referencia_id'),
  usuarioId: integer('usuario_id')
    .notNull()
    .references(() => usuarios.id),
  criadoEm: text('criado_em').notNull(),
})

export const auditoria = pgTable('auditoria', {
  id: serial('id').primaryKey(),
  usuarioId: integer('usuario_id').references(() => usuarios.id),
  acao: text('acao').notNull(),
  detalheJson: text('detalhe_json'),
  criadoEm: text('criado_em').notNull(),
})

export const configuracoes = pgTable('configuracoes', {
  chave: text('chave').primaryKey(),
  valor: text('valor').notNull(),
})

// Numeração fiscal sequencial por série (invariante 2). Uma linha por série.
export const contadoresFiscais = pgTable('contadores_fiscais', {
  serie: integer('serie').primaryKey(),
  ultimoNumero: integer('ultimo_numero').notNull().default(0),
})

// Vendas em espera (RF-09) e rascunho de venda em andamento (invariante 4).
export const vendasEspera = pgTable('vendas_espera', {
  id: text('id').primaryKey(),
  payloadJson: text('payload_json').notNull(),
  criadoEm: text('criado_em').notNull(),
})
