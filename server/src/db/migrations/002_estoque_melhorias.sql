-- ============================================================
-- Mercury PDV 1.3 - Migração 002: Melhorias Estoque
-- Fornecedores, Lotes, Validade, Inventário, Previsão
-- ============================================================

-- Fornecedores
CREATE TABLE fornecedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  cnpj TEXT,
  telefone TEXT,
  email TEXT,
  endereco TEXT,
  observacao TEXT,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em TEXT NOT NULL
);

-- Relacionamento Fornecedor x Ingrediente (preço, prazo, última compra)
CREATE TABLE fornecedor_ingredientes (
  fornecedor_id INTEGER NOT NULL REFERENCES fornecedores(id),
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id),
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
  unidade_compra TEXT NOT NULL DEFAULT 'kg' CHECK (unidade_compra IN ('kg','g','l','ml','un','cx','pct')),
  fator_conversao INTEGER NOT NULL DEFAULT 1000 CHECK (fator_conversao > 0), -- ex: 1 kg = 1000 g
  prazo_dias INTEGER NOT NULL DEFAULT 0 CHECK (prazo_dias >= 0),
  ultima_compra_em TEXT,
  ultima_qtd_mil INTEGER,
  observacao TEXT,
  PRIMARY KEY (fornecedor_id, ingrediente_id)
);

-- Lotes de Estoque (para validade/FIFO)
CREATE TABLE estoque_lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id),
  lote TEXT NOT NULL,
  validade TEXT, -- ISO date
  quantidade_mil INTEGER NOT NULL CHECK (quantidade_mil >= 0),
  custo_centavos INTEGER CHECK (custo_centavos IS NULL OR custo_centavos >= 0),
  fornecedor_id INTEGER REFERENCES fornecedores(id),
  entrada_id INTEGER REFERENCES estoque_movimentacoes(id),
  criado_em TEXT NOT NULL,
  UNIQUE (ingrediente_id, lote)
);
CREATE INDEX idx_lotes_validade ON estoque_lotes(validade);
CREATE INDEX idx_lotes_ingrediente ON estoque_lotes(ingrediente_id);

-- Inventários (contagem cíclica)
CREATE TABLE inventarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL, -- ex: "Inventário Janeiro 2026", "Contagem Cíclica Semanal"
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','em_andamento','finalizado','cancelado')),
  tipo TEXT NOT NULL DEFAULT 'completo' CHECK (tipo IN ('completo','ciclico','spot')),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  observacao TEXT,
  criado_em TEXT NOT NULL,
  finalizado_em TEXT
);

CREATE TABLE inventario_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventario_id INTEGER NOT NULL REFERENCES inventarios(id),
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id),
  quantidade_sistema_mil INTEGER NOT NULL,
  quantidade_contada_mil INTEGER,
  divergencia_mil INTEGER,
  usuario_contagem_id INTEGER REFERENCES usuarios(id),
  contado_em TEXT,
  observacao TEXT,
  UNIQUE (inventario_id, ingrediente_id)
);

-- Previsão de consumo (cache calculado)
CREATE TABLE estoque_previsao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id),
  periodo_dias INTEGER NOT NULL DEFAULT 30,
  consumo_medio_dia_mil REAL NOT NULL,
  dias_estoque REAL,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','atencao','critico','ruptura')),
  calculado_em TEXT NOT NULL,
  UNIQUE (ingrediente_id, periodo_dias)
);

-- Versões de Ficha Técnica
CREATE TABLE ficha_tecnica_versoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  versao INTEGER NOT NULL,
  itens_json TEXT NOT NULL, -- JSON com [{ingrediente_id, quantidade_mil}]
  custo_total_centavos INTEGER,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  observacao TEXT,
  criado_em TEXT NOT NULL,
  UNIQUE (produto_id, versao)
);

-- Configurações de Estoque (novas chaves)
INSERT OR IGNORE INTO configuracao (chave, valor, atualizado_em, atualizado_por) VALUES
  ('estoque_alerta_dias_validade', '3', datetime('now'), NULL),
  ('estoque_previsao_periodo_dias', '30', datetime('now'), NULL),
  ('estoque_inventario_ciclico_qtd', '10', datetime('now'), NULL),
  ('estoque_bloquear_venda_sem_estoque', '0', datetime('now'), NULL),
  ('estoque_permitir_negativo', '1', datetime('now'), NULL);