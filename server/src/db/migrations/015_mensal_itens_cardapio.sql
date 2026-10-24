-- ============================================================
-- Mercury PDV 1.3.1 - Migração 015: itens do cardápio nos débitos da Compra Mensal
-- ============================================================
-- Lançamento de débito agora pode vir do CARDÁPIO (produto + quantidade):
-- o servidor recalcula o valor a partir da tabela produtos (nunca confia no
-- cliente) e grava os itens estruturados em itens_json para relatórios
-- futuros. O texto de consumo continua legível no campo consumo.

ALTER TABLE mensal_lancamentos ADD COLUMN itens_json TEXT;
