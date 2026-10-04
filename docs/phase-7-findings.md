# Phase 7 findings

## LAUNCH BLOCKER: Cross-user foreign keys can make an account undeletable (2026-10-04)

**Status: open. Do not launch until fixed.**

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

`goal_contributions` is the only child table that already checks the
parent's owner (its policies `EXISTS` against `goals.userid`).

### Fix (not built yet)

Composite FKs so a child can only reference its own user's parent:
`unique (userid, id)` on each parent, then each FK rewritten as
`(userid, accountid) references accounts(userid, id)` and so on, keeping
each FK's existing ON DELETE action. `SET NULL` FKs need the column-list form
(`on delete set null (goalid)`) so the cascade doesn't null `userid` too.
Check for existing cross-user rows first -- `ADD CONSTRAINT` fails on them,
and any found are exactly the stuck-deletion case.

This is a significant migration on live tables: unique constraints plus
rewritten FKs. **Validate it on a Supabase preview branch before it goes
near production.**

### Interaction with Section 5 (account deletion)

`delete_own_account()` deletes only the caller's rows and then hits
ON DELETE RESTRICT. Section 5 must test deletion **with a foreign row
present** (another user's transaction pointing at the deleting user's
account), not only the clean path. Before the fix that test should fail;
after it, the foreign row cannot exist to begin with.

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
