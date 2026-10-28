# The public catalog is a scheduled mirror of Postgres into the data repo

Postgres becomes the write authority, but the public site must stay static-first and offline-capable.
A GitHub Action in the data repo calls a public `export_public_catalog()` RPC with the anon key every
15 minutes (and on manual dispatch), preserves unknown top-level keys, replaces `games` / `taxonomy`,
and commits only on change. The site keeps its build-time snapshot + runtime hydrate; a failed export
leaves the last good snapshot in place.

New images go to a public Supabase Storage bucket and `db.json` stores full URLs. Uploads require a
signed target issued by an RPC after role/session/`aal2` checks; no service-role key reaches the
frontend. Existing GitHub-hosted images keep their URLs until the migration ticket decides.

## Consequences

- Public reads never depend on Supabase availability; the data repo and last build snapshot remain the
  fallback.
- Published changes can take up to ~15 minutes to appear without a manual dispatch.
- The mirror Action uses only the public anon key plus a GitHub token scoped to the data repo; it cannot
  read drafts or admin data.
- Data-repo history is the published-history trail; Postgres audit remains the write audit.
- The mirror must preserve unknown top-level keys, or future data-repo metadata would be silently lost.
