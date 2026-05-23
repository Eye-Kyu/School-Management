import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const ROLE_HOME: Record<string, string> = {
  ADMIN: '/admin',
  TEACHER: '/teacher',
  STUDENT: '/student',
  PARENT: '/parent',
};

const PUBLIC_PATHS = ['/login', '/reset-password', '/update-password', '/'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return request.cookies.get(name)?.value; },
        set(name: string, value: string, options: Record<string, unknown>) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: Record<string, unknown>) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    },
  );

  // Always refresh the session — keeps the cookie alive.
  const { data: { user } } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const isDashboard = /^\/(admin|teacher|student|parent)/.test(pathname);

  // Unauthenticated user hitting a protected route → /login
  if (!user && isDashboard) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Authenticated user hitting /login → their role home
  if (user && pathname === '/login') {
    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', user.id)
      .maybeSingle();

    const role = userRow?.role as string | undefined;
    const home = (role && ROLE_HOME[role]) ?? '/';
    return NextResponse.redirect(new URL(home, request.url));
  }

  // Authenticated user on a role path that doesn't match their role → their home
  if (user && isDashboard) {
    const roleFromPath = pathname.split('/')[1]; // 'admin' | 'teacher' etc.
    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', user.id)
      .maybeSingle();

    const role = userRow?.role as string | undefined;
    const expectedPath = role ? ROLE_HOME[role]?.slice(1) : null; // strip leading /

    if (role && expectedPath && roleFromPath !== expectedPath) {
      return NextResponse.redirect(new URL(ROLE_HOME[role]!, request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
