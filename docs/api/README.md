# API documentation

Internal API reference. Public API (with proper OpenAPI spec, scoped tokens,
webhooks) arrives at v0.4 - this folder grows then.

## v0.1 endpoints

- `GET  /health` - unauthenticated, returns `{ status, timestamp, version }`.
- `GET  /attendance` - list attendance records (RLS-scoped).
- `POST /attendance` - mark attendance for a class on a date.

More endpoints land per EXECUTION_PLAN.md weekly checkboxes.

## Conventions

- All endpoints return JSON.
- Error responses follow the shape produced by `GlobalExceptionFilter`:
  `{ statusCode, error, message, path, timestamp }`.
- Authentication: `Authorization: Bearer <supabase-access-token>` header.
- Validation errors: HTTP 400 with `{ message: 'Validation failed', issues: [...] }`.

## Generating an OpenAPI spec (v0.4)

NestJS supports OpenAPI generation via the `@nestjs/swagger` package. We'll
add it when the public API ships - until then, the controllers themselves
are the spec.
