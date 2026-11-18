# Queue

The one written order of work. It holds pointers only: each item's detail
lives in its findings entry (docs/phase-7-findings.md) or spec. "Do this
next" means editing this file. Launch blockers live in the findings'
authoritative list, not here.

Last updated 2026-11-17.

## Next

In this order. Spec for all six: docs/Views-Search-Import-Layout.md.
Phase 1 report given 2026-11-13. #4 is shipped (see Done); the rest
wait on Matt's ruling, in this order.

1. ~~#4 — one bill shown twice~~ -- shipped 2026-11-14 (see Done).
2. **Safe-to-Spend-Why** -- shipped 2026-11-10 (see Done). Only its
   edit-path after-save note remains, and it stays deferred (below); it is
   still ahead of every feature from 3 on if Matt pulls it forward.
3. ~~#3 — account name on Coming up lines~~ -- deployed 2026-11-14
   (see Done).
4. ~~#1 + #2 — account pages (`/accounts/[id]`) and search~~ -- deployed
   2026-11-14 (see Done). The rest of "every number is a door" is under
   Deferred.
5. ~~#5 export~~ -- deployed 2026-11-14 (see Done).
6. ~~#5 import~~ -- deployed 2026-11-14 (see Done).
7. ~~#6 — dashboard layout~~ -- deployed 2026-11-14 (see Done).

Spec for the next four: docs/Log-Again-and-Goal-Links.md, in this order,
after import (deployed 2026-11-14). Raised 2026-11-16.

8. ~~Log it again~~ -- deployed 2026-11-16 (see Done). It copies the goal
   link since item 10 (deployed 2026-11-16).
9. ~~Goals, Phase 1 -- report only~~ -- reported 2026-11-16; ruled the
   same day. Order reversed by the ruling: transaction goal links first
   (they fix a confirmed double count), debt goals second.
10. ~~"Is this for a goal?" on one-time transactions -- migration 69~~ --
    deployed 2026-11-16 (see Done).
11. **Debt payoff goals that follow the card's balance -- migration 70.**
    Merged to main 2026-11-17 (`24ba18c`, `feat/debt-goals`); 70 on
    production (view-acl-check 17/0); deployed 2026-11-17. 70 on sorrel-dev
    (pushed, then docs/70-dev-update.sql for the 2026-11-17 rulings);
    debt-goal-test, rls-isolation-test and test:parity clean (Matt);
    view-acl-check 17/0; verified in the browser on dev, test rows deleted. Tester note:
    docs/tester-notes/2026-11-17-debt-goals-follow-card.md. 69 is deployed. On its own branch. Held 52 is reference only:
    re-derive, don't rebase. Liability = Credit Card or Loan through a new
    SQL twin, is_liability_account_type(), with a parity-test case.
    Completion is sticky: activity dated after it never reopens the goal.
    The bloom only in the response of the action that caused it.

Spec for the next five: docs/Motion-and-Delight.md, in this order. All
user-visible: each adds lines to the next What's new card with a new dated
cookie. Raised 2026-11-16.

12. **Motion batch A -- steps 0, 1, 2, 3, 4, 6** (foundation, small
    touches, Safe to Spend rolls, logging feels good, empty states, the
    dashboard drag). Sonnet. Merged to main 2026-11-16 (`571b1f1`,
    `feat/motion-and-delight-a`); deployed 2026-11-16. Also removed StatTile's count-up on mount (it now rolls on a
    change only, like the hero). Tester note: docs/tester-notes/2026-11-16-motion-and-delight.md.
13. **Batch B -- step 7**, app icons and home screen only. Sonnet. Merged to
    main 2026-11-16 (`03fe606`, `feat/motion-and-delight-b`); deployed
    2026-11-16. The launch bloom already exists
    (WelcomeBloom, first sign-in of the day, gated -- ruled 2026-11-16): no
    session bloom, no breathing, the mark stays static.
14. ~~**Batch C -- step 5**, goals that grow.~~ Merged `bb19676`, deployed 2026-11-17. Sonnet. After debt goals (70)
    merges: it changes the goal cards 70 touches. Its gold meter fill
    conflicts with CLAUDE.md ("gold never a meter fill"). Ruled 2026-11-16:
    CLAUDE.md wins over the doc -- the glow in A uses `--action`, and C's
    meters and leaves must follow the same rule (theme accent, never gold as
    a data colour).
15. **Batch D -- step 8**, seasons and time of day. Sonnet. After C. Note a
    hemisphere setting in Deferred when it lands.
16. **Batch E -- step 9**, your month as a story. **Opus**: it computes
    money figures and has privacy rules. After D. Phase 1 reported and
    ruled 2026-11-16. Merged to main 2026-11-17 (`cf1308f`, fast-forward
    of `feat/motion-and-delight-e`); 71 (`month_story()`, read-only) on
    sorrel-dev and production, user-day equivalence check differ = 0 on
    production. Deployed 2026-11-17. Tester note:
    docs/tester-notes/2026-11-18-month-recap.md.

Spec for the next five: docs/Decide-and-Grow.md, in this order (its
"Batches and order" table). The motion rules in docs/Motion-and-Delight.md
apply to all five. Each adds a tester note (Sent: not yet, not
before-deploy) for the next What's new card. Raised 2026-11-17.

17. **Batch I -- Coming up as a timeline.** Sonnet. Can start now. No
    migration, no write path: same data as the Coming up list, leaf from
    the hero's tightest day.
18. **Batch J -- lifetime milestones.** Sonnet. Can start now. Derived on
    read, celebrated once per device (localStorage); nothing stored in the
    database.
19. **Batch F -- the runway + "Can I afford it?"** Opus. Phase 1 (one report
    for F, G and H) given 2026-11-17; ruled the same day. Built on
    `feat/runway-what-if` 2026-11-17, verified on sorrel-dev. Merged to main
    2026-11-17 (`922e4d3`, fast-forward); deployed 2026-11-17.
    No migration. Ruled 2026-11-17: the figure keeps opening the breakdown;
    the runway opens from "See your runway" under the card and inside the
    breakdown, not from the figure (the spec's F1 said the figure).
20. **Batch G -- onboarding that grows.** Opus. After F; before any new
    testers. Ruled 2026-11-17. Built on `feat/onboarding-grows` and
    verified on sorrel-dev with a new user 2026-11-17 (every frequency,
    skip, step 3 = hero); not merged. Preceded by the privacy-policy cookie
    correction on main (`e3f9c65`). No migration. Open: one production
    user has an account, no transactions and no paycheck, so would see
    step 2 (counted read-only 2026-11-17); Matt to rule. Tester note:
    docs/tester-notes/2026-11-17-onboarding.md.
21. **Batch H -- goal pace.** Opus. After G.

## Launch blockers still open

See docs/phase-7-findings.md, "Launch blockers". As of 2026-11-10, 3
(WCAG; its repo-state notes say fixed, but it isn't struck through), 5
(custom SMTP) and 8 (verify the error-handling pass in a production build)
aren't struck through.

## For the next tester note

Lines waiting to go into the next note Matt sends (format:
docs/tester-notes/README.md). Move a line out when it's sent.

- Dashboard layout, deployed 2026-11-14: "You can now rearrange your
  dashboard: hold the grip on any card and drag it, or use the card's
  menu." Status: not yet sent.
- Goal links (migration 69, deployed 2026-11-16): draft in
  docs/tester-notes/2026-11-16-goal-links.md. Moves safe to spend. Next
  What's new card, with debt goals that follow a card. Not before-deploy.
- Debt goals that follow a card (migration 70, merged `24ba18c`, deployed 2026-11-17): draft in
  docs/tester-notes/2026-11-17-debt-goals-follow-card.md. Can move safe to
  spend (a linked goal's monthly hold goes). Next What's new card. Not
  before-deploy.
- Motion batch E, your month as a story (migration 71, merged `cf1308f`,
  deployed 2026-11-17): draft in
  docs/tester-notes/2026-11-18-month-recap.md. No number moves. Names the
  goal-funding-schedule gap (auto-link queued). Next What's new card. Not
  before-deploy.
- Batch G, onboarding (no migration, `feat/onboarding-grows`, not merged):
  draft in docs/tester-notes/2026-11-17-onboarding.md. No number moves for
  existing users. Next What's new card. Not before-deploy.
- Batch F, the runway and "What if…" (no migration, merged `922e4d3`,
  deployed 2026-11-17): draft in docs/tester-notes/2026-11-17-runway-and-what-if.md.
  No number moves. Next What's new card. Not before-deploy.
- Motion batch D, seasons and time of day (merged `e1db401`, deployed 2026-11-17): draft in
  docs/tester-notes/2026-11-17-seasons-and-time-of-day.md. No number moves. Next What's new
  card. Not before-deploy.
- Motion batch C, goals that grow (merged `bb19676`, deployed 2026-11-17): draft in
  docs/tester-notes/2026-11-17-goals-that-grow.md. No number moves. Next What's new
  card. Not before-deploy.
- Motion batch A (merged `571b1f1`, deployed 2026-11-16): draft in
  docs/tester-notes/2026-11-16-motion-and-delight.md. No number moves. Next
  What's new card. Not before-deploy.
- Log again (deployed 2026-11-16): draft in
  docs/tester-notes/2026-11-16-log-again.md. Goes in the next What's new
  card with a new dated cookie, beside the goal features. Not before-deploy.

## Held

| Item | Since | Held until | Where |
|---|---|---|---|
| `feat/linked-goals`: migration 52, a goal's progress read from a linked account | 2026-10-26 | After the beta. It must be re-derived on top of 53, 57 and everything since, not just given a new timestamp. | Findings, "Held branches that touch goals"; the branch's own commits |
| `fix/policy-notice-by-email-or-app` (`b3fcae6`): the privacy policy's "Changes" clause and the terms' "Changes" clause say "by email or by a notice in the app" instead of "email" | 2026-11-16 | Bundle with the next policy-change email (likely public launch). Merging it without that email would itself break the current notice clause. The policy's "Last updated" dates stay as they are. | Findings, "Import deployed without the policy-change email" |

## Deferred

| Item | Recorded | Decide or do when | Where |
|---|---|---|---|
| A real "last day of the month" option and a semi-monthly frequency, together. Today onboarding's "Last day of the month" anchors a Monthly schedule's start_date on a 31st (it clamps to every month's end), and "twice a month" is two Monthly schedules. Both work with no migration but read as "Monthly on the 31st" and as two schedules. A proper frequency needs rectx_frequency_check, the cadence (lib/recurringCadence.ts) and its wording | 2026-11-17 | Unscheduled | `lib/onboarding.ts` (`lastDayAnchor`, `paycheckPlans`); docs/Decide-and-Grow.md, rulings for G |
| Hemisphere setting for the seasonal leaf. Batch D picks the season from the month, northern hemisphere; a southern-hemisphere user sees the wrong one. Needs a setting (a settings column, so a migration) and a Settings control. The doc's own note ("Note a hemisphere setting in the queue") | 2026-11-17 | Unscheduled | `lib/timeOfDay.ts` (`seasonForMonth`); docs/Motion-and-Delight.md, step 8 |
| Bloom after an import that completes a goal. 70 records the completion (a followed card paid to zero by imported rows, or reopened by them) but no panel shows: import's response doesn't run the completion check. Edits, deletes and balance resets also complete quietly, by ruling (2026-11-17) | 2026-11-17 | Unscheduled | `lib/goalCompletionCheck.ts`; `lib/actions/import.ts` |
| Auto-link a goal-funding schedule's confirmed occurrences to its goal (goals.funding_recurringid), so the goal's progress moves when the transfer is confirmed. Today the hold already skips a funded goal, but confirming writes no link | 2026-11-16 | After 69 and 70 merge | Findings, "A transfer for a goal came off safe to spend twice" |
| Drag-and-drop library: classic `@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0, pinned exactly (chosen 2026-11-14: stable over active, one sortable list, small footprint; the new `@dnd-kit/react` line is 0.x). Revisit: move to the new line if classic breaks on a React upgrade, or when the new line reaches 1.0 | 2026-11-14 | On a React upgrade, or `@dnd-kit/react` 1.0 | `package.json`; `app/(app)/dashboard/DashboardSections.tsx` |
| "Every number is a door", the rest: an upcoming line opens its schedule; "(average of last 3)" opens the three confirmations it averaged; a goal's progress opens its contributions. The first three (budget spent, a category, the low-point item) shipped with #1 + #2 | 2026-11-14 | After #5 export | docs/Views-Search-Import-Layout.md, "Suggest other views" |
| Same-bill question for HAND-ENTERED past rows: a past-dated unlinked entry meeting an occurrence still waiting in the confirmation queue (today the queue asks "Did rent come out?" and "It landed" writes it twice). Import asks this for its own rows only (`findImportSameBill`, `lib/sameBill.ts`); the same match for existing rows is not built | 2026-11-14 | After import is deployed | docs/Import-CSV.md, step 12; `lib/sameBill.ts` |
| Excel (`.xlsx`) import. Audit `read-excel-file` first (SheetJS is not on npm past 0.18.5 and has two read-time vulnerabilities). v1 says "Save As CSV UTF-8" | 2026-11-14 | Two or more testers ask for `.xlsx` | docs/Import-CSV.md, "The library" |
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

- **A transaction can be for a goal (migration 69).** Merged to main
  2026-11-16 (`8570469`, `feat/transaction-goal-links`); 69 on sorrel-dev
  and production before the push; deployed 2026-11-16. transactions.goalid
  links an expense or a transfer's Expense leg (never income); v_goal_money
  is the one source of goal money for progress, the monthly holds and
  completion. Fixes the double count: a $200 transfer to savings linked to
  its goal leaves safe to spend as it was. Optional Goal field ("Is this for
  a goal?" for a transfer leaving the spendable set), "Is this the same
  money?" after a save that links, goal named in delete confirmations, Log
  again copies the link. Checked: goal-monthly-holds-test.sql,
  rls-isolation-test.sql and test:parity on dev (Matt); view-acl-check on
  dev and production (17 views, 0 failed); the browser run on dev, all
  test rows deleted. Not checked by hand: "No, keep both", the question
  after an edit, completion by a linked transaction (the SQL test covers
  it). No bloom when a transaction completes a goal -- it arrives with 70's
  shared helper. Tester note: docs/tester-notes/2026-11-16-goal-links.md
  (Sent: not yet, next What's new card).

- **Log it again.** Merged to main 2026-11-16 (`86fb9dd`, `feat/log-again`); deployed 2026-11-16.
  "Log again" on a transaction's row (Transactions and account pages) and edit screen
  opens the add form pre-filled (account, type, category, description, amount;
  a transfer's from and to), dated today, amount selected; never saves in one
  tap. Quick add gets a "Recent" strip: the five most recent distinct
  (description, account, category) from the last 60 days, derived on read. No
  migration; no number moves. Checked by hand on sorrel-dev: expense, income and
  transfer, close-without-save, and a Recent tap through to Save; all test rows
  deleted, balances back to start. Not checked: Log again from the edit screen,
  mobile. Tester note (draft, Sent: not yet):
  docs/tester-notes/2026-11-16-log-again.md, for the next What's new card.

- **Transaction import (#5 import).** Merged to main 2026-11-14 (`a3f507a`,
  `feat/import-csv`); migration 68 on sorrel-dev and production;
  deployed 2026-11-14. CSV only, parsed in the browser (PapaParse 5.7.1,
  pinned exactly; 5 MB and 5,000-row caps); the file is never uploaded and
  its name never kept. The preview shows the balance change from the
  database's rule (`import_preview` -> `counts_in_balance`); one atomic
  function writes the confirmed rows, one atomic function undoes the batch
  (Settings > Import). Required, no-default answers: money-out sign,
  ambiguous dates, the pre-anchor question, a category for each group of
  unmatched rows (the schema needs one), and "Is this the same bill?" for
  each row that matches a queue occurrence. Tester note:
  docs/tester-notes/2026-11-16-import.md (the privacy policy changed with
  it). Checked on production by `docs/import-production-check.sql`
  (read-only). Not built: the same-bill question for hand-entered past
  rows, and `.xlsx` (both under Deferred).

- **Export from the Transactions screen, import entry and duplicate
  check, account links (#5 follow-ons).** Merged to main 2026-11-14
  (`db782c4` `feat/transactions-export-and-account-links`, `6675cbc`
  `feat/import-dupe-check-and-entry`); deployed 2026-11-14. No migration;
  no tester-visible number moves, so no tester note. Export on the
  Transactions screen exports exactly the list's filters, every matching
  row, through the list's own filter query (`selectFiltered`); Settings'
  download is the same function with no filters; the filters name the file
  and the button states its scope. A transfer's two legs always travel
  together, so a file holds the list's count plus one row per transfer.
  The Transactions screen opens the same import flow (an account filter
  preselects it), and the server now re-runs the duplicate check and
  refuses any flagged row the request doesn't mark as included. Account
  names link to `/accounts/[id]` (`components/AccountLink.tsx`) on the
  Accounts screen, the dashboard card and onboarding list, the Transactions
  table, recurring rows and Settings > Past imports. Not yet checked by
  hand: filtered-export counts against the list, the import second pass,
  and a refused unticked duplicate. Not linked, by decision: goals'
  suggested transfers, form and picker options, prose mentions.

- **Dashboard layout (#6).** Fast-forwarded to main 2026-11-14
  (`0a40d65`, `feat/dashboard-layout`); deployed 2026-11-14. Testers
  asked to drag cards directly, so the planned edit-mode and up/down
  version was never shipped. Each card has a grip (long-press on touch)
  and a menu (Move earlier / Move later / Hide); a drop saves with an
  Undo toast; the Safe to Spend hero is pinned and can't be hidden.
  Cards have a fixed size in code (small, wide, full) and flow in saved
  order: 4 columns from 1280px, 2 on a tablet, 1 on a phone. Income and
  Spending are two small sections. Stored as ordered section names
  (migration 67, on sorrel-dev and production before the merge; no
  saved layouts existed on production). Library choice and revisit
  trigger: Deferred. Not built, by choice: dense packing (it would
  break visual vs keyboard order). Tester note: no standalone note (no
  number moves). Include in the NEXT tester note: "You can now rearrange
  your dashboard: hold the grip on any card and drag it, or use the
  card's menu." Status: not yet sent.

- **Transaction export (#5 export).** Merged to main 2026-11-14
  (`d4c2dd9`, `feat/export-csv`); deployed 2026-11-14. "Download
  transactions" in Settings: a CSV of every transaction, UTF-8 with BOM,
  formula-injection guard. The column layout is import's first format
  (`lib/transactionExport.ts`): columns are only ever added at the end.
  Privacy and terms now point to the button, with email kept for
  everything else. Downloaded and checked on dev by Matt. Read only: no
  migration, no number moves. Tester note:
  docs/tester-notes/2026-11-15-export.md.

- **Account name on Coming up lines (#3).** Merged to main 2026-11-14
  (`2b40ead`, `feat/coming-up-account-name`); deployed 2026-11-14.
  Each Coming up line ends with the account, a transfer with
  both ends ("Checking → Visa"), in neutral ink. UI only: no migration,
  no number moves, so no tester note. Render tests in
  `app/(app)/recurring/ConfirmationQueue.test.tsx`.

- **Account pages and search (#1 + #2).** Merged to main 2026-11-14
  (`455ba15`, `feat/transaction-list-filters`); deployed 2026-11-14.
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
