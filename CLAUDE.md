# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Stack

Multi-user personal finance / budgeting app. Next.js 16 (App Router), TypeScript,
Tailwind v4, Supabase (Postgres + Auth). Currently a fresh `create-next-app`
scaffold — no data layer built yet. Path alias `@/*` -> project root.

## Commands

`npm run dev|build|start|lint`. No test runner configured yet.

## Rules

- Every table holding user data must have Row Level Security enabled, with a
  policy scoping rows to `auth.uid()`. Never write a query that relies on
  client-side filtering for data isolation.
- The Supabase secret/`service_role` key is server-only. Never reference it in
  a Client Component or any file with `"use client"`.
- All database access goes through functions in `lib/` — pages and components
  never call Supabase directly.
- Money is stored as integer cents, never floats.
- Foreign key columns in this schema have no underscore: `userid`, `accountid`,
  `categoryid`, `goalid`, `recurringid`. Never write `user_id`.
- `amount` is Postgres `numeric` (exact). Never do money arithmetic in
  JavaScript floats — aggregate in SQL, or use a decimal library. Display
  formatting only on the client.
- `transactions.amount` is always positive (`CHECK amount >= 0`). Direction
  comes from `transaction_type`, which is exactly `'Income'` or `'Expense'`
  (capitalized). Never sum `amount` directly.
- Use `signed_amount(amount, transaction_type)` for any signed money math —
  never hand-roll the Income/Expense `CASE`. It's `IMMUTABLE PARALLEL SAFE`,
  so it's safe in aggregates, indexes, and generated columns.
- Liability accounts (Credit Card, Loan) carry negative balances. `v_net_worth`
  depends on this. Collect a positive number from users and negate on write;
  display the absolute value with "owed". Never sum account balances as
  absolute values.

## Design language

Dark-first. Bold and confident (Cash App / Monzo), encouraging and
streak-driven (Duolingo). Playful in framing, precise in figures.

### Two colour systems, kept separate

**UI colour** — brand personality. Loud is fine.
**Data colour** — charts, meters, category dots. Validated, never ad hoc.

### Brand (chrome only — never in charts, meters, or status)

  brand gold        #E9B949    hover #F2C866    pressed #D4A32F
  Text on gold is ALWAYS dark ink (#0B0B0B). White on gold fails at 1.83:1.

### Surfaces (navy family, matching the logo)

  page plane        #131322
  card surface      #1B1B2F
  raised surface    #23233A
  hairline border   rgba(255,255,255,0.10)
  ink primary       #ffffff     secondary #c3c2b7     muted #898781
  gridline          #2C2C42     baseline  #383850

The eight categorical data colours are re-validated against #1B1B2F and pass
all six checks unchanged. Do not re-step them.

Categorical slots, in this fixed order, never cycled:
  1 blue #3987e5   2 orange #d95926   3 aqua #199e70   4 yellow #c98500
  5 magenta #d55181   6 green #008300   7 violet #9085e9   8 red #e66767

Status (reserved — never used as a series colour):
  good #0ca30c   warning #fab219   serious #ec835a   critical #d03b3b

Sequential (magnitude): one hue, blue, light to dark. Never a rainbow.

### The hard rule

Gold is brand chrome: logo, nav, primary buttons, splash. It never appears as
a data colour, a meter fill, or a status indicator — status warning #fab219 is
the same hue family, and separation depends entirely on gold staying out of
data contexts.

### Hard rules

- Text never wears a data colour. Values, labels and legends use ink tokens;
  a coloured dot beside the text carries identity.
- Status colour never appears alone — always icon + label too.
- Big standalone numbers use proportional figures. `tabular-nums` only in
  columns that must align vertically (table rows).
- Exactly one hero figure per view, >= 48px, same sans as everything else.
- Meters: fill carries severity (accent -> warning -> critical); the unfilled
  track is a lighter step of the same hue, so state reads across the whole bar.
- Every animation respects `prefers-reduced-motion`.

### Voice

Second person, present tense, short. Encouraging, never scolding — over
budget is "let's look at this", not a red alarm. Celebrate specifics
("$240 toward Japan") not generics ("Great job!"). Never shame a user for
spending. Never use exclamation marks in anything showing a figure.

## Repo layout

Not its own git repo — nested two levels inside `evernest/`, the actual git
root (`supabase/migrations/`, `src/types/database.ts`, `DATABASE.md` live
there). `git log`/`git status` here reflect the whole `evernest` repo, not
just this app.

## Backend contract

Read `../../DATABASE.md` before writing any query or signup flow:

- Balances are computed, not stored — read from views (`v_account_balances`,
  `v_goal_progress`), never balance columns.
- Signup must pass `first_name`/`last_name`/`username`/`phone` via
  `auth.signUp()`'s `options.data`.
- On signup, the `on_auth_user_created` trigger calls `handle_new_user()`
  (`AFTER INSERT ON auth.users`), which creates the `profiles` row, the
  `settings` row, and default `category_groups`/`categories`. App code must
  never insert into `profiles`/`settings`/`category_groups`/`categories`
  directly — the trigger owns them.
- `subscriptions` is service_role-only: client code may `SELECT` it, never
  write to it (no INSERT/UPDATE/DELETE policy exists, and the grants are
  revoked for `authenticated`).
- Username login resolves server-side only (`email_for_username()` is
  `service_role`-only).
- Only `Income`/`Expense` transaction types exist — transfers unsupported.
- Accounts/categories are soft-deleted (`is_active`), never hard-deleted.
- Regenerate `lib/database.types.ts` after every migration (see "After any
  migration" below).

## After any migration

1. `npx supabase@latest db push`
2. `npx supabase@latest gen types --linked --lang typescript --schema public > lib/database.types.ts`
3. Commit both together

## Data layer rules

- All database access goes through `lib/db/*.ts`. Pages and components never
  call Supabase directly.
- FK columns have no underscore: userid, accountid, categoryid, goalid, recurringid.
- RLS scopes every query to the current user. Never add a userid filter as a
  security measure — it creates the illusion RLS is optional.
- But PostgREST requires an explicit filter on UPDATE and DELETE (error 21000).
  Always target the rows you mean, normally by primary key. Filter for intent,
  never for security.
- Use .maybeSingle() for any read that can legitimately return nothing. Reserve
  .single() for fetches by primary key where absence is genuinely an error.
- On INSERT, userid must be set explicitly from the server session
  (getClaims), never from client input.
- transactions.amount is always positive. Direction is transaction_type,
  exactly 'Income' or 'Expense'.
- A trigger requires transaction_type to match the category's category_type.
  Category pickers must filter by the selected type.
- Never aggregate money in JavaScript. Use the v_* views, or sum
  signed_amount(amount, transaction_type) in SQL.
- profiles: SELECT plus UPDATE on only first_name, last_name, username,
  phone, lastlogin, updated_at. Nothing else is writable.
- subscriptions: read-only for users. Billing state is service_role only.
- Never use the service role key in application code.
- The data layer test harness lives in git history — recover with
  `git checkout <commit> -- app/db-test`. Re-run it as two different users
  after any change to `lib/db/`.
