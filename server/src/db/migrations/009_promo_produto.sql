-- ============================================================
-- Mercury PDV 1.3 - Migração 009: Promoção por produto
-- Desconto percentual ou preço fixo por produto, com janela
-- (dias da semana + faixa horária + vigência) e limite de usos.
-- Aplicada automaticamente no preço de venda dentro da janela.
-- ============================================================

CREATE TABLE promocoes_produto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('percentual','preco_fixo')),
  desconto_percentual INTEGER CHECK (desconto_percentual IS NULL OR (desconto_percentual > 0 AND desconto_percentual <= 100)),
  preco_fixo_centavos INTEGER CHECK (preco_fixo_centavos IS NULL OR preco_fixo_centavos >= 0),
  dias_semana TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
  hora_ini TEXT,
  hora_fim TEXT,
  valido_de TEXT,
  valido_ate TEXT,
  limite_usos INTEGER CHECK (limite_usos IS NULL OR limite_usos > 0),
  usos INTEGER NOT NULL DEFAULT 0 CHECK (usos >= 0),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);
CREATE INDEX idx_promo_prod ON promocoes_produto(produto_id, ativo);

ALTER TABLE pedido_itens ADD COLUMN promocao_id INTEGER REFERENCES promocoes_produto(id);
