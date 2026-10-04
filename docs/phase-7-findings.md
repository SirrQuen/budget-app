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
so its error message reveals whether a foreign `categoryid` is Income or
Expense.

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
- **The category-type oracle survives.** `enforce_category_type()` is a
  BEFORE trigger, and BEFORE triggers run before RLS checks the new row.
  A foreign `categoryid` whose type mismatches the transaction still gets
  "Category is Income but transaction is Expense" instead of the RLS
  rejection -- revealing that the id exists and its type. Composite FKs
  don't fix this either (FKs are checked after the trigger); the trigger
  should look up the category with `userid = new.userid`, or run as
  invoker.

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
