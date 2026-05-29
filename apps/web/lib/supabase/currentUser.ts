import { createClient } from './client';

/** Fetch the current user's row from the users table, filtered by their auth UID. */
export async function getCurrentUserRow(fields = 'id, school_id') {
  const supabase = createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return null;
  const { data } = await supabase
    .from('users')
    .select(fields)
    .eq('auth_id', authUser.id)
    .maybeSingle();
  return data as Record<string, string> | null;
}
