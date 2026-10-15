-- ============================================================
-- Mercury PDV 1.3 - Migração 001: schema inicial
-- Dinheiro em centavos inteiros (INTEGER). Datas em ISO-8601 UTC (TEXT).
-- ============================================================

CREATE TABLE configuracao (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  atualizado_por INTEGER REFERENCES usuarios(id)
);

CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  cargo TEXT NOT NULL CHECK (cargo IN ('admin','caixa','garcom','cozinha')),
  pin_hash TEXT,
  senha_hash TEXT,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  falhas_login INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate TEXT,
  ultimo_login TEXT,
  criado_em TEXT NOT NULL,
  criado_por INTEGER REFERENCES usuarios(id),
  CHECK (pin_hash IS NOT NULL OR senha_hash IS NOT NULL)
);

CREATE TABLE permissoes (
  cargo TEXT PRIMARY KEY CHECK (cargo IN ('admin','caixa','garcom','cozinha')),
  pode_vender_balcao INTEGER NOT NULL DEFAULT 0,
  pode_dividir_pagar INTEGER NOT NULL DEFAULT 0,
  pode_abrir_fechar_caixa INTEGER NOT NULL DEFAULT 0,
  pode_sangria_suprimento INTEGER NOT NULL DEFAULT 0,
  pode_cancelar_item INTEGER NOT NULL DEFAULT 0,
  pode_lancar_comanda INTEGER NOT NULL DEFAULT 0,
  pode_ver_kds INTEGER NOT NULL DEFAULT 0,
  pode_avancar_kds INTEGER NOT NULL DEFAULT 0,
  pode_gerenciar_produtos INTEGER NOT NULL DEFAULT 0,
  pode_gerenciar_usuarios INTEGER NOT NULL DEFAULT 0,
  pode_ver_relatorios INTEGER NOT NULL DEFAULT 0,
  pode_gerenciar_mesas INTEGER NOT NULL DEFAULT 0,
  pode_desconto INTEGER NOT NULL DEFAULT 0,
  pode_estoque_gerenciar INTEGER NOT NULL DEFAULT 0,
  pode_config_sistema INTEGER NOT NULL DEFAULT 0,
  pode_backup INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessoes (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  ultimo_uso TEXT NOT NULL,
  revogada INTEGER NOT NULL DEFAULT 0 CHECK (revogada IN (0,1)),
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessoes_usuario ON sessoes(usuario_id);

CREATE TABLE caixa_sessoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_abertura INTEGER NOT NULL REFERENCES usuarios(id),
  aberto_em TEXT NOT NULL,
  fechado_em TEXT,
  saldo_inicial_centavos INTEGER NOT NULL CHECK (saldo_inicial_centavos >= 0),
  status TEXT NOT NULL CHECK (status IN ('aberto','fechado')),
  usuario_fechamento INTEGER REFERENCES usuarios(id),
  conferencia_json TEXT,
  divergencia_dinheiro_centavos INTEGER,
  observacoes TEXT
);
CREATE INDEX idx_caixa_status ON caixa_sessoes(status);

CREATE TABLE caixa_movimentacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessao_id INTEGER NOT NULL REFERENCES caixa_sessoes(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('suprimento','sangria')),
  forma TEXT NOT NULL CHECK (forma IN ('dinheiro','pix','cartao_debito','cartao_credito','vale_refeicao')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  motivo TEXT NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  autorizado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);

CREATE TABLE categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

CREATE TABLE produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria_id INTEGER NOT NULL REFERENCES categorias(id),
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
  custo_centavos INTEGER CHECK (custo_centavos IS NULL OR custo_centavos >= 0),
  area TEXT NOT NULL DEFAULT 'cozinha' CHECK (area IN ('cozinha','bar')),
  tempo_preparo_min INTEGER NOT NULL DEFAULT 10 CHECK (tempo_preparo_min >= 0),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em TEXT NOT NULL
);
CREATE INDEX idx_produtos_categoria ON produtos(categoria_id);

CREATE TABLE adicionais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

CREATE TABLE produto_adicionais (
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  adicional_id INTEGER NOT NULL REFERENCES adicionais(id),
  PRIMARY KEY (produto_id, adicional_id)
);

CREATE TABLE mesas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero INTEGER NOT NULL UNIQUE CHECK (numero > 0),
  setor TEXT NOT NULL DEFAULT 'salao',
  status TEXT NOT NULL DEFAULT 'livre' CHECK (status IN ('livre','ocupada','fechando')),
  criado_em TEXT NOT NULL
);

CREATE TABLE pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('balcao','mesa')),
  mesa_id INTEGER REFERENCES mesas(id),
  comanda_nome TEXT,
  garcom_id INTEGER REFERENCES usuarios(id),
  caixa_sessao_id INTEGER REFERENCES caixa_sessoes(id),
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','fechado','cancelado')),
  desconto_centavos INTEGER NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  desconto_motivo TEXT,
  desconto_usuario_id INTEGER REFERENCES usuarios(id),
  aberto_em TEXT NOT NULL,
  fechado_em TEXT,
  fechado_por INTEGER REFERENCES usuarios(id),
  total_fechado_centavos INTEGER,
  idempotency_key TEXT UNIQUE,
  criado_em TEXT NOT NULL,
  CHECK (tipo != 'mesa' OR mesa_id IS NOT NULL)
);
CREATE UNIQUE INDEX idx_pedido_aberto_por_mesa ON pedidos(mesa_id) WHERE status = 'aberto' AND mesa_id IS NOT NULL;

CREATE TABLE pedido_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  nome_produto TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0 AND quantidade < 1000),
  preco_unit_centavos INTEGER NOT NULL CHECK (preco_unit_centavos >= 0),
  observacoes TEXT,
  enviado_cozinha_em TEXT,
  kds_status TEXT CHECK (kds_status IS NULL OR kds_status IN ('pendente','preparando','pronto','entregue')),
  kds_atualizado_em TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','cancelado')),
  cancelado_em TEXT,
  cancelado_por INTEGER REFERENCES usuarios(id),
  cancelamento_motivo TEXT,
  cancelamento_autorizado_por INTEGER REFERENCES usuarios(id),
  idempotency_key TEXT UNIQUE,
  criado_em TEXT NOT NULL
);
CREATE INDEX idx_itens_pedido ON pedido_itens(pedido_id);
CREATE INDEX idx_itens_kds ON pedido_itens(kds_status, enviado_cozinha_em);

CREATE TABLE pedido_item_adicionais (
  item_id INTEGER NOT NULL REFERENCES pedido_itens(id),
  adicional_id INTEGER NOT NULL REFERENCES adicionais(id),
  nome TEXT NOT NULL,
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
  quantidade INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  PRIMARY KEY (item_id, adicional_id)
);

CREATE TABLE pagamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  caixa_sessao_id INTEGER REFERENCES caixa_sessoes(id),
  forma TEXT NOT NULL CHECK (forma IN ('dinheiro','pix','cartao_debito','cartao_credito','vale_refeicao')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  recebido_centavos INTEGER CHECK (recebido_centavos IS NULL OR recebido_centavos >= valor_centavos),
  troco_centavos INTEGER NOT NULL DEFAULT 0 CHECK (troco_centavos >= 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  estornado INTEGER NOT NULL DEFAULT 0 CHECK (estornado IN (0,1)),
  estornado_em TEXT,
  estorno_motivo TEXT,
  estornado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);
CREATE INDEX idx_pagamentos_pedido ON pagamentos(pedido_id);

CREATE TABLE recibos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  numero INTEGER NOT NULL UNIQUE,
  tipo TEXT NOT NULL CHECK (tipo IN ('cliente','cozinha')),
  largura_mm INTEGER NOT NULL CHECK (largura_mm IN (58,80)),
  conteudo_json TEXT NOT NULL,
  emitido_por INTEGER NOT NULL REFERENCES usuarios(id),
  emitido_em TEXT NOT NULL
);
CREATE INDEX idx_recibos_pedido ON recibos(pedido_id);

CREATE TABLE ingredientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  unidade TEXT NOT NULL DEFAULT 'g' CHECK (unidade IN ('g','ml','un')),
  quantidade_mil INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_mil >= -2147483648),
  minimo_mil INTEGER NOT NULL DEFAULT 0 CHECK (minimo_mil >= 0),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

CREATE TABLE produto_ingredientes (
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id),
  quantidade_mil INTEGER NOT NULL CHECK (quantidade_mil > 0),
  PRIMARY KEY (produto_id, ingrediente_id)
);

CREATE TABLE estoque_movimentacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada','saida_venda','perda','ajuste','devolucao')),
  quantidade_mil INTEGER NOT NULL CHECK (quantidade_mil > 0),
  saldo_apos_mil INTEGER NOT NULL,
  ref_tipo TEXT,
  ref_id INTEGER,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  observacao TEXT,
  criado_em TEXT NOT NULL,
  UNIQUE (tipo, ref_tipo, ref_id, ingrediente_id)
);

CREATE TABLE auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES usuarios(id),
  acao TEXT NOT NULL,
  entidade TEXT,
  entidade_id TEXT,
  detalhes TEXT,
  ip TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX idx_auditoria_acao ON auditoria(acao);
CREATE INDEX idx_auditoria_entidade ON auditoria(entidade, entidade_id);

-- Sequência global monotônica de eventos WebSocket (KDS em tempo real).
CREATE TABLE eventos (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  payload TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

-- Append-only: auditoria e movimentações financeiras/estoque não podem ser alteradas ou apagadas.
CREATE TRIGGER auditoria_no_update BEFORE UPDATE ON auditoria BEGIN SELECT RAISE(ABORT, 'auditoria e append-only'); END;
CREATE TRIGGER auditoria_no_delete BEFORE DELETE ON auditoria BEGIN SELECT RAISE(ABORT, 'auditoria e append-only'); END;
CREATE TRIGGER caixa_mov_no_update BEFORE UPDATE ON caixa_movimentacoes BEGIN SELECT RAISE(ABORT, 'movimentacao de caixa e imutavel'); END;
CREATE TRIGGER caixa_mov_no_delete BEFORE DELETE ON caixa_movimentacoes BEGIN SELECT RAISE(ABORT, 'movimentacao de caixa e imutavel'); END;
CREATE TRIGGER estoque_mov_no_update BEFORE UPDATE ON estoque_movimentacoes BEGIN SELECT RAISE(ABORT, 'movimentacao de estoque e imutavel'); END;
CREATE TRIGGER estoque_mov_no_delete BEFORE DELETE ON estoque_movimentacoes BEGIN SELECT RAISE(ABORT, 'movimentacao de estoque e imutavel'); END;

INSERT INTO permissoes (cargo, pode_vender_balcao, pode_dividir_pagar, pode_abrir_fechar_caixa, pode_sangria_suprimento,
  pode_cancelar_item, pode_lancar_comanda, pode_ver_kds, pode_avancar_kds, pode_gerenciar_produtos, pode_gerenciar_usuarios,
  pode_ver_relatorios, pode_gerenciar_mesas, pode_desconto, pode_estoque_gerenciar, pode_config_sistema, pode_backup) VALUES
  ('admin',   1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1),
  ('caixa',   1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  ('garcom',  0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  ('cozinha', 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0);
