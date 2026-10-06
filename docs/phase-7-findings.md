# Phase 7 findings

## LAUNCH BLOCKER: Cross-user foreign keys can make an account undeletable (2026-10-04)

**Status: mitigated in RLS (migration 37, 2026-10-04). Structural fix
(composite FKs) still required before launch. Do not launch until it
ships.**

Section 4 of `docs/rls-isolation-test.sql` going green does NOT close this
entry. It proves the RLS mitigation only; see "Mitigation" below for what
it does not cover.

### Consequence (this is what sets the severity)

A user who cannot delete their account is a legal problem for an app
holding financial records -- erasure requests have to succeed. Today, one
row the user does not own and cannot see can make `delete_own_account()`
fail permanently for them, and nothing in the app can clear it.

The *attack* is hard (it needs another user's UUID, which is random and
never shown across accounts). That is not the rating. The rating is the
consequence, and the consequence is reachable without any attacker: any
path that leaves a row pointing at another user's parent -- a bug, a
support-side data fix, a future import -- produces the same stuck account.

### Mechanism

Every FK from a user-owned table to a user-owned parent is single-column
and carries no ownership check:

| Child | FK | On delete |
|---|---|---|
| `transactions` | `accountid -> accounts(id)` | RESTRICT |
| `transactions` | `categoryid -> categories(id)` | RESTRICT |
| `transactions` | `goalid -> goals(id)` | SET NULL |
| `transactions` | `recurringid -> recurring_transactions(id)` | SET NULL |
| `recurring_transactions` | `accountid`, `to_accountid -> accounts(id)` | RESTRICT |
| `recurring_transactions` | `categoryid -> categories(id)` | RESTRICT |
| `investments` | `accountid -> accounts(id)` | RESTRICT |
| `budgets` | `categoryid -> categories(id)` | CASCADE |
| `goals` | `accountid -> accounts(id)` | SET NULL |
| `categories` | `groupid -> category_groups(id)` | RESTRICT |
| `goal_contributions` | `transactionid -> transactions(id)` | CASCADE |

FK checks run without RLS, and the INSERT/UPDATE policies only check the
row's own `userid`. So user B can insert a transaction with
`userid = B, accountid = <A's account>`. A never sees it (views are
`security_invoker`), so A's balances are fine -- but:

1. A calls `delete_own_account()`.
2. It deletes `transactions where userid = A` -- B's row survives.
3. `delete from public.accounts where userid = A` hits B's row through
   `transactions_accountid_fkey ON DELETE RESTRICT` and the whole function
   rolls back. A's account cannot be deleted.

Side effect of the same gap: `enforce_category_type()` is SECURITY DEFINER,
so its error message revealed whether a foreign `categoryid` is Income or
Expense. Fixed in migration 38 -- see "Mitigation".

`goal_contributions` checked its goal's owner but not its
`transactionid -> transactions(id)` (CASCADE) reference, which had the same
gap.

A second consequence, found by the harness: `recurring_tx_no_double_post`
is unique on (recurringid, occurrence date). B's row carrying A's
`recurringid` takes that slot, and A's own posting of the occurrence is
then rejected with 23505 -- another user could stop A's rent from posting.

**Confirmed reachable** (2026-10-04): `docs/rls-isolation-test.sql`
section 4 -- all 11 cross-user references accepted for an authenticated
user through the same path PostgREST uses.

**No existing cross-user rows** (2026-10-04):
`docs/cross-user-references-audit.sql` checked all 13 FKs between
user-owned tables -- 0 mismatched rows each. The audit was itself proven
by planting one mismatch in a rolled-back transaction and seeing it
reported.

### Mitigation: migration 37 (shipped 2026-10-04)

`20261004000037_37_with_check_parent_ownership.sql` adds an ownership
`EXISTS` for every non-null reference to the WITH CHECK of each affected
INSERT and UPDATE policy. Verified:

- Harness: 205/205, section 4 all rejected with 42501 (was 11 accepted).
- Section 6 (new): 20 same-user writes in every shape the app uses --
  nullable references null and set, transfer legs, edits on an archived
  account -- all accepted.
- App end to end, in the UI against production on the test account:
  create account, create transaction, edit it (amount, description,
  category), create a recurring schedule, create a budget. All succeeded;
  test rows removed afterwards.

What it does NOT cover -- why composite FKs remain a launch blocker:

- **It lives only in RLS.** `service_role`, the table owner, and any
  SECURITY DEFINER function write straight past it. Today nothing does,
  but only because of CLAUDE.md rules ("never use the service role key in
  application code"). Those are rules, not guarantees -- a billing sync, a
  support-side fix, an import, or a future DEFINER function reopens the
  hole silently. A composite FK is enforced for every role in every
  context.
- **Category-type oracle -- fixed separately in migration 38
  (2026-10-04).** `enforce_category_type()` and
  `enforce_recurring_variability_scope()` are SECURITY DEFINER BEFORE
  triggers, which run before RLS checks the new row, and they looked up
  categories by id alone. A foreign `categoryid` got a different response
  from a made-up one (4 cases confirmed: one via transactions, three via
  recurring `requires_confirmation`/`date_tolerance_days`/
  `amount_is_variable`), revealing that the id exists and its type. Both
  lookups are now scoped to `userid = new.userid`; harness section 7
  asserts each pair gets an identical response, and that the triggers
  still reject mismatches on the user's own categories.
  Trade-off that adds to the case for composite FKs: a write that
  bypasses RLS with a cross-user `categoryid` now skips the type check
  rather than applying it against the other user's category.

### Structural fix (not built yet)

Composite FKs so a child can only reference its own user's parent:
`unique (userid, id)` on each parent, then each FK rewritten as
`(userid, accountid) references accounts(userid, id)` and so on, keeping
each FK's existing ON DELETE action. `SET NULL` FKs need the column-list form
(`on delete set null (goalid)`) so the cascade doesn't null `userid` too.
Check for existing cross-user rows first -- `ADD CONSTRAINT` fails on them,
and any found are exactly the stuck-deletion case. Run
`docs/cross-user-references-audit.sql` immediately before applying (0 on
2026-10-04; migration 37 should keep it at 0 for PostgREST writes).
`goal_contributions` has no `userid`, so its `transactionid` FK needs a
different shape (a `userid` column, or a trigger) -- decide when building.

This is a significant migration on live tables: unique constraints plus
rewritten FKs. **Validate it on a Supabase preview branch before it goes
near production.**

### Interaction with Section 5 (account deletion)

`delete_own_account()` deletes only the caller's rows and then hits
ON DELETE RESTRICT. Section 5 must test deletion **with a foreign row
present** (another user's transaction pointing at the deleting user's
account), not only the clean path. Before the fix that test should fail;
after it, the foreign row cannot exist to begin with. Since migration 37
the foreign row can't be created through PostgREST, so the test has to
plant it as the table owner -- which is exactly the RLS-bypassing path the
composite FKs exist for.

## Section 1: `profiles -> auth.users` FK exists only in production (2026-10-06)

**Status: open. Must be captured in a migration before launch.**

Production has:

```
profiles_userid_fkey  FOREIGN KEY (id) REFERENCES auth.users(id)
                      ON UPDATE CASCADE ON DELETE CASCADE
```

No migration in `supabase/migrations/` creates it. It predates migration 01
(created by hand in the dashboard), and migrations 14/16 only *assert* it in
comments. A rebuild from zero (`db reset`, a preview branch, a new project)
would produce a `profiles` table with no FK to `auth.users`.

Why it matters: `delete_own_account()` ends with
`delete from auth.users where id = v_uid` and relies on this cascade to remove
the `profiles` row. Without the FK, deletion "succeeds" and leaves an orphan
`profiles` row: the user's name, username, phone and `lastlogin`, which is
exactly the personal data erasure is supposed to remove.

Also note: the name is misleading. It's called `profiles_userid_fkey`, but
the column is `profiles.id`; there is no `userid` column on `profiles`.

Fix: an idempotent migration that drops and recreates the constraint with
the same definition (name it `profiles_id_fkey`). It's a no-op on production
and makes a rebuild reproduce it. Then diff the rest of production against
a fresh `db reset` for other dashboard-only objects. This one was found
only because deletion depends on it.

Verified CASCADE in production 2026-10-06 via `pg_constraint`
(`confdeltype = 'c'`).

## Section 5: account deletion end to end (2026-10-06)

Pre-checks, all against production:

1. `profiles -> auth.users` is `ON DELETE CASCADE` (see Section 1 above).
2. A user-facing flow exists: Settings -> "Delete account"
   (`app/(app)/settings/DeleteAccountSection.tsx`), with the typed `DELETE`
   confirmation re-checked server-side in `lib/actions/account.ts`, which
   calls `delete_own_account()` via `lib/db/profile.ts`, signs out locally,
   and redirects to `/account-deleted`. Not a blocker.
3. Cross-user RESTRICT blockers: run across **all** users, not only the
   test account. 0 rows on all 7 RESTRICT FKs.

Before-counts were taken for `+rls36` (`7971f982-…`): categories 57,
category_groups 11, settings 1, profiles 1, auth.users 1, auth.identities 1,
everything else 0. **The UI deletion was run on a different account**,
`+sorrel-sign-test` (`fa89fa73-…`), so there are no before-counts for the
account that was actually deleted. `+rls36` is unchanged.

Deletion of `+sorrel-sign-test` through the Settings UI:

- After-counts: all 21 rows 0. The audit log was already 0 (see the Phase
  8 item).
- Full sweep: `CLEAN` across 136 uuid columns in `public`, `auth` and
  `storage`, including views.
- App: logged out, shown the "all data removed" page with a sign-up link,
  no error.
- Re-signup with the same email: reported as working in the UI, but **no
  new `auth.users` row exists**. Unresolved, see below.
- `/dashboard` after deletion redirects to login, so the session is dead.
- Dev-server terminal: nothing logged during the delete.

Gaps in this run: without before-counts, nothing shows whether the deleted
account held transactions or accounts. It was a name-test signup from
2026-10-05, so probably only the trigger-created defaults. If so, it didn't
exercise the child-before-parent ordering through transactions -> accounts.
A seeded repeat was skipped by decision on 2026-10-06.

Open items carried forward:

- Re-signup with a deleted user's email: the UI reported success, but no
  `auth.users` row was created. Either the email used still belonged to an
  existing account (Supabase returns a normal-looking success for those, by
  design), or signup failed silently. Not yet determined which.
- Deletion of an account holding transactions, schedules, goals and budgets
  hasn't been verified end to end in production.

## Phase 8 policy item: auth audit log retained after deletion (2026-10-06)

**Decision: deliberate retention, not an oversight.** It must match the
privacy policy wording.

`delete_own_account()` does not touch `auth.audit_log_entries`. Any entries
for a deleted user keep their id (and, depending on the event, their email)
in `payload`. That's defensible: security logs have their own legal basis
(security, fraud prevention) and their own retention period, separate from
erasure of account data. The privacy policy has to say so explicitly, with
the retention period.

What the table actually holds in production (2026-10-06): **0 rows total**,
including none for the test account. Auth audit events most likely aren't
written to the database at all in this project (Supabase lets you turn that
off). They go to the platform's Auth logs, which the project cannot delete
from and which follow the plan's log retention. Confirm that setting in
Auth settings. The privacy policy wording has to cover the platform logs,
not the table.

Can it be deleted at all: the table is owned by `supabase_auth_admin`;
`postgres` has DELETE, `service_role` does not. So deleting is technically
possible from `delete_own_account()` (it runs as `postgres`). It's still
GoTrue-managed internal state, and Supabase's platform logs sit outside the
database regardless, so even deleting from the table wouldn't erase the
trail. That's a further reason to treat retention as the policy rather than
attempt erasure.

## Fixed: `seed_default_categories` callable by anyone (2026-10-04)

SECURITY DEFINER, trusted its `p_userid` argument, and still had Postgres's
default `EXECUTE` to `PUBLIC` -- so anyone with the public anon key could
write default categories into any user's account via
`/rest/v1/rpc/seed_default_categories`. Fixed out of band (anonymous write
to another user's data doesn't wait for a fix pass) in migration 36, which
also revokes the three trigger functions for tidiness. Verified: the RPC
now returns `42501 permission denied`.

`docs/rls-isolation-test.sql` section 2d asserts the function grants, and it
fails when an expectation is flipped. Re-run it after any migration.

Remaining PUBLIC/anon-executable functions, all SECURITY INVOKER and
harmless: `signed_amount` and `set_updated_at` (default PUBLIC);
`add_business_days`, `is_business_day` and `resolve_recurring_due_date`
(explicit PUBLIC; date arithmetic, none reads a user table -- only
`is_business_day` touches a table at all, `bank_holidays`, which anon can't
select); and
`username_is_available` (anon by design, for signup).

## Temporary code that must not ship

| Path | Purpose | Added | Status |
|---|---|---|---|
| `app/(app)/dev-projection/page.tsx` | Prints the signed-in user's safe-to-spend projection (income, obligations, daily balance, trough, cushion, result) to check it against real data. Dev-only (`notFound()` in production); reads through `getSafeToSpend()` under the user's session and RLS. | 2026-10-02 | Deleted 2026-10-04 (never committed) |

## "fiber.reset is not a function" in the dev overlay (2026-10-04)

Seen twice; the second time on setting the safe-to-spend cushion to 0.

**The message does not come from this app's React.** The string
`fiber.reset` / `reset is not a function` appears nowhere in `react`,
`react-dom` or `next` under `node_modules`, nor in app source. `npm ls react
react-dom` resolves a single react@19.2.8 / react-dom@19.2.8, all deduped, so
it isn't a duplicate-React mismatch either.

Source: a browser extension (confirmed by the incognito check below). One
that walks the page's fiber tree -- React DevTools is the prime suspect,
though which extension wasn't isolated. Extensions run inside the page, so their
exceptions surface in Next's dev overlay looking like React internals failing.

**Before debugging a React-internals error in the overlay:**

1. Grep `node_modules/react-dom`, `react`, `next` for the exact message. No
   hit means the code throwing it isn't ours.
2. Reproduce in an incognito window with extensions disabled.
3. Read the dev-server terminal, not the overlay -- the overlay can report
   an error thrown while reporting another.

**Isolation result:** `app/(app)/dashboard/SafeToSpendHero.test.tsx` renders
the hero with its breakdown open at cushion = 0 (with and without a dip below
zero) in jsdom -- no exception, no React warning.

**Incognito check (2026-10-04):** setting the cushion to 0 with extensions
disabled -- no error. Confirms the crash came from a browser extension, not
the app. Not an app bug; nothing to fix.

**Real bug the investigation found (fixed):** the breakdown's cushion line
and obligation rows rendered through the signed `<Amount type="Expense">`,
so the cushion read "−$0.00" (and "−$300.00" beside an unsigned "Cash on
hand"). The breakdown is label-and-value, unsigned throughout; both now use
`formatCurrency`, and the test asserts it.
