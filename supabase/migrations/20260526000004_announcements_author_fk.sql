-- Add missing FK from announcements.author_id → users.id
-- PostgREST requires this FK to resolve the author join in queries.
ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;
