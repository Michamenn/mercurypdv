-- ============================================================
-- Mercury PDV 1.3 - Migração 008: Promoções com janela e limites
-- dias_semana (0=domingo..6=sábado), faixa horária opcional,
-- limite de usos com contador (anti-abuso em campanhas).
-- Sem vínculo de dias/horário = vale sempre (compatível).
-- ============================================================

ALTER TABLE combos ADD COLUMN dias_semana TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6';
ALTER TABLE combos ADD COLUMN hora_ini TEXT;
ALTER TABLE combos ADD COLUMN hora_fim TEXT;
ALTER TABLE combos ADD COLUMN limite_usos INTEGER CHECK (limite_usos IS NULL OR limite_usos > 0);
ALTER TABLE combos ADD COLUMN usos INTEGER NOT NULL DEFAULT 0 CHECK (usos >= 0);
