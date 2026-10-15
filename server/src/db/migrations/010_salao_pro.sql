-- ============================================================
-- Mercury PDV 1.3 - Migração 010: Salão Pro (A5)
-- Libera múltiplas comandas por mesa (comanda individual),
-- coordenadas de layout do salão, check-in de cliente,
-- taxa de serviço, gorjeta por garçom, ociosidade,
-- transferência/junção de mesas e comissões.
-- ============================================================

-- ---------- 1. Libera comandas individuais na mesma mesa ----------
-- A unicidade anterior (001_init.sql:147) impedia 2+ comandas abertas
-- na mesma mesa, o que torna impossível "comanda individual por cliente".
DROP INDEX IF EXISTS idx_pedido_aberto_por_mesa;
CREATE INDEX IF NOT EXISTS idx_pedido_aberto_por_mesa
  ON pedidos(mesa_id) WHERE status = 'aberto' AND mesa_id IS NOT NULL;

-- ---------- 2. Layout real do salão + ociosidade ----------
ALTER TABLE mesas ADD COLUMN pos_x INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mesas ADD COLUMN pos_y INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mesas ADD COLUMN largura INTEGER NOT NULL DEFAULT 110;
ALTER TABLE mesas ADD COLUMN altura INTEGER NOT NULL DEFAULT 110;
ALTER TABLE mesas ADD COLUMN formato TEXT NOT NULL DEFAULT 'retangular'
  CHECK (formato IN ('retangular','redonda'));
ALTER TABLE mesas ADD COLUMN assentos INTEGER NOT NULL DEFAULT 4;
ALTER TABLE mesas ADD COLUMN ociosa_desde TEXT;
CREATE INDEX IF NOT EXISTS idx_mesas_setor ON mesas(setor);

-- ---------- 3. Taxa de serviço, gorjeta e atendente no pedido ----------
ALTER TABLE pedidos ADD COLUMN taxa_servico_centavos INTEGER NOT NULL DEFAULT 0
  CHECK (taxa_servico_centavos >= 0);
ALTER TABLE pedidos ADD COLUMN gorjeta_centavos INTEGER NOT NULL DEFAULT 0
  CHECK (gorjeta_centavos >= 0);
-- Garçom que efetivamente atendeu (abre ou fecha a comanda).
ALTER TABLE pedidos ADD COLUMN atendente_id INTEGER REFERENCES usuarios(id);
-- Marca comanda individual (filha) dentro de uma mesa com várias contas.
ALTER TABLE pedidos ADD COLUMN individual INTEGER NOT NULL DEFAULT 0
  CHECK (individual IN (0,1));
CREATE INDEX IF NOT EXISTS idx_pedidos_atendente ON pedidos(atendente_id);

-- ---------- 4. Cadastro de clientes (check-in) ----------
CREATE TABLE clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  documento TEXT,
  telefone TEXT,
  observacao TEXT,
  criado_em TEXT NOT NULL,
  criado_por INTEGER REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes(nome);
-- Um mesmo documento não pode ser cadastrado duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_documento
  ON clientes(documento) WHERE documento IS NOT NULL AND documento <> '';

ALTER TABLE pedidos ADD COLUMN cliente_id INTEGER REFERENCES clientes(id);

-- ---------- 5. Gorjeta creditada ao garçom ----------
CREATE TABLE gorjetas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  garcom_id INTEGER NOT NULL REFERENCES usuarios(id),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  forma TEXT NOT NULL CHECK (forma IN ('dinheiro','pix','cartao_debito','cartao_credito','vale_refeicao')),
  observacao TEXT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  estornado INTEGER NOT NULL DEFAULT 0 CHECK (estornado IN (0,1)),
  estornado_em TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gorjetas_garcom ON gorjetas(garcom_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_gorjetas_pedido ON gorjetas(pedido_id);

-- ---------- 6. Histórico de transferência e junção de mesas ----------
CREATE TABLE mesa_movimentacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('transferencia','juncao','separacao')),
  mesa_origem_id INTEGER REFERENCES mesas(id),
  mesa_destino_id INTEGER REFERENCES mesas(id),
  mesas_envolvidas TEXT NOT NULL,
  pedidos_envolvidos TEXT NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  motivo TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mesa_mov_tipo ON mesa_movimentacoes(tipo, criado_em);

-- ---------- 7. Permissões novas ----------
ALTER TABLE permissoes ADD COLUMN pode_fazer_checkin INTEGER NOT NULL DEFAULT 0
  CHECK (pode_fazer_checkin IN (0,1));
ALTER TABLE permissoes ADD COLUMN pode_gerenciar_taxa_servico INTEGER NOT NULL DEFAULT 0
  CHECK (pode_gerenciar_taxa_servico IN (0,1));
UPDATE permissoes SET pode_fazer_checkin = 1 WHERE cargo IN ('admin','caixa','garcom');
UPDATE permissoes SET pode_gerenciar_taxa_servico = 1 WHERE cargo = 'admin';

-- ---------- 8. Configurações padrão ----------
INSERT OR IGNORE INTO configuracao (chave, valor, atualizado_em) VALUES
  ('nomenclatura_pedido',        'mesa',      '2020-01-01T00:00:00.000Z'),
  ('checkin_obrigatorio',        '0',         '2020-01-01T00:00:00.000Z'),
  ('checkin_exige_cadastro',     '0',         '2020-01-01T00:00:00.000Z'),
  ('taxa_servico_modo',          'desativada','2020-01-01T00:00:00.000Z'),
  ('taxa_servico_pct',           '10',        '2020-01-01T00:00:00.000Z'),
  ('taxa_servico_fixo_centavos', '0',         '2020-01-01T00:00:00.000Z'),
  ('taxa_servico_cobrar_por',    'subtotal',  '2020-01-01T00:00:00.000Z'),
  ('mesa_ociosa_minutos',        '45',        '2020-01-01T00:00:00.000Z'),
  ('comissao_pct',               '0',         '2020-01-01T00:00:00.000Z'),
  ('layout_salao_largura',       '1200',      '2020-01-01T00:00:00.000Z'),
  ('layout_salao_altura',        '800',       '2020-01-01T00:00:00.000Z');

-- ---------- 9. Backfill de layout: distribui as mesas já existentes ----------
-- Sem coordenadas, o mapa do salão cairia todo no canto (0,0).
-- A posição é derivada da ordenação (setor, numero) via subconsulta
-- correlacionada: evita window functions e UPDATE...FROM (SQLite antigo).
UPDATE mesas AS m
SET pos_x = 40 + (
      (SELECT COUNT(*) FROM mesas x
        WHERE x.setor < m.setor OR (x.setor = m.setor AND x.numero < m.numero)) % 10) * 130,
    pos_y = 40 + (
      (SELECT COUNT(*) FROM mesas x
        WHERE x.setor < m.setor OR (x.setor = m.setor AND x.numero < m.numero)) / 10) * 130;