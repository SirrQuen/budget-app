# Account views, search, import/export, and a movable dashboard

**Six requests. One is a live money bug, one is the most strategically important feature on the list, and one should be built at a fifth of the size it was asked for.**

---

## Order

| | Item | Why there |
|---|---|---|
| 1 | **#4 — the doubled upcoming entries** | Probably double-counting bills in Safe to Spend right now |
| 2 | **Safe-to-Spend-Why** (already specced) | Still ahead of every feature below |
| 3 | **#3 — account on Coming up lines** | Trivial; rides along |
| 4 | **#1 + #2 — account pages and search** | One piece of work, not two |
| 5 | **#5 export** | Small, and it closes a promise in your terms |
| 6 | **#5 import** | Its own project. Worth doing well rather than soon |
| 7 | **#6 — dashboard layout** | Last, and scoped down |

---

# 4 — Two entries for one bill

## What I think is happening

This is a hypothesis. Verify it before building anything.

- **"(fixed)"** is the label on a recurring schedule's next occurrence.
- **"(as entered)"** is the label on a future-dated transaction someone typed in by hand.

Bobby is the tester with nine future-dated transactions. If Bobby has been entering next month's bills ahead of time *and* has recurring schedules for the same bills, then since migration 65 both appear in the upcoming list — and **both are subtracted in the projection.** One bill, counted twice.

That would make Bobby's Safe to Spend too low by the duplicated amounts. Too low is the safe direction, but it is still a wrong number, and it's the number the product is named after.

It would also answer the question I suggested asking Bobby: what the future-dated entries were for.

## If that's confirmed: ask, don't guess, and reuse what exists

The app can't know that a hand-entered $1,850 on 1 December is the same event as the Rent schedule's 1 December occurrence. But it can notice the coincidence and ask.

**Where a schedule's upcoming occurrence and an unlinked future-dated transaction share the same account, the same amount, and a date within the schedule's tolerance, show them as a pair with one question:**

> **Is this the same bill?**
> Rent · $1,850 · 1 December appears twice — once from your schedule, once as an entry you added.
>
> **Yes, they're the same** · **No, keep both**

- **Yes** links the transaction to the schedule using the existing `link_transaction_to_schedule` from migration 60. The entered transaction becomes that occurrence; the schedule doesn't ask again on the day; the projection counts it once.
- **No** records the answer so the pair isn't asked about again.

**Ask at entry time too.** When someone saves a future-dated transaction that matches an upcoming occurrence, that's the cheapest moment to settle it.

**This is not the fuzzy duplicate detector I ruled against earlier.** That ruling was about two arbitrary transactions — two $5 coffees on a Tuesday. This is narrower in three ways: one side is a schedule occurrence, the match needs account *and* amount *and* date window, and it asks rather than acts.

**Bobby's existing pairs are Bobby's to resolve.** Nobody edits a tester's data. The pair question is the cleanup tool — once it ships, Bobby answers nine questions and the numbers correct themselves.

---

# 3 — Account on Coming up lines

Add the account name to each line. For a transfer show both ends: *Checking → Visa*. Neutral ink, same weight as the rest of the line's secondary text.

---

# 1 and 2 — Account pages and search are one piece of work

## One list, one filter model

An account page is the transaction list with the account preselected. Search is the transaction list with a text filter. Build **one filterable list** and both features are mostly done; build them separately and you have two lists that drift apart.

Filters, all carried in the URL so the back button and a refresh both behave: account, category, type, date range, text.

## The account page — `/accounts/[id]`

- **Balance at the top, read from `v_account_balances`.** Never a sum of the rows on screen. The list can be filtered or paginated, and summing money in JavaScript is a finding this project has already recorded once.
- Under the balance: the balance date and "last logged", which already exist. An account page is the natural home for *why this balance is what it is*.
- The transaction list, filtered to this account.
- **Add transaction, with this account pre-filled.** Quick add joins the allowlist for account pages. Every existing rule still applies through the same write path — the pre-anchor question, future-dated ghosting.
- Clicking an account anywhere — the accounts list, the Safe to Spend breakdown, the dashboard — lands here.

## Search

One field on the transaction list. Matches description, notes, category name, account name, and an exact amount. Server-side; nothing here is big enough to need more than a simple query.

- Composes with the other filters — search *within* an account works for free.
- The empty state says what was searched for. Zero results is an answer, not an error.

## "Suggest other views": every number is a door

The principle worth adopting rather than a list of screens:

> **Any figure in Sorrel can be tapped to show the rows behind it.**

It serves the same goal as the Safe-to-Spend-Why work — a number you can open is a number you can trust. With the filter model built, each of these is a link, not a feature:

| Tap | Lands on |
|---|---|
| A budget's "spent" figure | That category's transactions for that month |
| A category anywhere | Its transactions |
| The item driving the Safe to Spend low point | That schedule or transaction |
| An upcoming line | Its schedule |
| "(average of last 3)" on an estimate | The three confirmations it was averaged from |
| A goal's progress | Its contributions |

Build the first three with this batch. Put the rest in `docs/queue.md`.

---

# 5 — Export now, import as its own project

## Export — small, and it closes a promise

Your terms say *"email us and we'll send you an export."* A button replaces a manual promise you would eventually resent.

- CSV, from Settings. All transactions, one row each: date (ISO), account, type, category, description, amount, notes, and the transfer pair id.
- **Guard against formula injection.** A description beginning with `=`, `+`, `-` or `@` executes as a formula when the file is opened in Excel. Prefix those cells so they open as text. This is a real attack on anyone who opens an export, and it's one line to prevent.
- UTF-8 with a byte-order mark, so Excel reads accented characters correctly.
- CSV opens in Excel. A native `.xlsx` export is only worth adding if it needs no new dependency.
- Update the terms and privacy wording from "email us" to the button. That's a change in the user's favour; mention it in the tester note.

## Import — the answer to the manual-entry wall

When you asked whether Sorrel could succeed, the biggest structural risk I named was that every transaction has to be typed. Import is the answer to that short of connecting to a bank. That makes it the most strategically valuable item on this list, and the reason to do it carefully rather than quickly — import is where finance apps collect their worst bugs.

It needs its own spec after a Phase 1 report. These are the decisions that spec will be built on:

**CSV first. Excel later, after a library audit.** Spreadsheet-parsing libraries have a history of security problems, and the commonly used one has had an awkward maintenance situation on npm. Check the current state before choosing one. "Save as CSV" covers Excel users in the meantime.

**Parse in the browser. The raw file never reaches your server.** A bank export can contain account numbers and more history than the user means to share. Parse it on the device, show a preview, and send only the rows the user confirmed. That is a privacy property worth being able to state.

**A preview is mandatory, and it shows the balance impact.** *"This adds 140 transactions and changes Checking from $3,934 to $2,810."* Someone who set their balance from the bank and then imports the same period would double-count everything; the preview is where they see it before it happens.

**One answer to the pre-anchor question for the whole batch.** The trigger from migration 62 rejects any row dated before the balance date without an answer. Importing history means dozens of those. Ask once — *"118 of these are before your balance date. Were they already included in that balance?"* — and apply the answer to each row.

**Flag possible duplicates; default to skipping them.** A row matching an existing transaction on account, date and amount is shown as a possible duplicate with skip preselected. Importing a file twice, or importing over hand-entered data, is the dominant way import goes wrong. This is a preview the user controls, which is why matching is acceptable here.

**Every import is one batch that can be undone.** An `import_batch_id` on the rows, and "Undo this import" for the whole batch. The alternative is deleting 140 rows by hand.

**Dates are confirmed, not guessed.** `03/04/2026` is March or April depending on who exported it. Detect the format where the file makes it unambiguous; ask where it doesn't.

**One account per import. No transfer pairing in v1.** A bank file shows one leg. Rows arrive as income or expense on the chosen account.

**The privacy policy changes.** It currently says *"Everything financial in Sorrel is information you typed in yourself."* With import that sentence is false. Testers now have accounts, so the policy's promise to tell people before a change applies: put it in the tester note that announces the feature.

---

# 6 — A movable dashboard, at a fifth of the size

Free-form drag-anywhere grids are a large build with a long tail: touch behaviour, breakpoints, saved layouts that break when you add a widget. Custom dashboards are also one of the things I said Monarch already does well, and that racing them there is the wrong race.

The version worth building:

- **An "Edit layout" mode** where sections can be reordered and hidden.
- **The Safe to Spend hero stays pinned first and can't be hidden.** It is the product.
- **Every move works from the keyboard** — move up / move down buttons beside the drag handle. Dragging with no alternative fails the accessibility standard you already passed.
- **Saved by an explicit Save**, into the user's settings. A deliberate action, never a write during render. "Reset to default" beside it.
- **Stored as an ordered list of section names.** Unknown names are ignored and new sections append at the end, so shipping a new widget later can't break anyone's saved layout.
- Anyone who never opens edit mode sees exactly what they see today.

Before building it: did a tester ask for this? If so, find out what they wanted to move. "I want Coming up at the top" is a default-order problem, and fixing the default helps all five instead of one.

---

## The prompt

```
Six items. Read docs/Views-Search-Import-Layout.md in full first. Add all
six to docs/queue.md in the order the doc gives, with Safe-to-Spend-Why
staying ahead of the features.

PHASE 1 — REPORT ONLY. Build nothing.

ITEM 4 FIRST — a tester sees each upcoming bill twice, once "(fixed)" and
once "(as entered)".

My hypothesis, to verify not assume: "(fixed)" is a schedule occurrence and
"(as entered)" is a future-dated transaction entered by hand for the same
bill. Since migration 65 both reach the upcoming list and BOTH are
subtracted in the projection — one bill counted twice.

 1. Where do those two labels come from? Confirm what each means.
 2. Read-only against production, by ref: for each user, how many
    (schedule occurrence, unlinked future-dated transaction) pairs share
    account + amount + a date within the schedule's tolerance? Counts per
    user only — no descriptions, no amounts.
 3. For such a pair, does the projection subtract both? Quote the code.
 4. How does link_transaction_to_schedule (migration 60) treat a
    FUTURE-dated transaction — does the schedule then skip that occurrence
    and does the confirmation queue stay quiet on the day?

THEN, for the rest:
 5. How is the transaction list built today — what filters exist, are they
    in the URL, and is the list one component or several?
 6. Is there any existing account detail route?
 7. For import: what client-side CSV parsing would you use, and what is the
    current maintenance and security state of the xlsx options? Don't pick
    one from memory.

Report all seven, then stop.

PHASE 2 — after I rule:

ITEM 4: where a schedule occurrence and an unlinked future-dated
transaction match on account + amount + date window, show them as a PAIR
with one question: "Is this the same bill?" Yes links them through the
existing link function so the bill counts once. No is remembered so the
pair isn't asked again. Ask at entry time too. Never auto-merge. Nobody
edits a tester's data — the question is the cleanup tool.

ITEM 3: account name on Coming up lines; both ends for a transfer.

ITEMS 1+2: ONE filterable transaction list, filters in the URL: account,
category, type, date range, text.
  - /accounts/[id]: balance on top READ FROM v_account_balances, never a
    sum of the rows on screen. Balance date and last-logged under it. The
    list filtered to the account. Add transaction pre-filled with the
    account; quick add joins the allowlist for account pages.
  - Search: description, notes, category, account, exact amount. Server
    side. Composes with every other filter. Empty state names the query.
  - "Every number is a door": budget spent -> its transactions; a category
    -> its transactions; the Safe to Spend low-point item -> its schedule
    or transaction. Queue the rest.

ITEM 5 EXPORT: CSV from Settings, UTF-8 with BOM. GUARD AGAINST FORMULA
INJECTION — a cell starting with = + - or @ must open as text. Update the
terms and privacy "email us for an export" wording to the button.

ITEM 5 IMPORT: do NOT build yet. After the Phase 1 report I'll write its
own spec. The decisions it rests on are in the doc.

ITEM 6: edit mode with reorder and hide. Hero pinned first, never
hideable. Keyboard move up/down for every move. Explicit Save into
settings — never a write during render. Layout stored as an ordered list
of section names; unknown names ignored, new sections appended.
```
