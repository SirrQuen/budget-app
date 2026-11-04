# Phase 7.5 — The fix pass

> **Historical spec (sent 2026-10-07, added to the repo 2026-11-03).** Kept for
> the reasoning behind decisions. It describes work as planned, not as it
> stands: the code, CLAUDE.md and docs/phase-7-findings.md are the authority
> where they differ.

**Everything the audit found, ordered so each fix stands on solid ground.**

---

## What the audit actually found

Fourteen sections, and the findings cluster into two themes worth naming before you start fixing them.

**Your app tells the wrong story when something goes wrong.** A network blip reads as a logout. A timeout reads as "not found." A failed read renders as an empty list with $0 in it. A server outage reads as the user's fault. Each one looks minor alone; together they mean that at the exact moment someone needs to trust your app about their money, it confidently misinforms them.

**Invariants asserted in prose weren't enforced in code.** "Uses the same rule as isSafeToSpendCommitment." "Clears 4.5:1 on --page." "Transfers unsupported." "This FK is cascade." Every one of those was wrong, and every one survived because it *sounded* authoritative. Three separate findings trace back to a comment nobody checked.

The fixes below address both. Where a fix restores an invariant, it comes with a test that *enforces* it, because the lesson of this audit is that a sentence is not a guarantee.

---

## How to run this phase

**One batch per pull request.** Branching is enabled now, so every PR replays your migrations from scratch against an empty database before it can merge. That gate is the single most valuable thing Phase 7 bought you — use it.

**Batches are ordered by dependency, not by section number.** Batch 1 is the foundation; everything else assumes it.

**After each batch, re-run the audit sections it invalidates.** Listed per batch. Skipping this is how a fix pass quietly reintroduces what the audit removed.

**Take a fresh `pg_dump` before Batch 1.** Same procedure as before Phase 7 — schema and data, `public` and `auth`. Batch 1 is the only one that touches schema, and it's the one you'd want to roll back.

---

# Batch 1 — Schema and data integrity

**The foundation. Nothing else is worth doing until your migrations reproduce your database.**

### 1.1 Close the Section 1 drift

Write migrations for everything that exists only in production. The register from Section 1 Step 3 is the input.

Specific items already known:

- **`profiles → auth.users` cascade.** No migration creates it, and `delete_own_account()` depends on it. A rebuilt database would not have it, which means account deletion would behave differently there — and "there" includes any disaster recovery.
- Everything else `schema-drift.txt` turned up, especially the categories that don't come from `CREATE TABLE`: policies, grants, indexes, constraints, triggers, functions, and view options.

**The rule for this step:** never write a migration that drops something you can't account for. An unexplained object in production gets investigated, not deleted.

**Done when:** a preview branch rebuilds from migrations and `pg_dump --schema-only` of that branch diffs clean against production, modulo project identifiers and generated comments.

### 1.2 Composite foreign keys

The structural fix for cross-user references. Section 3 confirmed empirically that user B can plant rows pointing at user A's accounts and categories, and that this can permanently block A's account deletion.

The WITH CHECK mitigation is already in. This replaces it with enforcement the database applies for every role in every context — including anything that bypasses RLS, which the WITH CHECK does not cover.

```
Add unique constraints on (userid, id) for each user-owned parent, then rewrite
each child foreign key as composite:
  transactions(userid, accountid)        → accounts(userid, id)
  transactions(userid, categoryid)       → categories(userid, id)
  recurring_transactions(userid, accountid)    → accounts(userid, id)
  recurring_transactions(userid, to_accountid) → accounts(userid, id)
  recurring_transactions(userid, categoryid)   → categories(userid, id)
  investments(userid, accountid)         → accounts(userid, id)
  categories(userid, groupid)            → category_groups(userid, id)
  ...and any others the Section 3 blockers query covered.

Before adding each constraint, confirm no existing row violates it. The Section 3
cleanup should have removed the planted rows; this is the check that nothing else
is lurking.

Keep the WITH CHECK conditions. Two layers is correct — the FK is the guarantee,
the policy is the early, legible error.

Validate the whole migration on a preview branch before it goes near production.
```

**Watch for:** branching runs migrations in a single transaction, so any non-transactional statement (`CREATE INDEX CONCURRENTLY` and friends) will fail on the branch while working with `db push`. That's the known limitation, not drift.

### Re-run after Batch 1

- **Section 1** — rebuild from zero, clean diff
- **Section 3** — the full isolation harness, all 172 assertions
- **Section 5** — account deletion, including the case with a foreign row present

---

# Batch 2 — One rule, one implementation

**Section 7. The "leaves the set" classifier exists in four places and they agree by coincidence.**

### 2.1 The easy consolidations

```
dashboard.ts:777 (Spendable Cash) and dashboard.ts:670 (getIncomeSchedules):
replace the hand-written ["Checking", "Savings"] lists with
[...SPENDABLE_ACCOUNT_TYPES] and isSpendableAccountType.

Spendable Cash is the higher priority of the two: if the starting balance and the
obligations disagree about which accounts are in the set, the hero number is
wrong.
```

### 2.2 The SQL function and the test that matters

```
Create leaves_spendable_set(from_type, to_type) as the single SQL-side
implementation. The cushion query calls it instead of carrying its own copy.

Two implementations will still exist — one per language — because SQL can't call
TypeScript and the projection classifies future occurrences that don't exist as
rows. What makes that safe is the test:

  - It enumerates account-type pairs FROM THE ENUM, never from a hardcoded list.
    Adding a fourth account type must automatically create new cases and FAIL if
    only one side was updated. That property is the whole point.
  - It covers both halves of a transfer, since the two versions currently derive
    "leaves the set" differently — SQL from transfer_group_id, TypeScript from
    to_account_type.

Then fix the comment in the migration. "Uses the same rule as
isSafeToSpendCommitment" asserted a guarantee it didn't provide. Make it true or
delete it.
```

### 2.3 The fourth definition

```
v_dashboard_summary.cash_balance includes Cash accounts and disagrees with every
other definition of "cash" in the app.

Confirm nothing reads it — the app, saved SQL, anything in the Supabase
dashboard. If genuinely unused, DROP IT. An unused view with a wrong definition
and an authoritative column name is a trap for whoever next needs a cash balance
and finds one ready-made.
```

### Re-run after Batch 2

- **Section 7** — the classifier audit
- **Section 6b** — the live projection print, checked against your own finances

---

# Batch 3 — Error handling

**Section 10, entire, in the order Claude Code proposed. Take all of it — it's one piece of work and splitting it means reading the same files twice.**

### 3.1 The classifier

```
One function in lib/db/errors.ts sorting errors into: network-unreachable,
auth-expired, permission-denied, transient, not-found, unexpected. Both describe
functions use it, and the getClaims sites use it through a shared helper.

Pin the detection shape with a test. It currently keys on the Supabase client
returning code: "" with the cause in details — an implementation detail that a
@supabase/postgrest-js upgrade could change, at which point every network error
silently reclassifies as "unexpected" and nothing fails. The test makes that
upgrade break loudly.
```

### 3.2 Stop signing everyone out during an outage

**The most severe functional bug in the audit.** `AuthRetryableFetchError` is treated as unauthenticated, so a short Supabase outage redirects every user to `/login`.

```
Distinguish AuthRetryableFetchError from a genuine auth failure, in
middleware.ts:61, lib/auth/dal.ts:12, and the 15 getClaims() sites.

THE TRAP: when middleware cannot verify a session it must NOT let the request
through. "Can't reach the auth server" is not "authenticated." The correct
outcome is a third state — a service-unreachable error — not a redirect and not a
pass. The naive fix here is a security hole.
```

### 3.3 Three messages, not one

```
  - Server can't reach Supabase:
    "We can't reach our servers right now. It's not you — try again in a minute."
  - Browser offline, via navigator.onLine in error.tsx:
    "You appear to be offline."
  - Everything else: the existing generic text.

"Check your connection" appears ONLY in the browser-offline case. These queries
run on the server, so a fetch failure there is not the user's connection.
```

### 3.4 Never render a plausible zero

```
recurring/page.tsx:57-74 and accounts/page.tsx:135-136 default to [] on a failed
read. On the recurring page that shows $0 for card-payment estimates — a money
figure that is silently wrong.

A failed read renders an error state. Never an empty list, never a zero. This
app's premise is a number you can trust.
```

### 3.5 The rest

```
  - lib/auth/errors.ts:32 — fixed sentence to the user, raw message to the log.
    "Database error saving new user" must never reach a signup form.
  - transactions/[id]/edit/page.tsx:37 — .maybeSingle(), so null means not found
    and an error means a load failure.
  - AddTransactionForm.tsx:181 — check result?.error; the button currently fails
    in silence.
  - QuickAddBar.tsx:115 — catch the setTimeout rejection.
  - TodayProvider.tsx:67, lib/format.ts, lib/date.ts:11 — log the deliberate
    swallows instead of discarding them.
```

**Not in this batch:** the thrown-action case that replaces the route with `error.tsx` and loses typed input. Real, bigger, deferred on purpose.

### Re-run after Batch 3

- **Section 10** — the full error-handling audit

---

# Batch 4 — Visual and accessibility

### 4.1 The red rule, settled

```
Replace the red rule in CLAUDE.md and delete the contradictory line listing
critical red as a status colour:

  Red never describes the user's money. Never for negative amounts, over-budget
  states, low balances, shortfalls, spending levels, or any value or status
  derived from someone's finances.

  Red is permitted in exactly three places:
    1. The Sorrel mark
    2. Destructive-action affordances — delete confirmations, irreversible
       operations
    3. Form validation errors and error banners

  Items 2 and 3 describe the interface. Item 1 is the brand. Anything describing
  the user's money is out.

REMOVE:
  - format.ts:185 → Amount.tsx:8, the red tone for negative amounts. This is
    precisely what the rule exists to prevent. Inert today only because StatTile
    overrides it, which makes it a landmine rather than a non-issue.
  - The warning icons on SafeToSpendWindowToggle:121 and ThemeToggle:92. Neither
    is destructive.

KEEP: all error text, ErrorMessage, Button variant critical, every delete
confirmation, DeleteTransactionButton hover, the delete-account panel, the failed
quick-add row.

CATEGORY COLOUR SLOT 8: keep the colour in the picker — a user choosing red for
their own category is their choice about their own data. But change the seeded
defaults in migration 11 (Entertainment, Dues & Subscriptions) to non-red, so red
is never a default.
```

### 4.2 Contrast — non-negotiable

```
  1. --critical fails AA for text on dark: 3.18 / 3.51 / 3.82 by surface, and
     3.07 on the delete-panel tint. Lighten the DARK token until it clears 4.5:1
     on the WORST surface. Leave the light value alone — it passes. Report the
     measured ratio on all four surfaces.
     Fix the comment in globals.css too; "clears 4.5:1 on --page" is true only
     in light.

  2. --ink-muted at 4.26 on surface-raised. Affects every input placeholder in
     the app, including the Quick add box on every page.

  3. Field borders at 1.32 / 1.36 fail WCAG 1.4.11 (3:1 for UI component
     boundaries). Field edges are effectively invisible. Fix the shared field
     style, not each form — this is the most pervasive issue in the audit.

  4. Focus ring at 2.05–2.58, same criterion. "It passes because the border also
     turns solid" is two sub-threshold signals, not a pass.

  5. Over-budget meter fill at 2.56 against its track, light theme.

  6. CategoryForm.tsx:152 — the selected swatch's focus change is 1.79:1, so the
     first tab stop in that group is invisible. Use the global focus outline.

  7. tabular-nums on SafeToSpendHero.tsx:90 and :277-320.

  8. 320px reflow overflows on /transactions (11px), /settings (17px) and
     /categories (clipped names). WCAG 1.4.10 Reflow is Level AA and specifies
     320 CSS pixels — these are AA failures, not bonus findings.
```

### 4.3 Documentation drift

```
CLAUDE.md's light chart surface (#FBFAF7) and its light category colours don't
match globals.css. Make the doc match the code, or the code match the doc, but
not both wrong.
```

### Re-run after Batch 4

- **Section 11, including the half that couldn't be done.** The contrast measurements were computed from tokens and are solid; the live visual pass and the keyboard tab-through were not. Re-run them **with a populated account** and **in a foreground browser window**, so meters, rows, error states and the held "Without a paycheck" control are actually seen, and Tab actually moves focus.

---

# Always last

**Section 14 — production build and secret leak check.** Run it after the final batch, never before. A clean build at the start of a fix pass tells you nothing about the end of one.

```
  Remove-Item -Recurse -Force .next
  npm run build
```

Zero errors, zero warnings, no `service_role` or `SUPABASE_SERVICE` strings anywhere in the built client output, `.env.local` absent from all git history.

---

## Not being fixed, on purpose

Record these as decisions rather than oversights, so they don't get rediscovered:

| Item | Why it stands |
|---|---|
| **Audit log retains the deleted user's id** | Security logs have their own basis and retention. Must match whatever the privacy policy says. |
| **`username_is_available` is anon-callable** | Signup needs it before there's a session. Rate-limit it before launch rather than removing it. |
| **A missing RLS policy is indistinguishable from an empty result** | Not solvable at runtime. The control is `docs/rls-isolation-test.sql`. |
| **Thrown Server Action replaces the route and loses typed input** | Real, and a bigger change than anything else in Section 10. |
| **Streak-strip milestone mark TODO** | Visual polish. |

---

## What's left after this

The fix pass closes the audit. These were never findings — they're things that don't exist yet, and they belong to **Phase 8**:

- **A marketing page.** `app/page.tsx` still redirects, so a stranger who reaches your domain sees a login form with no explanation of what they're logging into.
- **Privacy policy and terms of service.** The real item behind the Settings TODO. For an app holding other people's bank balances this is real work, and it has to accurately describe what you actually do — including the audit-log decision above.
- **Custom SMTP** on `mysorrel.com`, with SPF, DKIM and DMARC.
- **The PITR decision.** Pro gives daily snapshots, so worst-case loss is 24 hours. Decide deliberately rather than by default.

---

## Sequencing

| Sitting | Batch | Then re-run |
|---|---|---|
| 1 | Backup, then Batch 1.1 — drift | Section 1 |
| 2 | Batch 1.2 — composite FKs | Sections 1, 3, 5 |
| 3 | Batch 2 — the classifier | Sections 7, 6b |
| 4–5 | Batch 3 — error handling | Section 10 |
| 6 | Batch 4 — visual and accessibility | Section 11, both halves |
| 7 | Section 14, then Phase 8 | — |

Batch 1 is the one to do while fresh. It's the only batch that can lose data if it goes wrong, and it's the only one everything else depends on.
