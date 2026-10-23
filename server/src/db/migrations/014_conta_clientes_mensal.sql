-- ============================================================
-- Mercury PDV 1.3.1 - Migração 014: Conta de clientes "Compra Mensal"
-- ============================================================
-- Cliente da casa (nome obrigatório; código CM-NNNN, telefone, e-mail,
-- endereço e limite opcionais), lançamentos de débito de consumo com
-- assinatura digital (PNG colhido no celular e salvo em public/uploads),
-- pagamentos de quitação (total/parcial) e parcelas programadas (acordos).
-- Permissão nova: pode_gerenciar_conta_clientes (admin, caixa e proprietário).

CREATE TABLE IF NOT EXISTS clientes_mensal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  endereco TEXT NOT NULL DEFAULT '',
  limite_centavos INTEGER,
  bloqueado INTEGER NOT NULL DEFAULT 0,
  criado_por INTEGER,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT
);

CREATE TABLE IF NOT EXISTS mensal_lancamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes_mensal(id),
  quantidade INTEGER NOT NULL DEFAULT 1 CHECK (quantidade >= 1),
  consumo TEXT NOT NULL,
  data_hora TEXT NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos >= 0),
  assinatura_path TEXT NOT NULL DEFAULT '',
  criado_por INTEGER,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mensal_pagamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes_mensal(id),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  forma TEXT NOT NULL CHECK (forma IN ('dinheiro','pix','cartao_debito','cartao_credito','vale_refeicao')),
  status TEXT NOT NULL DEFAULT 'pago' CHECK (status IN ('pago','pendente')),
  vencimento TEXT,
  parcela_de INTEGER,
  pago_em TEXT,
  criado_por INTEGER,
  criado_em TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mensal_lancamentos_cliente ON mensal_lancamentos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_mensal_pagamentos_cliente ON mensal_pagamentos(cliente_id);

ALTER TABLE permissoes ADD COLUMN pode_gerenciar_conta_clientes INTEGER NOT NULL DEFAULT 0;
UPDATE permissoes SET pode_gerenciar_conta_clientes = 1 WHERE cargo IN ('admin','caixa','proprietario');
