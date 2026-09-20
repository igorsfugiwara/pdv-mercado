-- Fatia 10: espelho web das colunas de diagnóstico da contingência.
--
-- O DDL da web é idempotente por construção (IF NOT EXISTS), porque roda a cada
-- `db:setup` — inclusive sobre um banco que já existe.
ALTER TABLE documentos_fiscais ADD COLUMN IF NOT EXISTS ultimo_erro text;
ALTER TABLE documentos_fiscais ADD COLUMN IF NOT EXISTS ultima_tentativa_em text;
ALTER TABLE documentos_fiscais ADD COLUMN IF NOT EXISTS tentativas integer NOT NULL DEFAULT 0;
