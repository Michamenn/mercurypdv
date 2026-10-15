-- ============================================================
-- Mercury PDV 1.3 - Migração 005: Cardápio inteligente (A1)
-- Tipos, variações com preço, apelidos, código de barras,
-- indisponibilidade com motivo, histórico de preço com vigência,
-- períodos de cardápio e snapshot de variação no item vendido.
-- ============================================================

ALTER TABLE produtos ADD COLUMN tipo_item TEXT NOT NULL DEFAULT 'lanche'
  CHECK (tipo_item IN ('lanche','prato','porcao','bebida','sobremesa','servico','outro'));
ALTER TABLE produtos ADD COLUMN codigo_barras TEXT;
CREATE UNIQUE INDEX idx_produtos_codigo_barras ON produtos(codigo_barras);
ALTER TABLE produtos ADD COLUMN apelidos TEXT;
ALTER TABLE produtos ADD COLUMN indisponivel_motivo TEXT;

-- Variações do produto (tamanho P/M/G, ponto da carne, sabor) com delta de preço
CREATE TABLE produto_variacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  grupo TEXT NOT NULL DEFAULT 'opcao',
  nome TEXT NOT NULL,
  delta_centavos INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  UNIQUE (produto_id, nome)
);
CREATE INDEX idx_variacoes_produto ON produto_variacoes(produto_id);

-- Histórico de preço com vigência (passado = aplicado; futuro = programado)
CREATE TABLE preco_historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
  valido_de TEXT NOT NULL,
  aplicado INTEGER NOT NULL DEFAULT 0 CHECK (aplicado IN (0,1)),
  criado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);
CREATE INDEX idx_preco_hist ON preco_historico(produto_id, valido_de);

-- Períodos de cardápio (Almoço, Happy Hour, Jantar). dias: 0=domingo..6=sábado
CREATE TABLE periodos_cardapio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  dias TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
  hora_ini TEXT NOT NULL,
  hora_fim TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

-- Vínculo produto×período. Sem vínculo = disponível sempre.
CREATE TABLE produto_periodos (
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  periodo_id INTEGER NOT NULL REFERENCES periodos_cardapio(id) ON DELETE CASCADE,
  PRIMARY KEY (produto_id, periodo_id)
);

-- Snapshot da variação no item vendido (auditoria do que foi cobrado)
ALTER TABLE pedido_itens ADD COLUMN variacao_nome TEXT;
ALTER TABLE pedido_itens ADD COLUMN variacao_delta_centavos INTEGER NOT NULL DEFAULT 0;
