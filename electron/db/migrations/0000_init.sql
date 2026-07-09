-- Migration inicial — modelo de dados seção 4 do PRD.
-- Valores monetários em centavos (INTEGER). Datas em ISO-8601 (TEXT).

CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  pin_hash TEXT,
  perfil TEXT NOT NULL CHECK (perfil IN ('admin','supervisor','operador')),
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL
);

CREATE TABLE grupos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE
);

CREATE TABLE produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo_interno TEXT NOT NULL UNIQUE,
  ean TEXT,
  descricao TEXT NOT NULL,
  unidade TEXT NOT NULL DEFAULT 'UN' CHECK (unidade IN ('UN','KG')),
  pesavel INTEGER NOT NULL DEFAULT 0,
  preco_custo INTEGER NOT NULL DEFAULT 0,
  preco_venda INTEGER NOT NULL DEFAULT 0,
  estoque_atual REAL NOT NULL DEFAULT 0,
  estoque_minimo REAL NOT NULL DEFAULT 0,
  grupo_id INTEGER REFERENCES grupos(id),
  imagem_path TEXT,
  ativo INTEGER NOT NULL DEFAULT 0,
  ncm TEXT,
  cest TEXT,
  cfop TEXT,
  origem TEXT,
  csosn TEXT,
  cst_pis TEXT,
  aliq_pis INTEGER,
  cst_cofins TEXT,
  aliq_cofins INTEGER,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX idx_produtos_ean ON produtos(ean);
CREATE INDEX idx_produtos_descricao ON produtos(descricao);

CREATE TABLE caixas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_abertura_id INTEGER NOT NULL REFERENCES usuarios(id),
  valor_abertura INTEGER NOT NULL DEFAULT 0,
  aberto_em TEXT NOT NULL,
  usuario_fechamento_id INTEGER REFERENCES usuarios(id),
  fechado_em TEXT,
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','fechado'))
);

CREATE TABLE movimentos_caixa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caixa_id INTEGER NOT NULL REFERENCES caixas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('sangria','suprimento','abertura','fechamento')),
  valor INTEGER NOT NULL,
  motivo TEXT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  autorizado_por_id INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);

CREATE TABLE vendas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caixa_id INTEGER NOT NULL REFERENCES caixas(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  cliente_cpf TEXT,
  subtotal INTEGER NOT NULL,
  desconto INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'finalizada' CHECK (status IN ('aberta','finalizada','cancelada')),
  criado_em TEXT NOT NULL,
  cancelada_em TEXT,
  cancelada_por_id INTEGER REFERENCES usuarios(id)
);
CREATE INDEX idx_vendas_criado ON vendas(criado_em);

CREATE TABLE venda_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venda_id INTEGER NOT NULL REFERENCES vendas(id),
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  descricao TEXT NOT NULL,
  quantidade REAL NOT NULL,
  peso REAL,
  preco_unitario INTEGER NOT NULL,
  desconto INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL
);

CREATE TABLE venda_pagamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venda_id INTEGER NOT NULL REFERENCES vendas(id),
  forma TEXT NOT NULL CHECK (forma IN ('dinheiro','debito','credito','pix','voucher')),
  valor INTEGER NOT NULL,
  troco INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE documentos_fiscais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venda_id INTEGER NOT NULL REFERENCES vendas(id),
  modelo INTEGER NOT NULL DEFAULT 65,
  serie INTEGER NOT NULL DEFAULT 1,
  numero INTEGER NOT NULL,
  chave_acesso TEXT,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','autorizada','contingencia_pendente','rejeitada','cancelada','inutilizada')),
  protocolo TEXT,
  xml_path TEXT,
  motivo_rejeicao TEXT,
  emitida_em TEXT,
  autorizada_em TEXT,
  cancelada_em TEXT
);
CREATE INDEX idx_docfiscais_status ON documentos_fiscais(status);

CREATE TABLE estoque_movimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('venda','estorno_venda','entrada','ajuste_inventario')),
  quantidade REAL NOT NULL,
  referencia_id INTEGER,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);

CREATE TABLE auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES usuarios(id),
  acao TEXT NOT NULL,
  detalhe_json TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE contadores_fiscais (
  serie INTEGER PRIMARY KEY,
  ultimo_numero INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE vendas_espera (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
