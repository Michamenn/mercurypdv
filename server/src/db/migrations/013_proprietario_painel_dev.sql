-- ============================================================
-- Mercury PDV 1.3.1 - Migração 013: cargo "proprietario" + flag pode_painel_dev
-- ============================================================
-- Novo cargo "Proprietário": idêntico ao admin em TODAS as permissões, exceto
-- o painel do desenvolvedor. O painel dev deixa de ser "coisa de admin" e passa
-- a ser controlado pela flag dedicada pode_painel_dev (admin = 1, demais = 0).
--
-- O SQLite não permite alterar o CHECK de uma coluna existente: é preciso
-- recriar as tabelas (create new -> copy -> drop old -> rename), espelhando o
-- schema REAL atual (colunas extras das migrações 003/007/010 inclusive).
--
-- FKs: foreign_keys fica ligado em produção e `usuarios` é referenciada por
-- dezenas de tabelas (sessoes.usuario_id, configuracao.atualizado_por,
-- usuarios.criado_por, ...). Com FK ligada, o DROP TABLE dispara um DELETE
-- implícito que aborta e o ALTER ... RENAME reescreve as REFERENCES nas filhas.
-- Por isso o runner (server/src/db/migrations.js) desliga `foreign_keys` em
-- volta do loop de migração — é a sequência recomendada pela documentação do
-- SQLite para reconstruir tabelas — e restaura o estado original ao final.
-- Provado empiricamente: com FK ligada o COMMIT falha ("FOREIGN KEY constraint
-- failed"); com FK desligada, `PRAGMA foreign_key_check` volta vazio.

-- ---------- permissoes: nova coluna + CHECK ampliado ----------
-- A coluna é adicionada e, na recriação logo abaixo, faz parte do schema final.
ALTER TABLE permissoes ADD COLUMN pode_painel_dev INTEGER NOT NULL DEFAULT 0;

CREATE TABLE permissoes_novo (
  cargo TEXT PRIMARY KEY CHECK (cargo IN ('admin','caixa','garcom','cozinha','proprietario')),
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
  pode_backup INTEGER NOT NULL DEFAULT 0,
  pode_gerenciar_combos INTEGER NOT NULL DEFAULT 0 CHECK (pode_gerenciar_combos IN (0,1)),
  pode_brinde INTEGER NOT NULL DEFAULT 0 CHECK (pode_brinde IN (0,1)),
  pode_fazer_checkin INTEGER NOT NULL DEFAULT 0 CHECK (pode_fazer_checkin IN (0,1)),
  pode_gerenciar_taxa_servico INTEGER NOT NULL DEFAULT 0 CHECK (pode_gerenciar_taxa_servico IN (0,1)),
  pode_painel_dev INTEGER NOT NULL DEFAULT 0 CHECK (pode_painel_dev IN (0,1))
);

INSERT INTO permissoes_novo (
  cargo, pode_vender_balcao, pode_dividir_pagar, pode_abrir_fechar_caixa, pode_sangria_suprimento,
  pode_cancelar_item, pode_lancar_comanda, pode_ver_kds, pode_avancar_kds, pode_gerenciar_produtos,
  pode_gerenciar_usuarios, pode_ver_relatorios, pode_gerenciar_mesas, pode_desconto,
  pode_estoque_gerenciar, pode_config_sistema, pode_backup, pode_gerenciar_combos, pode_brinde,
  pode_fazer_checkin, pode_gerenciar_taxa_servico, pode_painel_dev
)
SELECT
  cargo, pode_vender_balcao, pode_dividir_pagar, pode_abrir_fechar_caixa, pode_sangria_suprimento,
  pode_cancelar_item, pode_lancar_comanda, pode_ver_kds, pode_avancar_kds, pode_gerenciar_produtos,
  pode_gerenciar_usuarios, pode_ver_relatorios, pode_gerenciar_mesas, pode_desconto,
  pode_estoque_gerenciar, pode_config_sistema, pode_backup, pode_gerenciar_combos, pode_brinde,
  pode_fazer_checkin, pode_gerenciar_taxa_servico, pode_painel_dev
FROM permissoes;

DROP TABLE permissoes;
ALTER TABLE permissoes_novo RENAME TO permissoes;

-- ---------- usuarios: CHECK ampliado ----------
CREATE TABLE usuarios_novo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  cargo TEXT NOT NULL CHECK (cargo IN ('admin','caixa','garcom','cozinha','proprietario')),
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

INSERT INTO usuarios_novo (id, nome, cargo, pin_hash, senha_hash, ativo, falhas_login, bloqueado_ate, ultimo_login, criado_em, criado_por)
SELECT id, nome, cargo, pin_hash, senha_hash, ativo, falhas_login, bloqueado_ate, ultimo_login, criado_em, criado_por
FROM usuarios;

DROP TABLE usuarios;
ALTER TABLE usuarios_novo RENAME TO usuarios;

-- ---------- dados do novo cargo ----------
-- Proprietário = todas as flags 1, menos o painel dev. Não sobrescreve a linha
-- caso ela já exista (idempotência defensiva).
INSERT OR IGNORE INTO permissoes (
  cargo, pode_vender_balcao, pode_dividir_pagar, pode_abrir_fechar_caixa, pode_sangria_suprimento,
  pode_cancelar_item, pode_lancar_comanda, pode_ver_kds, pode_avancar_kds, pode_gerenciar_produtos,
  pode_gerenciar_usuarios, pode_ver_relatorios, pode_gerenciar_mesas, pode_desconto,
  pode_estoque_gerenciar, pode_config_sistema, pode_backup, pode_gerenciar_combos, pode_brinde,
  pode_fazer_checkin, pode_gerenciar_taxa_servico, pode_painel_dev
) VALUES (
  'proprietario', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0
);

-- O admin (e só ele) permanece com acesso ao painel dev por padrão.
UPDATE permissoes SET pode_painel_dev = 1 WHERE cargo = 'admin';
