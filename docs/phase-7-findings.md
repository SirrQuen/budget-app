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

**Status: fixed in migration 39 (2026-10-06).**
`20261006000039_39_profiles_auth_users_fk.sql` recreates the FK with the
identical definition, renamed to `profiles_id_fkey`. Verified in production
afterwards: exactly one FK, `ON UPDATE CASCADE ON DELETE CASCADE`. Still
open: the diff of production against a fresh `db reset` for other
dashboard-only objects.

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
the same definition, named `profiles_id_fkey` (done, migration 39). It's a
no-op on production and makes a rebuild reproduce it. Then diff the rest of production against
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

## "Leaves the set" classifier: only one of three consumers shares it (2026-10-06)

**Status: decided, build in the fix pass.**

CLAUDE.md requires that Spendable Cash, the safe-to-spend projection and the
cushion suggestion all call one "leaves the set" classifier
(`lib/safeToSpend.ts`: `SPENDABLE_ACCOUNT_TYPES`, `isSpendableAccountType`,
`isSafeToSpendCommitment`). Audit result:

| Consumer | Uses the shared classifier? | Where |
|---|---|---|
| Projection | Yes | `lib/safeToSpendProjection.ts` imports both functions |
| Spendable Cash (starting balance) | **No**: own copy of the set | `lib/db/dashboard.ts:777` `.in("account_type", ["Checking", "Savings"])` |
| Cushion suggestion | **No**: whole rule rewritten in SQL | `suggested_safe_to_spend_cushion()`, migration 33 |

Also hand-copied: `getIncomeSchedules`, `lib/db/dashboard.ts:670`.

The classifier itself is correct. Verified against all eight required cases
(Checking<->Savings transfers not counted, either direction; Checking ->
Credit Card and Checking -> Investment counted; card purchases not counted;
Checking purchases counted; income into Checking counted as inflow; income
outside the set not counted). `lib/safeToSpend.test.ts` and
`lib/safeToSpendProjection.test.ts` pass (39/39). There is no direct unit
test for Transfer Checking -> Credit Card in `safeToSpend.test.ts`; add one.

### 1. Spendable Cash and getIncomeSchedules: mechanical

Pass `[...SPENDABLE_ACCOUNT_TYPES]` to `.in(...)` at `dashboard.ts:777`, and
call `isSpendableAccountType` at `dashboard.ts:670`. There's no design
question here.

**Spendable Cash comes first.** The projection takes its starting balance
from Spendable Cash and its obligations from the classifier. If those two
disagree about which accounts are in the set, the hero number is wrong.
`getIncomeSchedules` only picks the payday shown in the context line and the
settings page.

### 2. Cushion SQL: option (a), one SQL function

Create `leaves_spendable_set(from_type, to_type)` as the only SQL-side
implementation, and call it from `suggested_safe_to_spend_cushion()`.

**Not option (b), a stored flag.** The classification depends on account
TYPE, and account types are editable. If a user changed an account from
Savings to Investment, every stored flag on that account's history would be
wrong, and nothing would detect it. A derived value that depends on mutable
parent data doesn't get frozen at write time.

That leaves two implementations, one per language. A parity test is what
makes that safe:

- **Enumerate account-type pairs from the source of truth, not a hardcoded
  list.** Adding a seventh type must create new cases automatically, and the
  test must FAIL if only one side was updated. That property is the whole
  point.
  - Caveat found while recording this: **there is no Postgres enum.**
    `account_type` is `text` constrained by `accounts_account_type_check`
    (migration 04), and `lib/accountOptions.ts`'s `ACCOUNT_TYPES` mirrors it
    by hand ("Keep in sync if that constraint ever changes").
    `database.types.ts` types the column as `string`.
  - So the test must read the allowed values from the database, by parsing
    `pg_get_constraintdef` for `accounts_account_type_check` or by
    converting the column to a real enum or lookup table first. It must also
    assert that `ACCOUNT_TYPES` equals that set before it compares the
    classifiers. Otherwise a type added only to the constraint gets no cases
    on the TS side and the test passes silently.
  - Open: where the test runs. `npm test` is pure `node --test` with no
    database. The SQL half needs a connection, either the
    `docs/rls-isolation-test.sql` route or a DB-backed test runner. Decide
    in the fix pass.
- **Cover both halves of a transfer.** The two versions work out "leaves the
  set" differently:
  - SQL looks at the transaction's Expense leg and its sibling Income leg via
    `transfer_group_id`.
  - TS looks at the schedule's `account_type` / `to_account_type`.

  For every (from, to) pair, build a real transfer with both legs. Assert
  that the SQL counts exactly the Expense leg, never the Income leg, and only
  when the TS classifier says the transfer leaves the set. Also cover a plain
  Expense (no group) for each source type.

**Fix migration 33's comment** in the new migration's `comment on function`.
Its header says the cushion "uses the same 'leaves the set' rule as the
projection's obligations (`isSafeToSpendCommitment`)". Nothing guaranteed
that, which is how the duplicate got past review. Once
`leaves_spendable_set` and the parity test exist, the claim can point at
them. Until then, delete it. (A migration that has already run can't be
edited; the replacement comment carries the fix.)

### 3. `v_dashboard_kpis.cash_balance`: a fourth "cash", has readers, decide separately

Correction: the 2026-10-06 audit called this `v_dashboard_summary`. The view
is `v_dashboard_kpis` (last defined in migration 07). Its `cash_balance` is
`Checking + Savings + Cash`. Every other definition of cash is Checking +
Savings.

The instruction was to DROP it if nothing reads it. Something does, so it
has NOT been dropped:

- `lib/db/dashboard.ts:118` `getDashboardKpis()` selects `*` from the view.
  Its only caller is the test harness, `app/db-test/page.tsx:413`. No
  product page or component calls it.
- `docs/rls-isolation-test.sql:276` uses the view as an RLS isolation case.
  That test checks row scoping and doesn't read the column.
- `evernest/DATABASE.md` (lines 52, 65-69) documents it as the dashboard
  view, and says "`cash_balance` is the one that belongs next to monthly
  income and spend". The one document every query-writer is told to read
  recommends the wrong definition, so that is the trap, written down.
- Not checked: saved SQL snippets and reports in the Supabase dashboard.
  These aren't reachable from the repo or the CLI. Someone has to check by
  hand before anything is dropped.

The other columns (`total_spent`, `total_earned`, `net_cashflow`, ...) need
their own look before a whole-view drop. Decision pending.

### 4. `app/(app)/dev-projection/page.tsx`: not gone

This copy of the set is ignored by decision (the file is being deleted). As
of 2026-10-06 the file **still exists on disk**, untracked, despite the
"Deleted 2026-10-04" status below. Added `/app/(app)/dev-projection/` to
`.gitignore` on 2026-10-06 so `git add .` can't sweep it in. Remove the
ignore entry together with the file.

## Temporary code that must not ship

| Path | Purpose | Added | Status |
|---|---|---|---|
| `app/(app)/dev-projection/page.tsx` | Prints the signed-in user's safe-to-spend projection (income, obligations, daily balance, trough, cushion, result) to check it against real data. Dev-only (`notFound()` in production); reads through `getSafeToSpend()` under the user's session and RLS. | 2026-10-02 | Recorded as deleted 2026-10-04, but present on disk again 2026-10-06 (untracked, never committed). Gitignored 2026-10-06 pending deletion; drop the ignore entry with the file. |

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
