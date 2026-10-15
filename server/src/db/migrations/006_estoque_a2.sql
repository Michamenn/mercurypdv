-- ============================================================
-- Mercury PDV 1.3 - Migração 006: Estoque profissional (A2)
-- Perda na ficha, rendimento, locais, lotes/validade, tipos de
-- movimentação expandidos, inventário rotativo, barris de chopp.
-- ============================================================

-- Perda de preparo % na ficha + rendimento (porções) no produto
ALTER TABLE produto_ingredientes ADD COLUMN perda_pct REAL NOT NULL DEFAULT 0
  CHECK (perda_pct >= 0 AND perda_pct <= 100);
ALTER TABLE produtos ADD COLUMN rendimento_porcoes INTEGER NOT NULL DEFAULT 1
  CHECK (rendimento_porcoes >= 1);

-- Rebuild de estoque_movimentacoes: tipos expandidos + local/origem/destino + custo
ALTER TABLE estoque_movimentacoes RENAME TO estoque_movimentacoes_old;
CREATE TABLE estoque_movimentacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada','saida_venda','perda','ajuste','devolucao','transferencia','producao','sobra','quebra','vencimento','inventario')),
  quantidade_mil INTEGER NOT NULL CHECK (quantidade_mil > 0),
  saldo_apos_mil INTEGER NOT NULL,
  local TEXT CHECK (local IS NULL OR local IN ('deposito','camara_fria','bar','salao')),
  origem TEXT CHECK (origem IS NULL OR origem IN ('deposito','camara_fria','bar','salao')),
  destino TEXT CHECK (destino IS NULL OR destino IN ('deposito','camara_fria','bar','salao')),
  custo_total_centavos INTEGER CHECK (custo_total_centavos IS NULL OR custo_total_centavos >= 0),
  ref_tipo TEXT,
  ref_id INTEGER,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  observacao TEXT,
  criado_em TEXT NOT NULL,
  UNIQUE (tipo, ref_tipo, ref_id, ingrediente_id)
);
INSERT INTO estoque_movimentacoes (id, ingrediente_id, tipo, quantidade_mil, saldo_apos_mil, ref_tipo, ref_id, usuario_id, observacao, criado_em)
  SELECT id, ingrediente_id, tipo, quantidade_mil, saldo_apos_mil, ref_tipo, ref_id, usuario_id, observacao, criado_em
  FROM estoque_movimentacoes_old;
DROP TABLE estoque_movimentacoes_old;
CREATE TRIGGER estoque_mov_no_update BEFORE UPDATE ON estoque_movimentacoes BEGIN SELECT RAISE(ABORT, 'movimentacao de estoque e imutavel'); END;
CREATE TRIGGER estoque_mov_no_delete BEFORE DELETE ON estoque_movimentacoes BEGIN SELECT RAISE(ABORT, 'movimentacao de estoque e imutavel'); END;
CREATE INDEX idx_estmov_ing ON estoque_movimentacoes(ingrediente_id, id);

-- Saldo por local (depósito, câmara fria, bar, salão)
CREATE TABLE ingrediente_locais (
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id) ON DELETE CASCADE,
  local TEXT NOT NULL CHECK (local IN ('deposito','camara_fria','bar','salao')),
  quantidade_mil INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_mil >= 0),
  PRIMARY KEY (ingrediente_id, local)
);
INSERT INTO ingrediente_locais (ingrediente_id, local, quantidade_mil)
  SELECT id, 'deposito', quantidade_mil FROM ingredientes;

-- Lotes com validade e local (A2): rebuild da tabela da migração 002 —
-- adiciona `local` e `custo_unit_centavos`, remove o UNIQUE(ingrediente_id, lote)
-- (lotes genéricos como 'avulso'/'ajuste' se repetem por ingrediente).
-- FIFO na baixa; vencidos bloqueiam venda.
ALTER TABLE estoque_lotes RENAME TO estoque_lotes_old;
CREATE TABLE estoque_lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id),
  lote TEXT NOT NULL DEFAULT 'avulso',
  validade TEXT,
  local TEXT NOT NULL DEFAULT 'deposito' CHECK (local IN ('deposito','camara_fria','bar','salao')),
  quantidade_mil INTEGER NOT NULL CHECK (quantidade_mil >= 0),
  custo_centavos INTEGER CHECK (custo_centavos IS NULL OR custo_centavos >= 0),
  custo_unit_centavos INTEGER CHECK (custo_unit_centavos IS NULL OR custo_unit_centavos >= 0),
  fornecedor_id INTEGER REFERENCES fornecedores(id),
  entrada_id INTEGER REFERENCES estoque_movimentacoes(id),
  criado_em TEXT NOT NULL
);
INSERT INTO estoque_lotes (id, ingrediente_id, lote, validade, local, quantidade_mil, custo_centavos, custo_unit_centavos, fornecedor_id, entrada_id, criado_em)
  SELECT id, ingrediente_id, lote, validade, 'deposito', quantidade_mil, custo_centavos, NULL, fornecedor_id, entrada_id, criado_em
  FROM estoque_lotes_old;
DROP TABLE estoque_lotes_old;
CREATE INDEX idx_lotes_ing ON estoque_lotes(ingrediente_id, validade, id);
INSERT INTO estoque_lotes (ingrediente_id, lote, validade, local, quantidade_mil, criado_em)
  SELECT i.id, 'avulso', NULL, 'deposito', i.quantidade_mil, datetime('now')
  FROM ingredientes i
  WHERE i.quantidade_mil > 0
    AND NOT EXISTS (SELECT 1 FROM estoque_lotes l WHERE l.ingrediente_id = i.id);

-- Inventário rotativo (contagens cegas com divergência)
CREATE TABLE inventario_contagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id),
  local TEXT,
  esperado_mil INTEGER NOT NULL,
  contado_mil INTEGER NOT NULL CHECK (contado_mil >= 0),
  diferenca_mil INTEGER NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  observacao TEXT,
  criado_em TEXT NOT NULL
);

-- Barris de chopp (controle de giro e ruptura)
CREATE TABLE barris (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rotulo TEXT NOT NULL,
  tipo_chopp TEXT NOT NULL DEFAULT 'pilsen',
  numero TEXT,
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id),
  capacidade_ml INTEGER NOT NULL CHECK (capacidade_ml > 0),
  instalado_em TEXT NOT NULL,
  esgotado_em TEXT,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_por INTEGER REFERENCES usuarios(id)
);
CREATE INDEX idx_barris_ing ON barris(ingrediente_id, ativo);
