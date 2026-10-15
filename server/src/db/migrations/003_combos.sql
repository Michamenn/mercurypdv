-- ============================================================
-- Mercury PDV 1.3 - Migração 002: Combos/Promoções
-- Entidade dedicada para combos e promoções com regras flexíveis
-- ============================================================

-- Combos: entidade principal
-- tipo: 'preco_fixo' (ex: X+Bebida+Batata por R$ 29,90)
--       'desconto_percentual' (ex: 20% off no combo)
--       'leve_pague' (ex: leve 3 pague 2)
--       'brinde' (ex: compra X ganha Y)
CREATE TABLE combos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  descricao TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('preco_fixo', 'desconto_percentual', 'leve_pague', 'brinde')),
  
  -- Para tipo 'preco_fixo': preço final do combo em centavos
  preco_fixo_centavos INTEGER CHECK (preco_fixo_centavos IS NULL OR preco_fixo_centavos >= 0),
  
  -- Para tipo 'desconto_percentual': % de desconto (ex: 20 = 20%)
  desconto_percentual INTEGER CHECK (desconto_percentual IS NULL OR (desconto_percentual > 0 AND desconto_percentual <= 100)),
  
  -- Para tipo 'leve_pague': leve X pague Y
  leve_quantidade INTEGER CHECK (leve_quantidade IS NULL OR leve_quantidade > 0),
  pague_quantidade INTEGER CHECK (pague_quantidade IS NULL OR pague_quantidade > 0),
  
  -- Para tipo 'brinde': produto brinde (produto_id do brinde)
  brinde_produto_id INTEGER REFERENCES produtos(id),
  
  -- Validade da promoção
  valido_de TEXT,  -- ISO datetime
  valido_ate TEXT, -- ISO datetime
  
  -- Restrições
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  exige_estoque INTEGER NOT NULL DEFAULT 1 CHECK (exige_estoque IN (0,1)), -- valida disponibilidade ingredientes
  criado_em TEXT NOT NULL,
  criado_por INTEGER NOT NULL REFERENCES usuarios(id),
  atualizado_em TEXT,
  atualizado_por INTEGER REFERENCES usuarios(id)
);
CREATE INDEX idx_combos_ativo ON combos(ativo);
CREATE INDEX idx_combos_validade ON combos(valido_de, valido_ate);

-- Itens do combo: produtos que compõem o combo com quantidades
CREATE TABLE combo_itens (
  combo_id INTEGER NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  quantidade INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0 AND quantidade < 1000),
  -- Se true, este item é obrigatório no combo; se false, é opcional (ex: escolha 1 bebida)
  obrigatorio INTEGER NOT NULL DEFAULT 1 CHECK (obrigatorio IN (0,1)),
  -- Grupo de escolha: para itens opcionais, agrupa alternativas (ex: grupo 1 = bebidas, escolhe 1)
  grupo_escolha INTEGER CHECK (grupo_escolha IS NULL OR grupo_escolha > 0),
  -- Máximo de itens deste grupo que podem ser escolhidos (para grupos de escolha)
  max_escolhas INTEGER CHECK (max_escolhas IS NULL OR max_escolhas > 0),
  PRIMARY KEY (combo_id, produto_id)
);
CREATE INDEX idx_combo_itens_combo ON combo_itens(combo_id);

-- Permissão para gerenciar combos (adiciona coluna na tabela permissoes)
-- Adiciona coluna pode_gerenciar_combos com default 0
ALTER TABLE permissoes ADD COLUMN pode_gerenciar_combos INTEGER NOT NULL DEFAULT 0 CHECK (pode_gerenciar_combos IN (0,1));

-- Atualiza permissões existentes
-- Admin: 1, Caixa: 0, Garçom: 0, Cozinha: 0
UPDATE permissoes SET pode_gerenciar_combos = 1 WHERE cargo = 'admin';
UPDATE permissoes SET pode_gerenciar_combos = 0 WHERE cargo = 'caixa';
UPDATE permissoes SET pode_gerenciar_combos = 0 WHERE cargo = 'garcom';
UPDATE permissoes SET pode_gerenciar_combos = 0 WHERE cargo = 'cozinha';