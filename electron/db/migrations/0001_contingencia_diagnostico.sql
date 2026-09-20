-- Fatia 10: contingência com prazo visível.
--
-- O documento parado em contingência não guardava por que não passou: a
-- mensagem da SEFAZ ficava só no log do main. "SEFAZ indisponível" e
-- "rejeitado por chave duplicada" pedem ações completamente diferentes, e o
-- operador não tinha como saber qual era o caso.
--
-- Idempotente como as anteriores: roda duas vezes sem quebrar.
ALTER TABLE documentos_fiscais ADD COLUMN ultimo_erro TEXT;
ALTER TABLE documentos_fiscais ADD COLUMN ultima_tentativa_em TEXT;
ALTER TABLE documentos_fiscais ADD COLUMN tentativas INTEGER NOT NULL DEFAULT 0;
