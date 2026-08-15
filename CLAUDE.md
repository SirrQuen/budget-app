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
