import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const ROLE_HOME: Record<string, string> = {
  ADMIN: '/admin',
  TEACHER: '/teacher',
  STUDENT: '/student',
  PARENT: '/parent',
};

const PUBLIC_PATHS = ['/login', '/reset-password', '/update-password', '/', '/pricing', '/safety'];

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

  const { data: { user } } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const isDashboard = /^\/(admin|teacher|student|parent)/.test(pathname);

  if (!user && isDashboard) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  async function getUserRole(): Promise<string | null> {
    if (!user) return null;
    const metaRole = (user.user_metadata?.role ?? user.app_metadata?.role) as string | undefined;
    if (metaRole && ROLE_HOME[metaRole]) return metaRole;
    const { data } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', user.id)
      .maybeSingle();
    return (data?.role as string | undefined) ?? null;
  }

  if (user && (pathname === '/login' || pathname === '/')) {
    const role = await getUserRole();
    const home = (role && ROLE_HOME[role]) ?? null;
    if (home) return NextResponse.redirect(new URL(home, request.url));
  }

  if (user && isDashboard) {
    const roleFromPath = pathname.split('/')[1] ?? '';
    const role = await getUserRole();
    const expectedPath = role ? ROLE_HOME[role]?.slice(1) : null;

    if (role && expectedPath && roleFromPath !== expectedPath) {
      return NextResponse.redirect(new URL(ROLE_HOME[role]!, request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
