-- ============================================================
-- Schools: real lifecycle status, replacing the binary is_active
-- flag. "Archived" is a terminal state, not a deletion — this
-- migration never removes a school row.
-- ============================================================

ALTER TABLE public.schools ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'
  CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED'));

UPDATE public.schools SET status = CASE WHEN is_active THEN 'ACTIVE' ELSE 'INACTIVE' END;

ALTER TABLE public.schools DROP COLUMN is_active;
