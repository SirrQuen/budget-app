# Supabase project configuration

What a database rebuilt from `supabase/migrations/` does NOT have. The
baseline is a schema dump of production; this file is everything a dump
cannot carry, so a rebuild is knowingly incomplete rather than assumed
complete. A new project, or a restore into one, needs every "set by hand"
item below re-applied.

Production project: `ybdwqyihvbokowocvlgq`.

Status: draft, 2026-10-08. Sections 1 and 2 were read from production
(read-only catalog queries via `supabase db query --linked`). Section 3
cannot be read from the database; values there are recorded from the
dashboard with the date read, and every `TODO` is still unverified.

## 1. Outside the `public` dump, carried into the baseline explicitly

These are database objects, but `pg_dump -n public` does not include
them. The baseline adds each one as an explicit, commented statement,
copied from production.

| Item | Production value (2026-10-08) | Why the app needs it |
|---|---|---|
| Trigger on `auth.users` | `on_auth_user_created AFTER INSERT ... EXECUTE FUNCTION public.handle_new_user()`; the only non-internal trigger on that table | Signup creates profile, settings, default categories |
| Role setting | `authenticator`: `pgrst.db_pre_request = public.apply_user_timezone` | "Today" is the user's day (migration 40) |
| `bank_holidays` rows | ~110 rows | `lib/businessDays.ts`; empty table means no business-day shifts, silently |

## 2. Checked in production: nothing to carry

| Item | Production (2026-10-08) |
|---|---|
| Storage buckets | none |
| Storage policies | none (only Supabase's own triggers on `storage.*`) |
| Realtime | `supabase_realtime` publication has no tables |
| Extensions | `pgcrypto`, `uuid-ossp`, `pg_stat_statements` (in `extensions`), `supabase_vault`, `plpgsql` -- all installed by Supabase |
| Vault secrets | 0 |
| Cron jobs / database webhooks | none (no `cron`, `net` or `supabase_functions` schema) |
| Auth hooks | no hook functions in `public` |
| Edge functions | none (no `supabase/functions/`) |
| Custom roles | none (`cli_login_postgres` is the Supabase CLI's temporary login role) |
| Role timeouts | `anon` 3s, `authenticated` 8s, `authenticator` 8s statement / 8s lock. Supabase defaults: a fresh preview branch has identical values (2026-10-08) |
| Postgres version | production 17.6; a new preview branch gets 17.11. Upgrades are a dashboard action |
| JWT expiry | `app.settings.jwt_exp = 3600` (database-wide setting; the auth config is the source) |

## 3. Not in the database: set in the dashboard

None of these can be read from Postgres. Record each value here from the
dashboard (Authentication / Settings), then keep this file current.

### Auth

- **Site URL** -- `https://mysorrel.com` (set 2026-10-13). The confirm-signup
  template builds its link from `{{ .SiteURL }}`, so every confirmation
  email -- localhost signups included -- links to production.
- **Redirect URL allowlist** -- `https://mysorrel.com/**`,
  `http://localhost:3000/**` (set 2026-10-13). Must cover
  `<origin>/auth/confirm`: signup sends
  `emailRedirectTo: ${origin}/auth/confirm?next=/dashboard`
  (`lib/auth/signup.ts`), and password recovery sends
  `redirectTo: ${origin}/auth/confirm?next=/reset-password`
  (`lib/auth/actions.ts`). `origin` is the request's Origin header, so any
  other deployed origin (a preview) needs its own entry.
- **Confirm email** -- on (read 2026-10-13). An unconfirmed address can't
  sign in; login gets `email_not_confirmed` (`lib/auth/errors.ts`). The
  confirm-signup template's last line depends on this staying on.
- **Email templates** -- managed in the dashboard, pasted by hand from
  `supabase/templates/`. Supabase never reads that directory (no
  `config.toml`; `supabase config push` is never run). Edit the repo file,
  paste it into the dashboard, keep the two identical.
  - Confirm signup: custom, `supabase/templates/confirmation.html`
    (2026-10-13). Link is `token_hash` + `type=email` to `/auth/confirm`.
  - Every other template (reset password, magic link, email change,
    invite): TODO -- record whether each is default or custom.
- **SMTP** -- custom SMTP via Resend (`smtp.resend.com:465`, user
  `resend`), sender "Sorrel" <hello@mysorrel.com>. Read from production
  2026-10-12. SPF/DKIM/DMARC on mysorrel.com not yet verified here --
  launch blocker 5 until they are.
- **Rate limits** (emails/hour, sign-ups, token refreshes, verifications)
  -- TODO.
- **Providers enabled** -- TODO (the app uses email + password only).
- **Password requirements, leaked-password protection** -- TODO.
- **Session settings** (timebox, inactivity timeout, single session) --
  TODO.
- **MFA, CAPTCHA** -- TODO.
- **JWT expiry** -- 3600s per section 2; confirm in the auth settings.

### API

- **Exposed schemas** -- TODO (expected: `public`, `graphql_public`).
- **Max rows** -- TODO.

### Database / project

- **Backups / PITR** -- daily snapshots on Pro; the PITR decision is
  launch blocker 7.
- **SSL enforcement, network restrictions** -- TODO.
- **Connection pooler settings** -- TODO.
- **Branching** -- enabled; no GitHub integration (preview branches are
  created with `supabase branches create`, and do not apply migrations
  by themselves).

### Outside Supabase

- **API keys** in the hosting environment: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SITE_URL` (see `.env.example`).
