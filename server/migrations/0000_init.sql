-- Schema Postgres do PDV Mercado (espelho de electron/db/migrations/0000_init.sql).
-- Dinheiro em centavos (integer). Datas ISO-8601 em text — os relatórios comparam
-- lexicograficamente. Quantidades em double precision (o `real` do PG é f32).
-- Idempotente: pode rodar de novo sem quebrar.

CREATE TABLE IF NOT EXISTS usuarios (
  id           serial PRIMARY KEY,
  nome         text NOT NULL,
  login        text NOT NULL UNIQUE,
  senha_hash   text NOT NULL,
  pin_hash     text,
  perfil       text NOT NULL CHECK (perfil IN ('admin','supervisor','operador')),
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    text NOT NULL
);

CREATE TABLE IF NOT EXISTS grupos (
  id   serial PRIMARY KEY,
  nome text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS produtos (
  id              serial PRIMARY KEY,
  codigo_interno  text NOT NULL UNIQUE,
  ean             text,
  descricao       text NOT NULL,
  unidade         text NOT NULL DEFAULT 'UN' CHECK (unidade IN ('UN','KG')),
  pesavel         boolean NOT NULL DEFAULT false,
  preco_custo     integer NOT NULL DEFAULT 0,
  preco_venda     integer NOT NULL DEFAULT 0,
  estoque_atual   double precision NOT NULL DEFAULT 0,
  estoque_minimo  double precision NOT NULL DEFAULT 0,
  grupo_id        integer REFERENCES grupos(id),
  imagem_path     text,
  ativo           boolean NOT NULL DEFAULT false,
  ncm             text,
  cest            text,
  cfop            text,
  origem          text,
  csosn           text,
  cst_pis         text,
  aliq_pis        integer,
  cst_cofins      text,
  aliq_cofins     integer,
  criado_em       text NOT NULL,
  atualizado_em   text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_produtos_ean ON produtos(ean);
CREATE INDEX IF NOT EXISTS idx_produtos_descricao ON produtos(descricao);

CREATE TABLE IF NOT EXISTS caixas (
  id                     serial PRIMARY KEY,
  usuario_abertura_id    integer NOT NULL REFERENCES usuarios(id),
  valor_abertura         integer NOT NULL DEFAULT 0,
  aberto_em              text NOT NULL,
  usuario_fechamento_id  integer REFERENCES usuarios(id),
  fechado_em             text,
  status                 text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','fechado'))
);

CREATE TABLE IF NOT EXISTS movimentos_caixa (
  id                 serial PRIMARY KEY,
  caixa_id           integer NOT NULL REFERENCES caixas(id),
  tipo               text NOT NULL CHECK (tipo IN ('sangria','suprimento','abertura','fechamento')),
  valor              integer NOT NULL,
  motivo             text,
  usuario_id         integer NOT NULL REFERENCES usuarios(id),
  autorizado_por_id  integer REFERENCES usuarios(id),
  criado_em          text NOT NULL
);

CREATE TABLE IF NOT EXISTS vendas (
  id                serial PRIMARY KEY,
  caixa_id          integer NOT NULL REFERENCES caixas(id),
  usuario_id        integer NOT NULL REFERENCES usuarios(id),
  cliente_cpf       text,
  subtotal          integer NOT NULL,
  desconto          integer NOT NULL DEFAULT 0,
  total             integer NOT NULL,
  status            text NOT NULL DEFAULT 'finalizada' CHECK (status IN ('aberta','finalizada','cancelada')),
  criado_em         text NOT NULL,
  cancelada_em      text,
  cancelada_por_id  integer REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_vendas_criado ON vendas(criado_em);

CREATE TABLE IF NOT EXISTS venda_itens (
  id              serial PRIMARY KEY,
  venda_id        integer NOT NULL REFERENCES vendas(id),
  produto_id      integer NOT NULL REFERENCES produtos(id),
  descricao       text NOT NULL,
  quantidade      double precision NOT NULL,
  peso            double precision,
  preco_unitario  integer NOT NULL,
  desconto        integer NOT NULL DEFAULT 0,
  total           integer NOT NULL
);

CREATE TABLE IF NOT EXISTS venda_pagamentos (
  id        serial PRIMARY KEY,
  venda_id  integer NOT NULL REFERENCES vendas(id),
  forma     text NOT NULL CHECK (forma IN ('dinheiro','debito','credito','pix','voucher')),
  valor     integer NOT NULL,
  troco     integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS documentos_fiscais (
  id               serial PRIMARY KEY,
  venda_id         integer NOT NULL REFERENCES vendas(id),
  modelo           integer NOT NULL DEFAULT 65,
  serie            integer NOT NULL DEFAULT 1,
  numero           integer NOT NULL,
  chave_acesso     text,
  status           text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','autorizada','contingencia_pendente','rejeitada','cancelada','inutilizada')),
  protocolo        text,
  xml_path         text,
  motivo_rejeicao  text,
  emitida_em       text,
  autorizada_em    text,
  cancelada_em     text
);
CREATE INDEX IF NOT EXISTS idx_docfiscais_status ON documentos_fiscais(status);

CREATE TABLE IF NOT EXISTS estoque_movimentos (
  id             serial PRIMARY KEY,
  produto_id     integer NOT NULL REFERENCES produtos(id),
  tipo           text NOT NULL CHECK (tipo IN ('venda','estorno_venda','entrada','ajuste_inventario')),
  quantidade     double precision NOT NULL,
  referencia_id  integer,
  usuario_id     integer NOT NULL REFERENCES usuarios(id),
  criado_em      text NOT NULL
);

CREATE TABLE IF NOT EXISTS auditoria (
  id            serial PRIMARY KEY,
  usuario_id    integer REFERENCES usuarios(id),
  acao          text NOT NULL,
  detalhe_json  text,
  criado_em     text NOT NULL
);

CREATE TABLE IF NOT EXISTS configuracoes (
  chave  text PRIMARY KEY,
  valor  text NOT NULL
);

CREATE TABLE IF NOT EXISTS contadores_fiscais (
  serie          integer PRIMARY KEY,
  ultimo_numero  integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vendas_espera (
  id            text PRIMARY KEY,
  payload_json  text NOT NULL,
  criado_em     text NOT NULL
);
