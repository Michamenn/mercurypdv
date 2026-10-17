-- ============================================================
-- Mercury PDV 1.3.1 - Migração 012: impressoras térmicas e notificações
-- (1) Impressoras: cadastro de dispositivos USB/Bluetooth/Rede IP com bobina
--     58/80mm, cabeçalho/rodapé customizados e vias.
-- (2) Notificações: sino de pedidos prontos para garçons/atendentes,
--     com contagem de não lidas e limpeza.
-- ============================================================

CREATE TABLE impressoras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  conexao TEXT NOT NULL CHECK (conexao IN ('usb','bluetooth','rede')),
  endereco TEXT,
  largura_mm INTEGER NOT NULL DEFAULT 80 CHECK (largura_mm IN (58,80)),
  cabecalho TEXT,
  rodape TEXT,
  vias INTEGER NOT NULL DEFAULT 1 CHECK (vias IN (1,2)),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT
);
CREATE INDEX idx_impressoras_ativas ON impressoras(ativo, nome);

-- Notificações do sino (feed do estabelecimento; leitura compartilhada).
-- Não é append-only: pode ser marcada como lida e limpa.
CREATE TABLE notificacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('pedido_pronto','garcom_chamado','estoque_baixo','sistema')),
  titulo TEXT NOT NULL,
  detalhes TEXT,
  pedido_id INTEGER,
  mesa_numero INTEGER,
  criado_em TEXT NOT NULL,
  lida INTEGER NOT NULL DEFAULT 0 CHECK (lida IN (0,1)),
  lida_em TEXT
);
CREATE INDEX idx_notificacoes_nao_lidas ON notificacoes(lida, id);
