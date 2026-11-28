# Goals and import: four changes

This spec covers four changes in three parts:
- **Part A:** more than one recurring schedule can feed a goal, and the user can link any one-time transaction to a goal.
- **Part B:** a debt payoff goal that follows a credit card keeps exact track of the card from its transactions: payments, new charges, interest, fees and refunds.
- **Part C:** import reads Excel files as well as CSV, and the user chooses which.

The goal parts (A and B) share a model, so they share one Phase 1 report, then build as two branches: A, then B. Part C is separate and can run alongside them. **Each part is its own branch.**

---

# Rulings after Phase 1 (2026-11-28)

**Where these rulings differ from Parts A and B below, the rulings win.** Phase 1 showed that several of the spec's premises were wrong:
- the link lives on the goal, not the schedule;
- confirmed occurrences aren't linked;
- no monthly normalisation exists;
- pace is based on history;
- there's no anchor history.

## Part A

1. **First, auto-link confirmed occurrences.** When an occurrence of a schedule that funds a goal is confirmed, its transaction is linked to that goal, the same way a hand-linked transfer is (the Expense leg, as `update_transfer` does). This is the prerequisite, and the queued deferred item (queue.md:201) is now built.
   - **Future confirmations only.** Past confirmations are never linked by a migration. A user may have added hand contributions for the same money, so a backfill could count it twice.
   - **Past confirmations are the user's choice:** the goal page offers *"3 earlier transfers from Weekly $50 aren't counted toward this goal. Count them?"* It runs each one through the existing same-money check (`same_goal_money()` / `replace_contribution_with_link()`), and nothing happens without a tap.
2. **The link moves to the schedule** (`recurring_transactions.goalid`, migration 82, as Phase 1 proposed):
   - backfill it, keeping `goals.funding_recurringid` for now;
   - replace `set_goal_funding` so it touches only that one schedule;
   - refuse goals that follow a card;
   - follow the 57 grant block.
   - **Push window:** a temporary trigger mirrors writes to `goals.funding_recurringid` into `recurring_transactions.goalid`, so the old app keeps working between `db push` and deploy. A later migration drops the trigger and the old column, after this deploy has been live a week.
   - **Backfill conflict:** before migration 82 goes anywhere, run the read-only duplicate check on production. If it returns any rows, STOP. We decide each case by hand, since there are only about 8 users.
3. **Goal holds: net the amounts.** Neither "any schedule switches the hold off" nor "all of them do" is right.
   - **still to set aside** = the monthly contribution, minus goal money this month, minus **this month's upcoming occurrences of the goal's linked schedules that the Safe to Spend projection is already subtracting**. Floor at 0, cap at remaining.
   - "Already subtracting" must be the **same set** the projection uses: same view, same leaves-spendable rule, same horizon. An occurrence the projection doesn't subtract (for example, one after its horizon) isn't netted, or the hold under-counts.
   - Once confirmations are auto-linked, a confirmed transfer is goal money this month, so it isn't netted twice, and the ended or paused mid-month double-take goes away.
   - **This moves Safe to Spend for some existing users** (one weekly schedule against a larger monthly target used to hold $0). Report how many goals on dev change and by how much, and give a read-only query for production. The tester note is **before-deploy**.
4. **No monthly normalisation.** Drop rule 3's "about $417 a month" total.
   - The "Funded by" list shows each schedule's own amount and frequency.
   - The total line reads **"Scheduled this month: $400"**, the sum of this month's actual occurrences, using the same set as ruling 3.
5. **Pace stays history-based** (the H ruling in Decide-and-Grow). Drop Part A's schedule-based pace wording. Pace starts working for schedule-funded goals once confirmations are linked (ruling 1).
6. **Income stays unlinkable** (section 3's ruling and CHECK `transactions_goal_expense_only`). Part A's "income, expense and transfer can all link" was my error.
7. **Fix the follow-a-card note's gaps.** *"Visa Payoff follows the card's balance, so payments count automatically"* also shows on the transfer editor, the edit page and Log again.
8. **Fix the goal form's silent unlink.** Clearing the monthly target no longer drops a schedule's link. Under the new model the link lives on the schedule anyway.
9. **The Recurring page row shows its goal** ("Feeds Emergency fund") as new work, since it doesn't today.
10. **One occurrence, different goal:** keep the mechanism, and add the line *"Only this payment. Weekly $50 still feeds Emergency fund."*
11. **Completion panel:** the freed-up-money line can now be built from the schedule link. Update the stale comment in `lib/goalCompletion.ts`.
12. **Tests:** add SUMMARY rows (ALL PASS) to `goal-monthly-holds-test.sql` and `debt-goal-test.sql` before their next recorded pass.

## Part B (after Part A ships)

1. **Keep the starting balance recorded once** (the original ruling). No start-date rule and no anchor history.
2. **The breakdown still always adds up,** by showing whatever's left over honestly. Lines come from rows that count in the card's balance and were added after the link, meaning dated after the link day, or on the link day but created after `linked_at`:
   - Payments: income on the card with a transfer group.
   - New charges: expense, no transfer group, without an interest or fees role.
   - Interest and fees: by category role, ruling 3.
   - Cash advances and balance transfers: expense with a transfer group, only if there are any.
   - Credits and refunds: income on the card, no transfer group.
   - **Earlier entries and balance updates:** whatever is left over, so the sum equals Owes now exactly. Show it only when it isn't zero, with the note *"Changes to entries from before you started, or a balance you updated."*

   A test asserts that the total adds up.
3. **Interest and fees: a small schema change is approved.** A nullable `categories.role` limited to `'interest'` or `'fees'`.
   - Category settings let the user mark an expense category as "Interest charges" or "Fees". New users get an "Interest charges" expense category with that role.
   - **Existing users' categories are not changed by the migration.** Never re-classify silently.
   - The goal page shows the line only if a category has the role. If none does, a link offers *"Mark a category as interest charges to see interest separately."*
4. **The card shows** "Owes $2,198" and *"$1,200 paid since Oct 1"* (payments), replacing "{net drop} of {start} paid off". The meter stays as it is: net drop over start.
5. **Build the paid-off-with-a-credit wording:** *"Paid off. The card shows a $25 credit."*
6. Part B has its own branch and its own Phase 1 confirmation after Part A ships.

---

# Part A · Goals fed by several schedules and by one-time transactions

**Today a goal can be fed by only one recurring schedule. Linking a second schedule to the same goal quietly unlinks the first. After this change, a goal can be fed by any number of schedules, for example $50 every Friday plus $200 on the 1st. Each schedule still feeds at most one goal. Everything that reads "the schedule that feeds this goal" changes to read "the schedules", and adds them up the same way everywhere.**

This touches numbers: goal pace, any goal holds in Safe to Spend, and the goal-completion line about freed-up money. Build it as carefully as any money change.

---

## Rules

1. **One goal, many schedules. One schedule, one goal.** A schedule's goal is a single field. A goal has a list of schedules.
2. **Nothing unlinks silently, ever.** Linking a schedule to a goal never touches another schedule's link. Moving a schedule from goal A to goal B is a visible change on that schedule only, and the form says so: *"This schedule will feed Beach trip instead of Emergency fund."*
3. **One rule for "what a goal's schedules add up to".** One function returns a goal's linked schedules that are still active, and their combined amount per month. Whatever already normalises a single schedule's frequency to a monthly figure does the normalising (weekly ×52/12, every 2 weeks ×26/12, and so on); don't write a second version.
   - **Active** means not finished, using `recurring_is_finished` / `v_recurring_state` and the TypeScript twin in `lib/recurringEnds.ts`. Ended, paused and archived schedules don't count.
   - Goal pace, goal holds, the goals page, the goal-completion panel and anything else that reads a goal's schedule must call this function. If it lives in SQL, write a TypeScript twin with a parity test, as for recurring ends.
4. **Same money counted once.** Each confirmed occurrence is its own transaction, and that transaction is the contribution, as now. Two schedules never double-count the same occurrence.
   - **Possible duplicate:** if the user links a schedule with the same amount, frequency and accounts as one already feeding the goal, ask first: *"Weekly $50 to Savings already feeds this goal. Add this one as well?"* Yes links it; No leaves it unlinked. Never merge or delete schedules automatically.
5. **Goals that follow a card can't be linked to schedules** (Log-Again-and-Goal-Links.md section 3), because payments already count through the card's balance. That doesn't change. Neither does "a transaction counts toward at most one goal".
6. **Existing links are kept exactly.** For every user, every goal keeps the one schedule it has today, and every figure is identical before and after the migration until someone links a second schedule.

## What the user sees

- **The schedule form** (create and edit): the Goal field works as today. When the chosen goal already has schedules, a hint below it reads: *"Emergency fund is also fed by Weekly $50 to Savings."* That's information, not a warning.
- **The goal page and goal card** have a "Funded by" list.
  - Each linked schedule gets a row: its name, amount and frequency, for example "$50 every Friday".
  - Each row links to the schedule and has an **Unlink** action. Unlinking removes the link only; the schedule keeps running.
  - The total line reads *"About $417 a month from 2 schedules"*. With one schedule it reads exactly as today.
  - Ended schedules aren't in the list. Their past contributions stay in the goal's history.
- **Goal pace:** based on the combined monthly amount, e.g. *"At about $417 a month, you'll reach it in March."* It never assumes a schedule will continue past its end date or its last occurrence. If a schedule ends before the goal is reached, pace uses the remaining occurrences of each schedule and says *"after Weekly $50 ends in January, about $200 a month"*, or whatever wording the pace feature already uses for a changing rate. Report what it does today.
- **Goal completion panel** (Goal-Completion.md, "The part only Sorrel can say"):
  - With one schedule, nothing changes.
  - With several, list each one with its amount, then the total: *"$417 a month from 2 schedules isn't committed to anything now."*
  - Each schedule gets its own **Stop / Redirect / Keep** choice.
  - If any of the schedules can't be identified with confidence, drop the line entirely, as the existing rule says.
- **The Recurring page:** each schedule row shows its goal as today. Nothing else changes.
- **Copy rules:** never discouraging, and red never describes money.

## Data

**Report first** where the link lives today, and what causes the "remove the other one" behaviour. One of these three:

| Today | Change |
|---|---|
| A column on `goals` pointing at one schedule (e.g. `goals.recurring_id`) | Move the link to the schedule: add `recurring.goal_id` with a composite FK `(userid, goal_id)` → `goals(userid, id)` (the migration 44 pattern), on delete set null. Backfill from the old column. **Keep the old column for now**, unread by the new code, and drop it in a later migration after this deploy is live. That way the production app keeps working between `db push` and the deploy. |
| `recurring.goal_id` plus a unique index or constraint on it | Drop the unique index in a migration. Nothing else changes in the schema. |
| `recurring.goal_id` with no uniqueness, and the server action clears other schedules' links | No migration. Fix the action. |

- **RLS:** any new column follows the table's existing policies. Add rls-isolation cases showing a user can't link a schedule to another user's goal, including through the composite FK.
- **Functions:** any new or changed SQL function follows the migration 57 grant block, with a pinned `search_path`.
- **Deleting a goal** clears the link on all its schedules, and the schedules keep running. The delete confirmation names them: *"2 schedules feed this goal. They'll keep running, unlinked."*
- **Deleting a schedule** removes its link. Its past contributions (real transactions) stay.

## Numbers that could move

Report each one with the line of code that computes it today, and say how it changes:

1. **Goal holds in Safe to Spend** (`goal-monthly-holds-test.sql`), if goals hold back their remaining monthly amount. With two schedules, the hold and the scheduled transfers in the forecast must not take the same money twice. Whatever rule stops that for one schedule today must hold for the sum. **If the current rule only works because there's one schedule, STOP and tell me** before changing it.
2. **Goal pace** (`goal-pace-test.sql`).
3. **The forecast / runway:** each schedule is already in it as its own item, so it shouldn't change. Confirm.
4. **"Saved toward your goals" on the dashboard:** it's made of real contributions, so it shouldn't change. Confirm.

For every existing user, figures 1–4 are identical before and after this branch. Snapshot them first and compare. They only change once someone links a second schedule.

## One-time transactions can feed a goal too

This was designed in `docs/Log-Again-and-Goal-Links.md` section 3 ("Is this for a goal?"). That design still stands. **Phase 1 reports whether it shipped**, and then:
- **If it never shipped,** build it in this branch.
- **If it shipped,** fix whatever stops it working the way Matt expects.

The rules, briefly (section 3 has the full version):

- **It's the user's choice, never required.** An optional **Goal** field on the add and edit forms, including quick add and Log again, collapsed to *Goal: none*.
  - It's shown when the user has at least one active manual goal.
  - It only opens by itself, as *"Is this for a goal?"*, on a transfer from a spendable account to a non-spendable one (like checking to savings).
- **Income, expense and transfer can all link.** A transfer counts once, never once per leg.
- **The transaction is the contribution.** The amount is read from the transaction. Edit it and the goal follows. Delete it and the contribution goes, with the delete confirmation naming the goal.
- **A transaction feeds at most one goal.**
- **Same-money check:** if the goal has a hand-entered contribution of the same amount within 3 days, ask *"Is this the same money as your $200 contribution on Nov 12?"* Yes replaces the hand entry with the link; No keeps both.
- **Goals that follow a card aren't offered.** Next to the field: *"Visa Payoff follows the card's balance, so payments count automatically."*
- **Import doesn't set goals.**

**How it fits with schedules:**
- A goal can be fed by any mix of schedules, one-time transactions and hand-entered contributions. All of them count toward progress.
- The "Funded by" list shows the schedules only. One-time transactions show in the goal's history, as contributions do now.
- A confirmed occurrence of a linked schedule arrives already linked to that schedule's goal.
- The user can change or clear the goal on that **one** transaction from its edit form, and only that transaction changes. The schedule's link doesn't move, and the form says so: *"Only this payment. Weekly $50 still feeds Emergency fund."* Report how this works today before changing it.
- Goal pace uses only the schedules for its forward rate. One-time transactions add to progress, not to the rate.

**Safe to Spend:** section 3 flagged a double-count. A $200 transfer to savings lowers the spendable balance, while a goal hold for the same $200 stays in place. Phase 1 reports whether that was fixed. If it wasn't, **STOP and tell me** before building one-time links, because they'd make it happen more often.

## Also

- **Tests:** a new `goal-multi-schedule-test.sql` ending in a SUMMARY row that reads ALL PASS. It covers:
  - two schedules linked;
  - linking a third doesn't unlink anything;
  - moving a schedule between goals;
  - an ended schedule dropping out;
  - weekly plus monthly normalising correctly;
  - deleting a goal leaves both schedules running and unlinked;
  - another user's goal being refused;
  - a one-time transaction linked alongside two schedules, with progress equal to the sum of every contribution;
  - a transfer counted once;
  - changing the goal on one occurrence without moving the schedule's link.

  Extend `goal-pace-test.sql`, `goal-monthly-holds-test.sql` (if it exists) and `rls-isolation-test.sql`. Add the parity test if the combining function has a twin.
- **Storage:** none.
- **Tester note:** Sent: not yet. Mark it before-deploy only if a number moves for someone who already has links; rule 6 says it shouldn't.
- **What's new:** "A goal can now be fed by more than one recurring payment, and by any one-time transaction you choose."

---

# Part B · A debt goal that keeps exact track of the card

**When a debt payoff goal follows a credit card, it reads the card's whole history in Sorrel: payments, purchases, interest, fees, refunds, imports and balance corrections. It shows how much is left to pay and how much the user has paid. Its numbers always add up, so the user can trust them.**

This builds on the existing design for debt goals that follow a card (`docs/Log-Again-and-Goal-Links.md` section 2, and `docs/Transfers-and-Linked-Goals.md`). Phase 1 reports how much of that already shipped (`debt-goal-test.sql` suggests it did). Everything there still stands:
- the progress is worked out when the goal is read, and never written as contribution rows;
- a goal is either derived from the card or manual, never both;
- unlinking writes the progress as one "carried over" contribution;
- payments count through the card, so payments can't also be linked to the goal by hand.

## Rules

1. **One balance rule.** "What the card owes" comes from **the same function the Accounts page uses** for that card's balance, including the balance-anchor rule (`counts_in_balance`). The goal never adds up the card's transactions its own way. If the Accounts page and the goal could ever show different balances for the same card on the same day, that's a bug.
2. **The goal starts on a day, not from a typed number.** The starting balance is what the card owed **at the end of the start date** (the day the user linked it, or a start date they pick), from the same balance function.
   - If the user later adds a transaction dated on or before the start date, the starting balance changes with it. That's more accurate, not a reset.
   - Report how the starting balance is stored today. If it's a number recorded once, propose how to move to the start-date rule without changing any existing goal's meter (rule 6).
3. **It always adds up.** For the start date through today:

   **Started at − Payments + New charges + Interest and fees − Refunds and credits ± Balance corrections = Owes now**

   A test asserts this for every fixture. Nothing is left over. Anything that can't be classified goes into a line that is still shown and still counted, never hidden.
4. **What each line is:**

   | Line | What counts |
   |---|---|
   | **Payments** | Transfers into the card from another account. This includes pairs made with "Turn into a transfer" and import-joined transfers. A payment logged as income on the card also counts, if that's possible in Sorrel today (report it). |
   | **New charges** | Expenses on the card that aren't interest or fees. |
   | **Interest and fees** | Expenses on the card that are interest or fees. **Report how Sorrel can tell.** For example: a category type, the default categories, or nothing at all. If there's no reliable way, they stay inside New charges, and the goal shows no separate interest line rather than a guess. Don't match category names. Propose the cleanest way, and STOP if it needs a schema change. |
   | **Refunds and credits** | Credits on the card that aren't payments, such as merchant refunds and rewards. |
   | **Balance corrections** | Changes from a balance anchor set after the start date, when the user told Sorrel "the card actually owes $X". These are shown, never hidden. |

   Transfers out of the card (a cash advance or balance transfer) count as new charges, or as their own line if the data shows them distinctly. Report it.
5. **"Paid so far" is payments, and progress is what's left.** The two can differ, and the goal says so honestly. Paying $1,200 while charging $400 more takes the balance down $800.
   - The meter shows **progress = (Started at − Owes now) ÷ Started at**, held between 0% and 100%.
   - The big figure is **Owes now**.
   - Under it: *"$1,200 paid since Oct 1"*.
6. **Existing goals don't jump.** For every user, every linked debt goal's meter and figures are identical before and after this branch, unless the start-date rule fixes a real gap. If that happens, list each goal affected and by how much, and STOP before merging.
7. **Never discouraging, never red.**
   - **If the balance is higher than where it started:** the meter shows 0%, with the neutral line *"New charges have added $310 since Oct 1. Payments so far: $600."* No warning colour, no "you're going backwards".
   - **When the card reaches $0 or below:** the goal completes, using the existing completion rules (worked out when read; no write during a page render). A credit balance shows as *"Paid off. The card shows a $25 credit."*

## What the user sees

- **On the goal card:**
  - the meter;
  - the big figure, *"Owes $2,198"*;
  - a line under it, *"$1,200 paid since Oct 1 · follows Visa's balance in Sorrel"*.
- **On the goal page, a "Where it stands" breakdown:**
  - Started at $3,000 on Oct 1
  - Payments −$1,200
  - New charges +$350
  - Interest and fees +$48 (only if Sorrel can tell them apart)
  - Refunds and credits −$0 (only if there are any)
  - Balance corrections (only if there are any)
  - **Owes now $2,198**

  Each line links to Transactions, filtered to exactly the rows behind it. It uses the shared-filter mechanism from the Income and Spending drill-down, so each list adds up to its line.
- **Start date:** linking defaults to today and can be changed. Changing it says plainly what moves: *"Starting from Sep 1, the card owed $3,240."*

## Also

- **Tests:** extend `debt-goal-test.sql`, ending in a SUMMARY row that reads ALL PASS. It covers:
  - the reconciliation identity for each fixture;
  - payments, including a "Turn into a transfer" pair, an import-joined transfer and a payment imported as a transaction;
  - a purchase, interest, a fee, a refund and a cash advance;
  - a back-dated transaction before the start date;
  - an anchor set after the start;
  - a balance above where it started (meter at 0%);
  - paid off, with and without a credit balance;
  - an archived card;
  - another user's card being refused.

  If the breakdown has a TypeScript twin, add a parity test.
- **Storage:** none.
- **Tester note:** Sent: not yet. It's before-deploy if any existing goal's figures change (rule 6).
- **What's new:** "Debt goals now show exactly where your card stands: payments, new charges and interest since you started."

---

# Part C · Import from Excel as well as CSV

**On the import screen, the user picks the file type, CSV or Excel (.xlsx), then continues exactly as today. Everything after reading the file is the import that already ships:**
- column mapping;
- Sorrel's own export recognised;
- duplicate checks;
- the balance preview from the database's rule;
- the one-shot insert;
- undo.

`docs/Import-CSV.md` deferred Excel and said to audit `read-excel-file` first. This is that.

## Rules

1. **The file still never leaves the device.** The Excel file is read in the browser, like the CSV. The raw file is never uploaded, stored or logged. Only the rows the user confirms are sent, as today. The privacy policy already says "imported from a file yourself. The file is read on your device and never uploaded", which doesn't name a format, so no policy change is needed. **Confirm that wording is still there.** If it says "CSV" anywhere, STOP and tell me.
2. **One import path.** The Excel reader's only job is to turn the sheet into the same rows of text the CSV reader produces (header row plus data rows). After that, it's the same code. No second mapping or validation path.
3. **The user chooses.** At the top of the file step, a choice reads **"CSV"** or **"Excel (.xlsx)"**, defaulting to whichever was used last on this device.
   - Each option sets what the file picker accepts and its help text.
   - If the file doesn't match the chosen type, say so and offer to switch: *"This looks like an Excel file. Switch to Excel?"*
   - Old **.xls** files aren't supported: *"Sorrel reads .xlsx files. In Excel: File › Save As › Excel Workbook (.xlsx)."* CSV keeps its existing help line.
   - "Used last on this device" needs a localStorage key. If that's the only new storage, name it, list it per the merge-gate rule, and confirm the policy's "what you last saw / preferences" wording covers it. Otherwise default to CSV and add no key.
4. **Which sheet.** If the workbook has more than one sheet, ask which one, defaulting to the first sheet with data. Show each sheet's name and row count.
5. **Reading cells correctly.**
   - **Dates:** Excel stores dates as serial numbers. Convert them using the workbook's date system (1900 or 1904) and the cell's date format, into the same date text the CSV path handles. Text dates pass through unchanged.
   - **Amounts:** numeric cells are rounded to cents, never with floating-point leftovers like 12.300000001. Text amounts pass through unchanged.
   - **Formulas:** use the saved value. If a formula cell has no saved value, that row is listed under "couldn't be read", as today, never guessed.
   - **Merged cells, blank rows and title rows above the header** are handled the way the mapping step already handles messy CSVs. Report how.
6. **Limits and safety.**
   - The same 5,000-row limit.
   - A file size limit (propose one; about 10 MB).
   - A cap on how much the file can expand when unzipped, because an .xlsx is a zip, and a "zip bomb" must fail politely rather than freeze the tab.
   - Ignore macros, external links and embedded objects completely.
   - If reading a large file blocks the page for more than about 100ms, do it in a Web Worker.
7. **A dependency is allowed here, but only after the audit.** In Phase 1, compare:
   - **`read-excel-file`** (the one Import-CSV.md named). Check its licence, maintenance, size gzipped, its own dependencies, `npm audit`, and whether it runs in the browser without Node polyfills.
   - **A small built-in reader** using the browser's `DecompressionStream`. An .xlsx is XML inside a zip, so we'd only need the shared strings, styles and one sheet.
   - **Not the `xlsx` (SheetJS) package from npm.** The npm registry's copy is out of date and has known security advisories. SheetJS only publishes fixed versions on its own CDN.

   Recommend one. Load it **only on the import page**, never in the main bundle.

## Also

- **Tests:** unit tests with small .xlsx fixtures, made by a script in the repo rather than binary files from the internet. They cover:
  - 1900 and 1904 date systems;
  - date-formatted numbers vs text dates;
  - amounts that are numbers, text and negatives in parentheses;
  - a formula with and without a saved value;
  - two sheets;
  - a title row above the header;
  - an empty sheet;
  - an .xls file renamed to .xlsx;
  - an oversized file and a zip bomb, both failing politely.
  - A parity test: the same data saved as CSV and as .xlsx produces identical preview rows.
- **Tester note:** Sent: not yet, not before-deploy.
- **What's new:** "Import now reads Excel files (.xlsx) as well as CSV."

---

## Prompt 1 · Goals Phase 1 (Opus): parts A and B, report only

This goes to Opus because it may need a migration and it touches Safe to Spend and goal balances.

```
Read docs/Goals-and-Import.md parts A and B in full. Also re-read
docs/Log-Again-and-Goal-Links.md (sections 2 and 3),
docs/Transfers-and-Linked-Goals.md (linked goals), docs/Goal-Completion.md
("The part only Sorrel can say") and the goal pace section of
docs/Decide-and-Grow.md. Build nothing.

PART A
  1. Where the schedule -> goal link lives (column, table, constraint),
     and exactly what removes the old link when a second schedule is
     linked: quote the migration or the server action line.
  2. Which row of the doc's Data table applies, and the migration you'd
     write (or "none").
  3. Every reader of "the schedule that feeds a goal": goal pace, goal
     holds / Safe to Spend, the goals page and card, the completion
     panel, the forecast, anything else. File and line each.
  4. How a single schedule's frequency is normalised to a monthly
     figure today (one place or several?).
  5. Numbers that could move (the doc's list 1-4): quote how each is
     computed today. If the goal-hold rule that prevents taking the
     same money twice only works because there's one schedule, say so
     plainly.
  6. Does goal pace handle a schedule that ends before the goal is
     reached? Quote it.
  7. One-time transactions: did Log-Again-and-Goal-Links.md section 3
     ship? Which forms have the Goal field, when is it shown, can
     income/expense/transfer all link, does the same-money check exist?
     If it shipped, what stops it working the way the doc describes?
  8. Can a confirmed occurrence of a linked schedule have its goal
     changed on just that transaction today? Quote it.
  9. The goal-hold double-count from section 3 (a $200 transfer to
     savings lowering spendable while the $200 hold stays): fixed or
     not? Quote the code.

PART B
 10. What shipped of "debt goals follow the card": how the goal finds
     its card, how the starting balance is stored, how progress and
     completion are computed. Quote it.
 11. The Accounts page's balance function for a credit card, including
     the anchor rule. Does the goal use the same function today?
 12. For each line in Part B rule 4 (payments, new charges, interest
     and fees, refunds and credits, balance corrections, cash advances):
     how Sorrel can identify those rows today, with the field or rule.
     Say plainly if interest/fees can't be told apart reliably.
 13. Moving to the start-date rule: would any existing linked goal's
     figures change? How would you check across all users without
     writing anything?
Report, then stop.
```

## Prompt 2 · Excel import Phase 1 (Sonnet): part C, report only

This can run alongside the goals work. Use a separate branch when building.

```
Read docs/Goals-and-Import.md part C in full, and docs/Import-CSV.md.
Build nothing.

  1. Where the CSV is read today (PapaParse call), and the exact shape
     of what it hands to the mapping step.
  2. The current privacy policy wording about imported files: quote it.
     Does it name CSV anywhere?
  3. The dependency audit from rule 7: read-excel-file (licence, last
     release, gzipped size, its dependencies, npm audit, browser support
     without Node polyfills) vs a built-in DecompressionStream reader
     (rough size and risks). Recommend one, with reasons.
  4. How the mapping step handles title rows above the header, blank
     rows and merged-looking data today.
  5. Whether "last file type used" needs a new localStorage key, and
     whether the policy wording covers it.
  6. A proposed file-size and decompressed-size cap.
Report, then stop. Don't install anything.
```

After the reports, I'll send the build prompts. If Part A or B needs a migration, the production order is the usual one: backup, dry run on `ybdwqyihvbokowocvlgq`, `db push`, then merge and `git push`.
