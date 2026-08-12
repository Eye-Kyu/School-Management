// =============================================================================
// GET /api/analytics/identity — server-side hash for PostHog identify()
// =============================================================================
// See docs/audits/posthog-capture-audit.md for why this exists: identify()
// needs a hashed distinct ID, but the hash salt (POSTHOG_HASH_SALT) must stay
// server-only to mean anything, and posthog.identify() itself has to run in
// the browser. This route bridges the two: it reads the CALLER'S OWN verified
// session server-side (never a client-supplied ID — there is no input to
// this endpoint at all), computes the hash there, and returns it.
// =============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hashForAnalytics } from '@/lib/analytics/anonymize';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: userRow } = await supabase
    .from('users')
    .select('role, school_id')
    .eq('auth_id', user.id)
    .maybeSingle();
  if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  return NextResponse.json({
    hashedId: hashForAnalytics(user.id),
    role: userRow.role,
    schoolId: userRow.school_id,
  });
}
