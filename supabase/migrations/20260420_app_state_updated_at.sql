-- Garante que app_state tenha chave primária por user_id e updated_at confiável
-- para optimistic concurrency control.
--
-- Ao migrar:
--  - existing rows ganham updated_at = now() se estiver NULL
--  - PK em user_id bloqueia múltiplas linhas com "shared"
--  - trigger opcional atualiza updated_at em toda escrita

BEGIN;

-- 1. Garantir coluna updated_at
ALTER TABLE public.app_state
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.app_state
  SET updated_at = COALESCE(updated_at, now())
  WHERE updated_at IS NULL;

ALTER TABLE public.app_state
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now();

-- 2. Garantir unicidade de user_id (pré-requisito para upsert + CAS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conrelid = 'public.app_state'::regclass
      AND  contype  = 'p'
  ) THEN
    ALTER TABLE public.app_state ADD PRIMARY KEY (user_id);
  END IF;
END $$;

-- 3. Índice em updated_at para acelerar o CAS
CREATE INDEX IF NOT EXISTS app_state_updated_at_idx
  ON public.app_state (updated_at);

COMMIT;
