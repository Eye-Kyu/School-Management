// =============================================================================
// e2e test setup — runs before every e2e spec file
// =============================================================================
// The real app gets this polyfill from src/main.ts, but e2e tests bootstrap
// AppModule directly via Test.createTestingModule(), bypassing main.ts (and
// its bootstrap() function) entirely. Without it, @supabase/realtime-js
// (pulled in by SupabaseService's createClient() calls) fails on Node 20,
// which has no native WebSocket global (stable only from Node 22+).
// =============================================================================

import ws from 'ws';
if (!('WebSocket' in globalThis)) {
  (globalThis as Record<string, unknown>).WebSocket = ws;
}
