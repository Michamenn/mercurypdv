-- ============================================================
-- Mercury PDV 1.3 - Migração 011: numero_dia único POR DIA (correção)
--
-- Bug: idx_pedido_numero_dia (007_salao_a3.sql) era GLOBAL em
-- numero_dia, mas proximoNumeroDia() gera a sequência filtrando
-- pelo dia (substr(aberto_em,1,10)). Na virada do dia o MAX+1
-- volta a 1 e choca com o número do dia anterior:
--   500 UNIQUE constraint failed: pedidos.numero_dia
-- (reproduzido ao abrir comanda em 2026-10-14T00:17 com pedidos
-- de 2026-10-13 no banco).
--
-- A semântica de negócio é "número sequencial do dia" (exibido
-- como "Comanda #N do dia"; tests/09-salao.test.js: numero_dia
-- 1,2,3). Logo a unicidade precisa incluir o dia.
-- ============================================================

DROP INDEX IF EXISTS idx_pedido_numero_dia;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedido_numero_dia
  ON pedidos(substr(aberto_em, 1, 10), numero_dia) WHERE numero_dia IS NOT NULL;
