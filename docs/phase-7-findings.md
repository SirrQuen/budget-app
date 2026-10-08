# Phase 7 findings

## Launch blockers (authoritative list, 2026-10-07)

**This list is the single source for what blocks launch.** It merges this
file with Section 15 of Phase-7-Verify.md. Most blockers here were found by
the audit and were never written as TODOs, so a TODO scan of the code does
not answer "what blocks launch"; read this list. Keep it current: an item
leaves this list only when it is verified done, with the date and how.

1. ~~Composite foreign keys.~~ **Closed 2026-10-08.** Migration 44 in
   production: every reference between user-owned tables is a composite
   FK, so no role can write a cross-user reference. Verified: RLS harness
   233/233 against production (section 8 rejects each one as the table
   owner), audit 0 on all 13. See "Cross-user foreign keys" below.
2. ~~Schema drift from Section 1.~~ **Closed 2026-10-08.** The chain had
   never rebuilt from zero; migrations are squashed to a baseline dumped
   from production. Verified: a fresh preview branch built from the
   baseline file alone diffs clean against production, and production's
   history is reconciled to it. See "The migrations have never rebuilt
   the database" below. (Numbering kept so references to blockers 3-8
   stay valid.)
3. **WCAG AA contrast and reflow failures:**
   - the dark-theme `--critical` token
   - `--ink-muted` on raised surfaces
   - the 3:1 UI-boundary failures on every form field and focus ring
   - 320px reflow overflows on transactions, settings and categories

   *Repo state:* `d04eda2` (2026-10-07) changes `--critical`, `--ink-muted`,
   adds `--field-border`, and makes the field focus ring solid, with
   measured ratios in its message. Nothing in the repo addresses the 320px
   reflow. The contrast fixes have not been verified in the running app.
4. **No marketing page.** `app/page.tsx` only redirects, so a stranger
   hitting the domain sees a login form with no explanation of what they're
   logging into.
5. **Custom SMTP with a verified sending domain** on mysorrel.com,
   including SPF, DKIM and DMARC. The default Supabase mailer is
   rate-limited and its mail lands in spam.
6. **Privacy policy and terms of service.** The real item behind the
   `TODO(launch blocker)` at `app/(app)/settings/page.tsx:178`. Adding the
   links takes minutes; writing the policy is the work. It has to describe
   what the app actually does, including the audit-log retention decision
   (see "Phase 8 policy item" below).
7. **The PITR decision.** Pro gives daily snapshots, so worst-case data loss
   is up to 24 hours. That needs a deliberate answer, not a default.
8. **The Section 10 error-handling fix pass**, in full. Its design decisions
   are already made; see "Error handling audit" below.

Not blockers: the streak-strip milestone mark
(`components/ui/LoggingStreakStrip.tsx:27`) is visual polish.

## Cross-user foreign keys could make an account undeletable (2026-10-04)

**Status: closed 2026-10-08 -- composite FKs (migration 44) in
production.** Was a launch blocker; mitigated in RLS by migration 37
first.

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

What it does NOT cover -- why composite FKs were still required (now migration 44):

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

### Structural fix: migration 44 (in production 2026-10-08)

`20261008000044_44_composite_foreign_keys.sql`. Decisions taken while
building: all 13 references are composite (not only the RESTRICT ones);
constraint names are unchanged (`lib/db/recurring.ts` embeds by name);
`goal_contributions` gained a `userid` column, backfilled from its goal,
NOT NULL, set by `contributeToGoal()` from the session, and required to
equal `auth.uid()` by its INSERT/UPDATE WITH CHECK. Every other policy is
unchanged -- RLS still answers first (42501), the FK is the guarantee.

Verified 2026-10-08:

- Production, read-only: `docs/cross-user-references-audit.sql` 0 on all
  13 references; Postgres 17.6 (the `set null (col)` form needs 15+).
- Preview branch `composite-fk-verify` (built from the baseline):
  - Planted one cross-user transaction, pushed: the pre-flight aborted
    with `transactions.accountid: 1`; the transaction rolled back whole
    (no `userid` column, history unchanged). Removed the row, pushed:
    applied.
  - All 13 FKs composite with original names and ON DELETE actions; 6
    `unique (userid, id)` keys; contribution `userid` backfilled.
  - RLS harness 233/233, including new section 8: 15 cross-user writes
    as the table owner (RLS bypassed) each rejected 23503 by the named
    FK; the 3 SET NULL FKs null the reference and keep `userid`.
    Section 4 still rejects with 42501 (RLS before FK).
  - `delete_own_account()` on a user with contributions: 0 rows left.
  - PostgREST, signed in as a branch user: the exact embed strings from
    `lib/db` (recurring, transactions, categories, contributions) all 200
    with the right parents.
  - `lib/database.types.ts` generated from the branch; tsc, lint, tests
    clean. Branch deleted.

- Production, 2026-10-08: audit 0 on all 13 immediately before;
  `db push` applied 44 alone (history now `00000000000000`,
  `20261008000044`). After: 13 composite FKs, no null contribution
  `userid`, RLS harness 233/233 with 0 rows left behind, audit 0 on all
  13. `gen types --linked` byte-identical to the branch-generated file.

Original plan, kept for the reasoning:

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

## The migrations have never rebuilt the database (2026-10-08)

**Status: closed 2026-10-08.** Record: `docs/schema-drift-current.txt`.
Verified by, in order:

1. Fresh preview branch `drift-verify-3`, baseline pushed: schema dump
   (`--schema-only --no-owner -n public`, ACLs kept) diffs clean against
   production -- only the Postgres version in the dump header differs
   (17.11 vs 17.6). Auth trigger, `authenticator` setting and
   `bank_holidays` rows match; RLS harness 215/215.
2. Production history reconciled by hand with
   `docs/squash-history-reconcile.sql` (rehearsed on the branch first).
   History is now one row, `00000000000000 | baseline`, 350 statements,
   md5 `fd2ef61c...`; `supabase db push --dry-run`: "Remote database is
   up to date."
3. Production schema re-dumped after the reconcile: byte-identical to
   the pre-reconcile dump apart from pg_dump's random `\restrict` token.
4. Fresh preview branch `batch-1-1-final` from commit `639e62b`
   (migrations folder = the baseline alone). The platform built it by
   replaying production's recorded history (status FUNCTIONS_DEPLOYED);
   then `supabase db reset --db-url <branch>` rebuilt it from the file on
   disk -- applied with no errors, and the history row it wrote matches
   production's exactly (350 statements, same md5). Schema dump diffs
   clean against the post-reconcile production dump (version header
   only); auth trigger, `authenticator` setting and `bank_holidays` rows
   match; RLS harness 215/215.

Side effect, explained: preview branches without a GitHub integration
are built by replaying production's recorded history. Until the
reconcile that was the 42 old migrations, which fail at 01 -- hence
`MIGRATIONS_FAILED` on every earlier branch and on the default `main`
branch record since 2026-10-04. A fresh branch now builds correctly.

**Flagged, not changed -- `service_role` has no table access in
production.** It holds only REFERENCES, TRIGGER, TRUNCATE, MAINTAIN on
all 14 tables and 14 views: no SELECT, INSERT, UPDATE or DELETE. No
archived migration revokes it; 05 says an unrecorded "hardening pass"
revoked DML and 05 restored it for `authenticated` only, while its own
comment expects `service_role` to write billing state. The baseline
reproduces production exactly, so this carries over. Anything using
the secret key (a billing sync) gets 42501. Decide whether that is
intended before building one.

Migration 01 depends on a pre-existing EverNest schema that no migration
creates, so this chain has NEVER been able to rebuild from zero. 01-04
were written to modify a schema built by hand in the dashboard: 01's
second statement is `select count(*) from families`, and `accounts`,
`transactions` and every other base table are only ever altered, never
created. That base schema is not recorded anywhere -- not in this repo,
not in `~/evernest`, not in `sorrel-backups` (the oldest dump, 2026-09-28,
postdates 01).

Found 2026-10-08: `supabase db push` of 01-43 to an empty preview branch
(`drift-rebuild-1`) failed at 01, statement 2, `relation "families" does
not exist` (42P01). The default branch has shown `MIGRATIONS_FAILED`
since 2026-10-04, which is consistent with this.

Consequences:

- No preview branch, `db reset` or new project has ever had this schema.
  Every "verified" claim in this file was verified against production
  only.
- The Section 1 drift question ("what exists only in production?") had
  no answer: the answer was "everything 01-04 assume".

Fix (decided 2026-10-08): squash. A schema dump of production becomes
`supabase/migrations/00000000000000_baseline.sql`; 01-43 move to
`supabase/migrations/_archive/` (the CLI ignores subdirectories --
checked 2026-10-08 with a probe file, absent from `migration list`). Git
keeps the history; the folder exists for reproducibility. A baseline
dumped from the database it is registered against cannot be wrong about
it, where reconstructing the pre-01 schema could only be guessed.

The baseline dump keeps ACLs (`--schema-only --no-owner -n public`), and
so does every verification dump: `--no-acl` would drop ~70 GRANT/REVOKE
statements and make that whole class of error invisible to the check.

Outside a `-n public` dump, carried into the baseline explicitly, each
read from production 2026-10-08:

- `on_auth_user_created` on `auth.users` -- the only non-internal trigger
  on that table.
- `alter role authenticator set pgrst.db_pre_request =
  'public.apply_user_timezone'` (from 40).
- `bank_holidays` rows (~110; 25, trimmed by 41) -- reference data
  `lib/businessDays.ts` reads. A schema-only baseline would leave it
  empty and no schema diff would notice.

Data statements that do NOT carry over, deliberately: one-time
corrections of rows that existed when they ran -- 03 (backfill of
pre-trigger users), 04 (`category_type`), 06 (liability sign), 11
(category replacement), 22 (`opening_date`), 24 (`next_due_date`), 29
(`requires_confirmation`), 30 (`date_tolerance_days`), 41 (`next_due_date`
recompute). A fresh database has no such rows. `bank_holidays` is the
only table without a `userid` and the only data a fresh database needs.

What a dump cannot capture at all is listed in `docs/supabase-config.md`.

### Archived files vs what production ran (2026-10-08)

Checked once, before the reconcile deletes the evidence: each file in
`_archive/` against its `supabase_migrations.schema_migrations.statements`
entry, the SQL that actually ran. Whitespace ignored; each statement's
`;` restored, since the CLI stores statements without it.

- 28 identical. 13 identical except comment lines after the last
  statement, which the CLI does not store (01, 02, 03, 04, 14, 15, 16,
  17, 22, 34, 39, 40, 41) -- a storage artefact, not an edit.
- **1 mismatch: 07 (`07_transfers`) was edited after it ran.**
  Production ran a bare `alter table transactions alter column
  categoryid drop not null;`. The file has that statement wrapped in a
  `do $do$` block guarded by an `information_schema.columns` check
  (`is_nullable = 'NO'`), plus a comment saying the guard matches the
  file's idempotent style. Nothing else in the file differs. The edit
  predates the file's only commit (`c3b3c1c`, 2026-08-25), so the repo
  never recorded what ran.

  Effect: none on production. Both forms leave `categoryid` nullable,
  the guard only makes a re-run a no-op, and the baseline diff confirms
  the end state. But it is the repo-doesn't-match-reality problem in a
  form the schema diff cannot see: edit a migration after applying it
  and nothing records that the file is not what ran. Applied migrations
  are never edited; a change is a new migration.

The full history table, statements included, is saved at
`sorrel-backups/2026-10-08/migration-history-before.txt`. Re-checked
against that file after the reconcile (2026-10-08): its 42 rows are
statement-for-statement identical to the live rows compared above, and
the comparison gives the same result -- 41 match, 07 differs.

Migration 10 never existed in git (this repo or `~/evernest`) and never
ran: production's history goes from `20260828000009` to
`20260828000011`.

## Section 1: `profiles -> auth.users` FK exists only in production (2026-10-06)

**Status: fixed in migration 39 (2026-10-06).**
`20261006000039_39_profiles_auth_users_fk.sql` recreates the FK with the
identical definition, renamed to `profiles_id_fkey`. Verified in production
afterwards: exactly one FK, `ON UPDATE CASCADE ON DELETE CASCADE`. The
diff of production against a fresh rebuild for other dashboard-only
objects: **closed 2026-10-08** -- no migration chain could rebuild at
all; the baseline replaces it and diffs clean against production,
`profiles_id_fkey` included. See "The migrations have never rebuilt the
database".

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
  Its only caller was the test harness `app/db-test/page.tsx`, deleted
  2026-10-07 (see "Error handling audit" below). It now has no caller in
  the repo.
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

### 4. `app/(app)/dev-projection/page.tsx`: deleted

This copy of the set was ignored by decision. It turned up on disk again
on 2026-10-06, untracked, after being recorded as deleted on 2026-10-04.
It was gitignored briefly, then deleted on 2026-10-06 and the ignore entry
removed. It was never committed.

## Error handling audit (2026-10-07)

Audit of reads, error copy, schema leaks, swallowed errors and Server Action
failures. `/db-test` was fixed on the spot. Everything else is decided below
and goes into ONE fix pass, in the order listed. It's one piece of work
across the same files; don't split it.

### Fixed: `/db-test` was deployed and wrote the visitor's data

`app/db-test/page.tsx` had no environment gate. Any signed-in user who
opened `/db-test` in production ran ~45 write calls against their own real
data: it created and archived accounts and categories, created and deleted
transactions and budgets, and called `updateProfile` seven times. It also
rendered raw PostgREST `code`/`message`/`details`/`hint`. RLS kept it to the
visitor's own rows. **Deleted 2026-10-07**, not gated: nothing needs it. Its
two-user isolation check is what `docs/rls-isolation-test.sql` already does
at the SQL layer, and CLAUDE.md now points there. Side effect:
`getDashboardKpis()` lost its only caller (see section 3 above).

### P1: an unreachable auth server signs everyone out

When Supabase Auth can't be reached, `getClaims()`/`getUser()` return an
`AuthRetryableFetchError` (status 0 on a network failure, 5xx/52x on an
outage). Three places read that as "not signed in":

- `lib/supabase/middleware.ts:61-67`: ignores the error. `claims` is null,
  so every protected request **redirects to `/login`**. A short Supabase
  outage signs out every user at once.
- `lib/auth/dal.ts:12`: `getUser()` error -> `null` -> `requireUser()`
  redirects to `/login`. Not logged.
- 15 `getClaims()` sites in `lib/db/*` (accounts, budgets, categories,
  goals, profile, recurring x4, settings x4, transactions x2): any
  `claimsError` becomes "Your session's expired". Not logged.

**Decision:** this is a third outcome, not "signed out" and not "signed in".
When middleware can't verify the session it must NOT let the request
through: "can't reach the auth server" is not "authenticated". It renders
an error state (503) saying the service is unreachable. It never redirects
to `/login`, and it never falls through to `NextResponse.next()`.
`requireUser()` and the 15 `getClaims()` sites make the same distinction:
`isAuthRetryableFetchError()` (public export of `@supabase/supabase-js`)
-> network-unreachable; a genuine auth failure -> auth-expired. The 15
sites go through one shared helper, not 15 copies of the check.

### P1 (equal): a failed read renders as a plausible zero

A failed read must render an error state, never a believable empty list
or zero. This app's premise is a number you can trust.

- `app/(app)/recurring/page.tsx:57-74`: failed accounts / balances /
  categories reads default to `[]`. A failed balances read shows **$0** as
  a card payment's estimate (`:157`), which is silently wrong money. A
  failed accounts read hides "Add schedule"; a failed categories read
  leaves the pickers empty.
- `app/(app)/accounts/page.tsx:135-136`: a failed categories read leaves
  the pickers empty.

The fix pass sweeps every `result.data ?? []` / `?? 0` / `?? null` in
`app/` and decides each one: error state, or a documented harmless
degradation like `holidays` on the recurring page, whose comment explains
why it's only a preview.

### 1. The classifier: one function, six classes

`describeReadError` and `describeWriteError` (`lib/db/errors.ts`) give the
same copy for a connect timeout, a missing GRANT (`42501`) and a genuine
bug. They are rebuilt on one `classifyDbError()` with these classes:

| Class | Detected by | User copy |
|---|---|---|
| network-unreachable | Supabase client's fetch-failure shape (below) | "We can't reach our servers right now. It's not you — try again in a minute." |
| auth-expired | `PGRST301`/`PGRST302`, JWT expired/invalid | existing "Your session's expired…" |
| permission-denied | `42501` | generic text; logged at error, because it's a GRANT bug |
| transient | `40001`, `40P01`, `55P03`, `57014`, `53300`, `08xxx` | existing "busy, try again" (reads get it too, not only writes) |
| not-found | `PGRST116` | per caller; often not an error at all (see `maybeSingle()` below) |
| unexpected | everything else | existing generic text |

**Shape-pinning test (required).** On a failed fetch `@supabase/postgrest-js`
(2.112.2) does not throw. It returns `{ code: "", message:
"<name>: <message>", details: "...Caused by: ... (<cause code>)", hint }`
with `status: 0` (`dist/index.cjs:394-434`). Detection relies on that
implementation detail. If an upgrade changes the shape, every network error
silently becomes "unexpected" and nothing fails. So a test drives a real
`PostgrestClient` with a `fetch` that rejects (a `TypeError("fetch failed")`
with an `UND_ERR_CONNECT_TIMEOUT` cause) and asserts that
`classifyDbError` returns network-unreachable. The upgrade then breaks a
test instead of the error handling. The auth side uses
`isAuthRetryableFetchError()`, which is public API and needs no pinning.

### 2. Copy: whose connection failed

Every database call runs on the Next server, so a server-side `fetch failed`
means the server can't reach Supabase. It does NOT mean the user is
offline. Three cases:

- Server can't reach Supabase: "We can't reach our servers right now.
  It's not you — try again in a minute."
- Browser offline (a Server Action or navigation failed in the browser):
  `app/error.tsx` checks `navigator.onLine` in an effect and shows "You
  appear to be offline." Today it says "Something on our end broke, not
  anything you did", which is wrong for someone who's offline.
- Everything else: the existing generic text.

"Check your connection" wording appears ONLY in the browser-offline case.

### 3. Auth error text leaks Supabase's raw message

`lib/auth/errors.ts:32` falls back to `error.message` for any unmapped
auth code. That message reaches login, signup, forgot-password and reset.
GoTrue's real messages include "Database error saving new user" and
"Database error querying schema", and a network failure shows "fetch
failed". **Decision:** a fixed sentence to the user, the raw message to the
server log.

The rest of the app is clean on schema leaks: `lib/db` returns only fixed
strings, and `error.tsx` shows only the digest.

### 4. Smaller items

- `app/(app)/transactions/[id]/edit/page.tsx:37`: `notFound()` on *any*
  `getTransaction` error, so a timeout shows "page not found". It also uses
  `.single()`, so a legitimately missing row is logged at error level. Move
  to `.maybeSingle()`: `null` -> `notFound()`, error -> load-error state.
- `app/(app)/transactions/AddTransactionForm.tsx:181`: if
  `updateAccountOpeningDateAction` fails, the button does nothing, with no
  message and no change. Show the error. This is the one direct action call
  that doesn't check `result?.error`.
- `components/quick-add/QuickAddBar.tsx:115`: `suggestCategoryAction` runs
  in a `setTimeout` with no catch, so a network failure is an unhandled
  promise rejection. Catch it; a missing suggestion is fine.
- Deliberate swallows: keep the behaviour, stop discarding the error. Log
  `components/TodayProvider.tsx:67` (`syncTimeZoneAction(...).catch(() =>
  {})`) and `lib/format.ts:94,107,123,139` (a malformed date renders blank).
  `lib/date.ts:11` (invalid zone -> UTC) is already guarded by its callers.
  The localStorage guards, the cookie `setAll` in `lib/supabase/server.ts`
  and the inline theme script stay as they are.

### Recorded, NOT in this fix pass: a thrown action loses the form

When a Server Action throws (browser offline, server crash), React sends it
to the nearest error boundary. `app/error.tsx` replaces the whole route and
anything typed into the form is lost. It isn't a false success: every
`useActionState` form only calls `onSuccess` on `!state?.error`, and every
other direct call checks `result?.error` (except `:181` above). But it's
heavy-handed. A real problem and a bigger change than the rest; decide
separately.

### Not an open item: a missing RLS policy looks like an empty list

RLS filters rows, it doesn't raise an error, so a table missing its
SELECT policy returns `[]`. No app code can tell that apart from a user
with no data. It isn't solvable at runtime. **Covered by
`docs/rls-isolation-test.sql`**, which asserts the policies exist and
isolate. Run it after any migration (see that file's header).

## Temporary code that must not ship

| Path | Purpose | Added | Status |
|---|---|---|---|
| `app/(app)/dev-projection/page.tsx` | Prints the signed-in user's safe-to-spend projection (income, obligations, daily balance, trough, cushion, result) to check it against real data. Dev-only (`notFound()` in production); reads through `getSafeToSpend()` under the user's session and RLS. | 2026-10-02 | Deleted 2026-10-06 (never committed; an earlier "deleted 2026-10-04" hadn't taken) |
| `app/db-test/page.tsx` | Data-layer test harness: ran every `lib/db` read and write as the signed-in user and printed raw PostgREST errors. **No environment gate**, so it was live in production and wrote the visitor's data. | 2026-08-15 | Deleted 2026-10-07. Isolation checks live in `docs/rls-isolation-test.sql`. |

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
