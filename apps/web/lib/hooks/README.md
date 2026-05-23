# Hooks

TanStack Query hooks that wrap `apiFetch` go here, one file per feature.

Example: `useAttendance.ts` would export `useTodaysAttendance(classId)`,
`useMarkAttendance()`, etc.

Each hook owns:
  - The query key
  - The fetch function
  - Cache invalidation on mutations
