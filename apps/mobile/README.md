# Mobile app (planned for v0.5)

The native iOS and Android apps are part of stage **v0.5a** of the staged
release plan. Until then, the PWA at `apps/web` covers all user needs -
installable from the browser, push-capable on Android, offline-friendly via
service worker caching.

## Why not start this now?

Building native earlier would:
- Triple the surface area of every v0.1 feature (web + iOS + Android).
- Force app-store reviews into the iteration loop (1-3 day delays per change).
- Add Apple Developer ($99/yr) and Google Play ($25 one-time) costs before
  there's a paying customer.

The PWA reaches 90% of what users need at 30% of the effort. Native arrives
only when there's a concrete reason: push notifications that survive Android
Doze, deep camera integration, biometric login, App Store presence.

## When v0.5a starts

From this folder:

```bash
# Initialize an Expo project
pnpm dlx create-expo-app . --template

# Add it to the workspace
# (update root package.json workspaces if needed - already includes apps/*)

# Wire up shared packages
pnpm add @school-manager/types
```

## Shared code with the web app

Anything in `@school-manager/types` (Zod schemas, types) works in React Native
unchanged - that's deliberate. Don't duplicate validation. Network calls go
through a thin client that mirrors `apps/web/lib/api/index.ts`.

## Not shared

- `apps/web/lib/supabase/server.ts` - Next.js server-only, uses `next/headers`.
- `apps/web/lib/supabase/middleware.ts` - Next.js middleware-only.
- `apps/web/lib/supabase/client.ts` - the pattern is the same in mobile but
  uses `@supabase/supabase-js` directly with AsyncStorage as the auth store.

## Auth strategy

Same Supabase project, same `users` table, same RLS policies. The mobile app
just authenticates against the same Supabase Auth that the web app uses. One
backend, multiple clients.
