# Queue

The one written order of work. It holds pointers only: each item's detail
lives in its findings entry (docs/phase-7-findings.md) or spec. "Do this
next" means editing this file. Launch blockers live in the findings'
authoritative list, not here.

Last updated 2026-11-14.

## Next

In this order. Spec for all six: docs/Views-Search-Import-Layout.md.
Phase 1 report given 2026-11-13. #4 is shipped (see Done); the rest
wait on Matt's ruling, in this order.

1. ~~#4 — one bill shown twice~~ -- shipped 2026-11-14 (see Done).
2. **Safe-to-Spend-Why** -- shipped 2026-11-10 (see Done). Only its
   edit-path after-save note remains, and it stays deferred (below); it is
   still ahead of every feature from 3 on if Matt pulls it forward.
3. ~~#3 — account name on Coming up lines~~ -- merged 2026-11-14, not
   yet pushed (see Done).
4. ~~#1 + #2 — account pages (`/accounts/[id]`) and search~~ -- merged
   2026-11-14, not yet pushed (see Done). The rest of "every number is a
   door" is under Deferred.
5. ~~#5 export~~ -- merged 2026-11-14, not yet pushed (see Done).
6. **#5 import** -- its own spec first, which Matt is writing (ruled
   2026-11-14: no spec exists yet). Not built until then.
7. **#6 — dashboard layout**, scoped down: reorder and hide, hero
   pinned. Ask first whether a tester asked for it.

## Launch blockers still open

See docs/phase-7-findings.md, "Launch blockers". As of 2026-11-10, 3
(WCAG; its repo-state notes say fixed, but it isn't struck through), 5
(custom SMTP) and 8 (verify the error-handling pass in a production build)
aren't struck through.

## Held

| Item | Since | Held until | Where |
|---|---|---|---|
| `feat/linked-goals`: migration 52, a goal's progress read from a linked account | 2026-10-26 | After the beta. It must be re-derived on top of 53, 57 and everything since, not just given a new timestamp. | Findings, "Held branches that touch goals"; the branch's own commits |

## Deferred

| Item | Recorded | Decide or do when | Where |
|---|---|---|---|
| "Every number is a door", the rest: an upcoming line opens its schedule; "(average of last 3)" opens the three confirmations it averaged; a goal's progress opens its contributions. The first three (budget spent, a category, the low-point item) shipped with #1 + #2 | 2026-11-14 | After #5 export | docs/Views-Search-Import-Layout.md, "Suggest other views" |
| Quick add on an account's page doesn't start on that account (the full Add transaction form does) | 2026-11-14 | Unscheduled | docs/Views-Search-Import-Layout.md, "The account page" |
| Occurrences "filled" by a linked row, derived on read: the projection, Upcoming and the queue each treat an occurrence as filled while a linked row sits in its window, and the queue walks past filled cycles. The eventual shape for #4's "Yes"; v1 links and advances the cursor in one SQL function instead (ruled 2026-11-14: the derived form rewrites three readers and the queue cursor mid-beta) | 2026-11-14 | After the beta | docs/Views-Search-Import-Layout.md, item 4 |
| Budget progress counts future-dated transactions, but the balance doesn't (budget vs balance) | 2026-11-10 | Before commercial launch | Findings, same title |
| After-save "doesn't change your figure" note on the edit paths | 2026-11-10 | Unscheduled (the create-path note shipped 2026-11-10) | docs/Safe-to-Spend-Why.md, "What it costs" |
| Amount window with a lead time (1c): optional update of a variable amount before it's due, in the queue | not dated in the repo | Unscheduled | docs/Recurring-Amounts-and-Transfer-Editing.md, 1c. **No findings entry yet**: needs one with the dates it was raised |
| A statement date has no tolerance: the "enter the amount" window opens on `statement_day` wherever the statement actually posted | 2026-10-31 | When a tester hits it | Findings, "Recurring dates: what each one means" |
| Goal money columns are bare `numeric` | 2026-11-03 | After 52 is decided (it touches the views 52 replaces) | Findings, same title |
| In-app "what changed" surface | 2026-11-03 | At commercial launch | Findings, "Commercial launch, not beta" |
| Forms require JavaScript | 2026-10-27 | After the beta | Findings, "Known limitation: forms require JavaScript" |
| `record_login()` writes on render, and the streak rebuilt as days opened: one job | 2026-10-10 | After the launch blockers | Findings, "`record_login()` writes on every page load" and "Streak: redefined as days opened" |

## Done, still named in conversation

Listed so they aren't queued again.

- **Transaction export (#5 export).** Merged to main 2026-11-14
  (`feat/export-csv`); not pushed yet, so not deployed. "Download
  transactions" in Settings: a CSV of every transaction, UTF-8 with BOM,
  formula-injection guard. The column layout is import's first format
  (`lib/transactionExport.ts`): columns are only ever added at the end.
  Privacy and terms now point to the button, with email kept for
  everything else. Downloaded and checked on dev by Matt. Read only: no
  migration, no number moves. Tester note:
  docs/tester-notes/2026-11-15-export.md.

- **Account name on Coming up lines (#3).** Merged to main 2026-11-14
  (`2b40ead`, `feat/coming-up-account-name`); not pushed yet, so not
  deployed. Each Coming up line ends with the account, a transfer with
  both ends ("Checking → Visa"), in neutral ink. UI only: no migration,
  no number moves, so no tester note. Render tests in
  `app/(app)/recurring/ConfirmationQueue.test.tsx`.

- **Account pages and search (#1 + #2).** Merged to main 2026-11-14
  (`feat/transaction-list-filters`); not pushed yet, so not deployed.
  One filterable list (`TransactionsView`) behind both `/transactions`
  and `/accounts/[id]`; filters in the URL (account, category, type,
  dates, text; `lib/transactionFilters.ts`). Search covers description,
  notes, category, account and an exact amount, server-side. A filter
  that matches one leg of a transfer now shows the whole transfer.
  Doors: accounts (list, dashboard, Safe to Spend breakdown), budget
  spent, category name, the low-point items. UI and reads only: no
  migration, no number moves, so no tester note.

- **"Is this the same bill?" (#4).** Merged 2026-11-14 (`e7d348e`,
  `feat/same-bill-pair`), migration 66 on sorrel-dev and production the
  same day. A schedule's next occurrence and a future-dated entry for
  the same bill were both counted (5 pairs, one user, on 2026-11-13);
  Sorrel now asks. "Yes" links the entry and steps the schedule past
  the occurrence; deleting it puts the occurrence back, or the delete
  confirmation says it won't. docs/same-bill-test.sql and
  docs/rls-isolation-test.sql passed every row on dev. Tester note:
  docs/tester-notes/2026-11-14-same-bill.md. The derived-on-read
  version is deferred (below).

- **Safe to spend says why it's the number it is.** Shipped 2026-11-10
  (`feat/safe-to-spend-why`, `888b7fe`): the cause on the closed card, the
  room after the tightest day in the breakdown, and the note after a save
  on the create paths. Spec: docs/Safe-to-Spend-Why.md. The after-save
  note on the edit paths is still deferred (below). No tester note: copy
  only, no number moved.
- **Squeeze points ("What's ahead").** Shipped 2026-10-01 (`8b67f1f`,
  `feat/whats-ahead` merged). The part still missing, tying the low point
  to the figure, is "Next" item 1.
- **The February `statementDateForCycle` bug.** Fixed 2026-10-31 (merge
  `8860140`). It wasn't February-only: any due day of 28 or later broke in
  short months. Findings, "Recurring dates", "Short months walked back to
  the wrong statement". The statement-date item still deferred above is a
  different gap.
