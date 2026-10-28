# Admin sign-in uses Google OAuth; invites are an allowlist

ADR-0006 chose email Magic Link + OTP, but production email needs a verified sending domain and a custom
SMTP provider; the project has neither, and Supabase's built-in sender allows only 2 emails/hour. Google
OAuth removes the email-sending dependency while still avoiding a GitHub account. Admins sign in with a
Google account; an owner adds the admin's email + role to `admin_invites` and sends the onboarding
instructions out-of-band. After OAuth, `accept_admin_invite()` matches `auth.email()` and creates the
`admin_roles` row; an uninvited Google account can authenticate but has no admin rights.

## Consequences

- No SMTP, no email templates, no magic-link expiry; Supabase Auth only needs the Google provider.
- OAuth redirect must land on a real non-hash URL (the site root), not `/#/admin/...`; after the code
  exchange the app navigates to the admin route. Configure the site root in Supabase redirect URLs and
  `https://<project-ref>.supabase.co/auth/v1/callback` in Google Cloud.
- Invites are rows in `admin_invites`, not emails; the owner is responsible for delivering the
  instructions. Revoking an invite is deleting/expiring that row.
- Admin requirement changes from "has email" to "has a Google account". Accepted by the owner to remove
  the domain/SMTP prerequisite.
- Free-plan project inactivity pause still applies; admin login is unavailable until the project is
  restored, while the public static site keeps working from its snapshot.
- MFA, roles, session revocation, and offboarding from ADR-0006/0007/0008 remain unchanged.
