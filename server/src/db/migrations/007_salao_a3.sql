-- ============================================================
-- Mercury PDV 1.3 - Migração 007: Salão e fechamento (A3)
-- Numeração da comanda por dia, canal viagem, guardar/retomar,
-- observação da comanda, bloqueio de mesa, divisão por pessoas,
-- chamado de garçom, fechamento de salão com assinatura.
-- ============================================================

ALTER TABLE pedidos ADD COLUMN canal TEXT NOT NULL DEFAULT 'salao'
  CHECK (canal IN ('salao','viagem'));
ALTER TABLE pedidos ADD COLUMN guardado INTEGER NOT NULL DEFAULT 0
  CHECK (guardado IN (0,1));
ALTER TABLE pedidos ADD COLUMN numero_dia INTEGER;
ALTER TABLE pedidos ADD COLUMN observacao TEXT;
CREATE UNIQUE INDEX idx_pedido_numero_dia ON pedidos(numero_dia) WHERE numero_dia IS NOT NULL;

ALTER TABLE mesas ADD COLUMN bloqueada INTEGER NOT NULL DEFAULT 0
  CHECK (bloqueada IN (0,1));
ALTER TABLE mesas ADD COLUMN bloqueio_motivo TEXT;

ALTER TABLE permissoes ADD COLUMN pode_brinde INTEGER NOT NULL DEFAULT 0
  CHECK (pode_brinde IN (0,1));
UPDATE permissoes SET pode_brinde = 1 WHERE cargo = 'admin';

-- Grupos de divisão da conta (Pessoa A, Pessoa B, Compartilhado...)
CREATE TABLE pedido_grupos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  UNIQUE (pedido_id, nome)
);

-- Atribuição de (parte de) itens aos grupos
CREATE TABLE pedido_grupo_itens (
  grupo_id INTEGER NOT NULL REFERENCES pedido_grupos(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES pedido_itens(id) ON DELETE CASCADE,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  PRIMARY KEY (grupo_id, item_id)
);

-- Chamado de garçom / apoio por mesa
CREATE TABLE chamados_garcom (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mesa_id INTEGER NOT NULL REFERENCES mesas(id),
  pedido_id INTEGER REFERENCES pedidos(id),
  tipo TEXT NOT NULL DEFAULT 'chamar' CHECK (tipo IN ('chamar','conta','apoio')),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','atendido')),
  criado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL,
  atendido_em TEXT,
  atendido_por INTEGER REFERENCES usuarios(id)
);
CREATE INDEX idx_chamados_status ON chamados_garcom(status, criado_em);

-- Fechamento de salão com assinatura do responsável
CREATE TABLE fechamentos_salao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  periodo_de TEXT NOT NULL,
  periodo_ate TEXT NOT NULL,
  responsavel_id INTEGER NOT NULL REFERENCES usuarios(id),
  assinatura_png TEXT NOT NULL,
  resumo_json TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
