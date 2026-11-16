# Importing transactions from a CSV file

**Import is the alternative to typing every transaction, short of connecting to a bank. It's also where finance apps get their worst bugs, because one action writes hundreds of rows that all move a balance. So every step of this spec is about the user seeing what will happen before it happens.**

---

## What v1 is

- **CSV only.** PapaParse in the browser. If someone picks an `.xlsx` file, tell them how to save it as CSV: *"Sorrel reads CSV files. In Excel: File › Save As › CSV UTF-8."*
- **One account per import.** A bank file describes one account.
- **No transfer pairing.** Rows come in as income or expense on the chosen account.
- **Undo for every import.** One import is one batch, and the whole batch can be undone.

What v1 isn't: Excel parsing, bank connections, auto-categorising, or more than one account per file.

## Recent activity, not statements

Import doesn't need to wait for a statement. Most banks let you download recent activity as a CSV any time, from the account's activity page, usually up to yesterday. The statement is only the monthly PDF. **The habit to encourage is a weekly import of the last few weeks.** Overlapping dates are harmless because duplicates are skipped by default (step 8).

- **Tell people, on the import screen, under the file picker:**
  > No need to wait for a statement. Most banks let you download recent activity any time. Look for "Download" or "Export" on the account's activity page. Overlapping dates are fine: Sorrel skips what it already has.
- **"Imported through Nov 8"** on the account page, and in step 1 once an account is chosen: *"Your last import for Checking ran through Nov 8. Downloading from a few days before that is fine."*
  - It's the latest **transaction date** among that account's imported rows. Not the import's created_at, because the question is which bank dates are covered.
  - Derived at read time. No new column, and it recomputes after an Undo.
  - It uses the same date formatter as "Last logged", with the year only when it isn't the current year.
  - It isn't shown for an account that has never had an import.
- **No reminders, badges or nags** to import. The line informs. It never chases.

## The library

- **PapaParse, pinned to an exact version.** Use the newest version that has been published for at least two weeks. 5.7.1 came out on 11 November. Brand-new releases are how npm supply-chain attacks spread, and a short wait costs nothing. Take 5.7.1 sooner only if it fixes an advisory.
- Check PapaParse's GitHub advisory page before pinning (Claude Code's searches didn't reach it). Also check the licence and run `npm audit`. Same routine as dnd-kit.
- **Not SheetJS from npm.** The npm package stopped at 0.18.5, which has two vulnerabilities that trigger on reading an untrusted file. Reading untrusted files is exactly what import does.
- **Excel later**, if users ask: audit `read-excel-file` first. Record that in the Deferred section of `queue.md` with a revisit trigger: two or more testers asking for `.xlsx`.

---

## Privacy: the file never leaves the device

The file is parsed in the browser. **The raw file is never uploaded, stored or logged.** Only the rows the user confirms in the preview are sent, and only the columns Sorrel uses.

A bank export can contain account numbers, full card numbers in descriptions, and more history than the user meant to share. Being able to say "the file never reaches our server" is worth the small cost.

- Don't store the filename. It can carry an account number. Label the batch *"Imported 14 Nov · 140 transactions"*.
- No row content in logs, error reports or analytics, including on failure.

---

## The flow

### 1. Where it starts

- **From an account page:** an *Import* button, with that account preselected.
- **From Settings › Import:** the user picks the account first.

### 2. Columns

- **Sorrel's own export is recognised by its exact headers.** Mapping is skipped, and only the rows for the chosen account are taken. Rows for other accounts are counted as *"not for this account"*. Transfers are skipped and counted: *"12 transfers skipped. Add those by hand."*
- **Any other file:** guess the Date, Description and Amount columns from common header names, then show the guess with the first five rows so the user can correct it. Category and Notes are optional.
- **Amount comes in two shapes.** Either one signed column, or separate Debit and Credit columns. The user confirms which.

### 3. Which way is money out? Ask.

Banks disagree. A checking export usually shows spending as negative. A credit card export often shows charges as positive. Guessing wrong flips every row: spending becomes income, and the balance moves the wrong way by twice the total.

> **In this file, is money you spent shown as a negative or a positive number?**
> Example from your file: *STARBUCKS 1234 · −5.75*
>
> **Negative** · **Positive**

Required, with no default. The preview in step 6 shows the result, so a wrong answer is visible before anything is saved.

### 4. Dates are confirmed, not guessed

- If the file settles the format (any day above 12, or ISO dates), use it and show it: *"Dates read as day/month/year."*
- If every date is ambiguous, ask with a real example: *"Does 03/04/2026 mean 3 April or March 4?"*
- A row whose date can't be read goes on the **couldn't read** list (step 6). It is never dropped silently and never guessed.

### 5. Amounts

- Parse into **integer cents**. Never floating point, and never sum money in JavaScript floats. The project has already recorded this finding once.
- Accept `$1,234.56`, `1234.56`, `-12.00`, and `(12.00)` as negative.
- Anything else goes on the couldn't-read list with its row number. No European `1.234,56` in v1. If one shows up, the row goes on the couldn't-read list, not into a wrong number.
- Zero-amount rows are skipped and counted.

### 6. The preview is mandatory

Nothing is saved before this screen, and it shows the consequence, not just the rows.

> **140 transactions into Checking**
> 112 spent · $6,204.18 28 received · $5,080.00
> **Checking goes from $3,934.10 to $2,810.92**
>
> 4 look like ones you already have. Skipped unless you include them
> 2 rows couldn't be read: rows 17 and 88

- **The balance change comes from the database's rule, not a JavaScript copy of it.** Whether a row counts depends on the anchor rule (`counts_in_balance`). Reimplementing that in the browser is the one-rule-many-consumers failure this project has dug out of three times. Phase 1 decides how. A dry-run SQL function is the likely answer.
- **The balance change updates live** as the user answers questions and ticks rows.
- **Couldn't-read rows** are listed by row number with their raw date and amount text, in neutral ink. Not red, and not an error state.
- **Future-dated rows** are unusual in a bank file. If there are any, say so and treat them as future-dated, with the existing ghosting.
- A table of every row, with the duplicate rows shown first.

### 7. The pre-anchor question, asked once

Importing history means many rows dated before the balance date. The trigger from migration 62 rejects each of those without an answer, so ask once for the batch:

> **118 of these are dated before your balance of $3,934.10 on 3 November.**
> Was that balance already including them?
>
> **Yes, they're already counted** · **No, add them to my balance**

- Required, no default. The same reasoning as the single-transaction question applies: either default corrupts someone's balance.
- The answer is written to each row (`counts_despite_anchor`, `anchor_answer_set_at`) exactly as if each row had been answered one at a time. The trigger passes, and each transaction still shows its answer when opened.
- Most people importing history will answer **Yes**. The preview's balance line makes the difference obvious either way.

### 8. Possible duplicates: flagged, skipped unless the user includes them

A row is flagged if an existing transaction on **the same account** has **the same amount** and a date **within 3 days**.

- Three days, because a hand-entered transaction is often dated when it happened and the bank dates it when it posted. That's the pending gap again.
- Rows within the file are never flagged against each other. Two $5.75 coffees on one day are two coffees.
- Each flagged row shows the existing transaction it matched. The user can include it.
- This matcher is acceptable where the fuzzy duplicate detector was ruled out because it **only flags in a preview the user controls**. Nothing is merged or deleted.

### 9. Categories

- Matched to the user's existing categories by name, ignoring case.
- Unmatched rows come in uncategorised. The preview lists the unmatched names with counts: *"Groceries (14), Gas (6) don't match a category. They'll come in uncategorised."*
- **No categories are created silently.** Auto-creating categories is a v2 question.

### 10. Saving

- **One SQL function inserts the whole batch atomically.** All rows or none. The Supabase client can't wrap a transaction, and a half-imported file is the worst outcome on this list.
- Same shape as the existing write functions: scoped to `auth.uid()`, pinned `search_path`, the migration 57 grant block, and checks that the user owns the account.
- Server-side limits: **5,000 rows** per import, which is several years of a checking account. Every row is validated again on the server: amount, date, type, and text length caps.
- Afterwards: *"140 transactions imported into Checking."* An Undo link sits beside it.

### 11. Undo

- **Settings › Import** lists past imports: date, account, count, and **Undo this import**.
- Undo is **one function** that deletes the batch atomically.
- If rows have been edited since the import, the confirmation says so: *"Undo this import? 3 of these transactions have been edited since. They'll be removed too."* Only the confirm button is red.
- An imported row linked to a schedule (step 12) follows item 4's existing delete handling, so undo restores the occurrence instead of losing it.

### 12. Schedules: the confirmation queue

An imported "Rent · $1,850 · 1 Nov" will often match an occurrence still waiting in the confirmation queue. If nothing connects them, the user is asked *"Did rent come out?"* about a transaction they just imported.

Reuse item 4's mechanism: where an imported row matches an unconfirmed occurrence, ask the same **"Is this the same bill?"** question. Nothing links without a Yes. Phase 1 reports whether item 4's matcher covers this case as it is.

### 13. Marking imported rows

Each imported transaction shows a quiet *Imported* label when opened. Six months later, "where did this come from?" has an answer.

---

## Data model: migration 68

- **`imports`**: id, userid, accountid, created_at, row_count. No filename. Composite FKs per the migration 44 pattern, RLS, and the migration 57 grant block.
- **`transactions.import_id`**: nullable, with a composite FK to `imports`. **ON DELETE RESTRICT, not CASCADE.** Deleting an import row must never silently delete transactions. Undo deletes the transactions explicitly, then the import row.
- Added to the RLS isolation harness. A new test script, `import-test.sql`, covers atomic insert, undo, cross-user rejection and the pre-anchor answer.

---

## The privacy policy changes, so testers hear first

The policy currently says *"Everything financial in Sorrel is information you typed in yourself."* With import, that's false.

New wording: *"Everything financial in Sorrel is information you typed in or imported from a file yourself. The file is read on your device and never uploaded. Sorrel never connects to your bank."*

The policy promises to tell people before a change. **Email testers before deploying**, individually or BCC, and record it in `docs/tester-notes/` with its Sent date. Import also moves balances and Safe to Spend for anyone who uses it, so the note says that too.

---

## The prompt

```
Import, v1. Read docs/Import-CSV.md in full first, and the import section
of docs/Views-Search-Import-Layout.md.

PHASE 1 — REPORT ONLY. Build nothing.

 1. The transaction write path today: is there one function or several
    client inserts? Can one SQL function insert N rows atomically and
    satisfy require_anchor_answer() per row? Quote the trigger.
 2. The balance-change preview must come from counts_in_balance, not a
    JS copy of it. Propose how: a dry-run function, or something else.
    Quote what exists.
 3. Item 4's same-bill matcher: does it cover a PAST-dated imported row
    against an UNCONFIRMED occurrence in the confirmation queue? What does
    the queue do today when such a row exists?
 4. Item 4's delete handling for a linked row: can a batch undo reuse it?
 5. The exact header row of Sorrel's own CSV export.
 6. Categories: is name unique per user? Case-sensitive?
 7. How amounts are stored (type, cents or decimal), and every place
    money is summed in JS today.
 8. PapaParse: newest version published at least two weeks ago, its
    GitHub advisory page, licence, npm audit. Pin nothing yet.
 9. Read-only against PRODUCTION by ref with the Target line: does any
    transaction column already mark a row's origin? Schema only, no data.

Report all nine, then stop.

PHASE 2, after I rule: build per the doc, in this order:
  migration 68 + import-test.sql + RLS harness, on DEV first;
  the insert and undo functions;
  the flow: columns, money-out question, dates, amounts, preview,
  pre-anchor question, duplicates, categories;
  Settings › Import list with undo; the account-page Import button;
  the Imported label; the privacy and terms wording.

NON-NEGOTIABLE:
  - The raw file is never uploaded, stored or logged. No filename stored.
  - Nothing is saved before the preview. The preview shows the balance
    change, computed by the database rule.
  - Money-out sign, ambiguous dates and the pre-anchor question are
    REQUIRED answers with no default.
  - Unreadable rows are listed by row number, never dropped or guessed.
  - Integer cents. No float money.
  - One atomic insert. One atomic undo. FK is RESTRICT, never CASCADE.
  - Duplicates are flagged and skipped unless the user includes them.
    Nothing is merged.
  - Do not deploy. The tester email goes out first.

VERIFY:
  - Importing a file then undoing it leaves every balance and Safe to
    Spend exactly as before. Row counts before and after.
  - A forced failure on row 70 of 140 leaves zero rows written.
  - Importing the same file twice flags every row on the second pass.
  - Positive-means-spent and negative-means-spent files with the same
    rows produce identical transactions.
  - 03/04/2026 with no other clue asks; 13/04/2026 doesn't.
  - "Yes" to the pre-anchor question leaves the balance unchanged. "No"
    moves it by exactly the sum of those rows, once.
  - Sorrel's own export, imported into an empty dev account, reproduces
    that account's non-transfer rows.
  - Network tab: no request carries the file or any unconfirmed row.
  - Another user's account id is rejected by the database.
```

---

## Addendum prompt: recent activity (add to the import build in progress)

```
Addendum to import Phase 2. Read the new "Recent activity, not
statements" section of docs/Import-CSV.md.

1. Under the file picker, the "No need to wait for a statement" text,
   exactly as written in the doc. Neutral ink.
2. "Imported through <date>" — the latest TRANSACTION DATE among that
   account's imported rows (import_id not null). Derived on read, no new
   column. Shown on the account page and in the import flow once an
   account is chosen. Uses the same formatter as Last logged. Hidden for
   accounts never imported into. Recomputes after Undo.
3. No reminder, badge or notification about importing.

VERIFY:
  - Import Nov 1–14, then an overlapping file Nov 8–21: the second
    preview flags exactly the Nov 8–14 rows, and saving with defaults
    adds only Nov 15–21.
  - "Imported through" reads Nov 14 after the first import and Nov 21
    after the second; after undoing the second, Nov 14 again.
```
