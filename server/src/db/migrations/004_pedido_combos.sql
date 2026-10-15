-- ============================================================
-- Mercury PDV 1.3 - Migração 004: aplicações de combo por pedido
-- Rastreia cada aplicação (idempotente por idempotency_key).
-- ============================================================

CREATE TABLE pedido_combos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  combo_id INTEGER NOT NULL REFERENCES combos(id),
  desconto_centavos INTEGER NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  idempotency_key TEXT UNIQUE,
  aplicado_por INTEGER NOT NULL REFERENCES usuarios(id),
  aplicado_em TEXT NOT NULL
);
CREATE INDEX idx_pedido_combos_pedido ON pedido_combos(pedido_id);
