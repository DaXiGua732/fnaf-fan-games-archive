# Authorization tests run SQL + HTTP against a local Supabase stack

RLS and RPC bugs are invisible to UI tests and to SQL-only tests. The authz suite runs in two layers
against a disposable local Supabase stack: SQL tests set JWT claims/role inside a transaction to cover
policy logic (MFA, revoked/expired sessions, last-owner, soft delete, audit immutability, lowered rate
limits), while HTTP/PostgREST tests use real Auth sessions (admin-created users + password sign-in,
local-only) to catch GRANT / function-exposure / PostgREST errors.

## Consequences

- `npm run test:authz` requires Docker and the Supabase CLI; it lives in a separate CI workflow, not
  `npm run verify`, so the normal gate stays fast.
- Every allow assertion has a denial twin across anon / editor / owner / revoked / expired identities.
- Test passwords are enabled only in local Supabase config; production uses Google OAuth only.
- Service-role credentials exist only in the test harness; the frontend static guard still forbids them.
- Google OAuth round-trip and real TOTP enrollment remain manual E2E in #6; this suite proves
  authorization, not identity-provider UX.
