# Budgets, reminders, and the pending-charge gap

**Six changes. One of them is a money-correctness bug with no visible symptom.**

---

# 4 — The pending charge that never counts

Taking this first because it's the only item here that produces a wrong number.

## What happened

1. Monday: a charge hits the card. The bank holds it as **pending**.
2. Tuesday: the user reads their card balance and sets Sorrel's anchor to it. **That figure doesn't include Monday's pending charge.**
3. Thursday: the charge posts — backdated by the bank to **Monday**.
4. The user logs it dated Monday, which is before Tuesday's anchor, so the anchor rule excludes it.

The card balance is now understated by that charge, permanently, and nothing on screen says so.

## Why the rule is wrong here

The anchor rule rests on an assumption: *the figure you entered already includes everything up to the moment you entered it.* That's true of posted activity and false of pending activity.

**The anchor reflects what the bank had posted, not what had happened.** Every card has a gap between those two, usually a day or three, and it's exactly where this falls.

## The fix: turn the existing note into a question

There's already a note when someone enters a transaction dated before the anchor — *"this is before your balance date."* It states a fact and leaves the user to work out the consequence, which almost nobody will.

Make it a question instead, because the app can't know the answer and the user can:

> **This is dated before your balance of $1,240 on 3 November.**
> Was it already included in that balance?
>
> **Yes, it's already counted** · **No, add it to my balance**

- **Yes** → current behaviour. The transaction is recorded for history and doesn't move the balance.
- **No** → it counts, despite its date.

That's one tap, at the only moment it matters, and it only appears for pre-anchor transactions — which should be rare.

## Three things to get right

**Make the choice required, not defaulted.** This case is uncommon enough that a required answer isn't a burden, and either silent default corrupts something: defaulting to *yes* reproduces the bug, defaulting to *no* double-counts anyone entering historical transactions for completeness.

**Show the answer afterwards.** A transaction counting against the balance despite its date must say so when you open it. Invisible exceptions are how a balance becomes inexplicable six months later.

**Don't extend the rule by inference.** It's tempting to say "a pre-anchor transaction recorded *after* the anchor was set probably wasn't included" and count it automatically. That breaks for the user who sets their balance today and then back-fills last month's spending for completeness — their transactions *were* in the figure, and counting them would double them. The app genuinely cannot tell these apart. Ask.

---

# 2 — Budgets carry forward

**Derive, don't write.**

A month with no budget rows of its own shows the amounts from **the most recent month that has them** — not necessarily last month, so skipping a month doesn't reset anyone to zero. Nothing is created until the user edits something, and then only for that month.

That gives you the behaviour without a scheduled job, without a rollover event, and without a page render writing rows — which is the rule three Phase 7 findings came from, and a budgets page that materialises next month's rows when someone opens it on the 1st is exactly that shape.

- A category deliberately set to $0 carries forward as $0. That was a choice; respect it.
- A category deleted since is skipped.
- The page should say where the figures came from — *"carried from October"* — so an untouched budget doesn't look like something the user set and forgot.

---

# 3 — No duplicate budget categories

A unique constraint on `(userid, month, categoryid)`.

**Check production for existing duplicates before writing it.** A single violating row fails the migration on deploy, and if a tester has one it's their data — a conversation, not a silent repair. This is the same check the statement-day constraint needed, and it's cheap.

Worth also reporting *how* duplicates became possible: if two rows can exist, something inserts without checking, and the constraint should be the backstop rather than the fix.

---

# 1 — Due-date reminders

## One list, two states — not a second queue

The confirmation queue already exists and already has rules: neutral tone, never red, never a task. A separate "coming up" surface would mean two lists of overlapping things, which is clutter that teaches people to read neither.

Instead the same item has two states:

| When | State | Says |
|---|---|---|
| 5 days before due | **Coming up** | "Rent · $1,850 · Friday" |
| On or after due | **To confirm** | "Did rent come out?" |

One component, one place to look, and the item the user saw on Monday is the same item they confirm on Friday.

## What "fun" can and can't mean here

Nobody wants whimsy about rent. Fun in a finance app means **not anxious**, and the levers are:

- Warm colour, never red, never amber-as-warning
- Plain language: "Friday", not "in 5 days", and never "overdue" or "due soon!"
- **No count badge.** A number in a circle reads as unread email and generates exactly the low-grade dread this product exists to avoid
- The flower's motion vocabulary is available if something needs to animate, at the gentlest end of it

The test: someone glancing at their dashboard should feel *informed*, not *behind*.

## And it must be dismissible per item

Someone who knows rent is coming doesn't need five days of being told. A quiet "got it" that hides the coming-up state until the due date arrives, without affecting the confirmation.

---

# 5 — Last activity per account

A line per account: when the user last logged something there.

**Use the creation time, not the transaction date.** The question is "when did I last touch this account," not "what's the most recent date I've recorded" — someone entering a week of backdated transactions today has been active today.

**It pairs with item 4.** An account nobody has logged to in three weeks is an account whose balance is probably stale, and that's the same problem the pending-charge gap creates. Showing it is how a user notices before the number misleads them.

**Tone matters more than it looks.** "Last logged 12 days ago" is a fact. "You haven't logged anything in 12 days" is a scolding, and the difference is the whole tone rule. Neutral colour, no warning state, no threshold at which it turns red.

---

# 6 — Quick add on Categories and Settings

Remove it from both.

**And invert the rule while you're there.** This is the second removal — Recurring and Goals went last week. A growing list of exclusions guarantees a third round. Replace it with an allowlist of the screens where quick add *belongs*, so the default for a new screen is "no" rather than "yes, until someone notices."

---

## Order

1. **Item 4.** The only one producing a wrong number, and it's invisible.
2. **Item 3**, after the production check.
3. **Item 2.** Self-contained, and nobody wants to re-enter a budget on 1 December.
4. **Item 1.**
5. **Items 5 and 6** together — both small.

Items 2, 3, 5 and 6 don't touch the hero number. Item 4 changes balances, and only for users who answer "no" to a question they've never been asked, so it needs a tester note explaining what the question is.

---

## The prompt

```
Six changes. Read docs/Budgets-Reminders-and-Pending.md in full first.

PHASE 1 — REPORT ONLY:

 1. Where is the "this is before your balance date" note rendered, and does
    it read its answer from SQL (the single rule function) or recompute it?
 2. How are budgets stored — one row per category per month? What
    identifies the month? Is there any uniqueness today?
 3. Read-only against PRODUCTION: are there duplicate (userid, month,
    categoryid) budget rows? Report counts only, no amounts.
 4. How can duplicates be created today — which write paths insert budget
    rows without checking?
 5. Where is QuickAddBar mounted and what currently decides where it shows?
 6. What does the confirmation queue render from, and could the same
    component carry a "coming up" state 5 days ahead?

Report, then stop.

PHASE 2:

ITEM 4 — the pre-anchor question:
  Turn the existing note into a REQUIRED choice:
    "This is dated before your balance of $X on <date>. Was it already
     included in that balance?"
    [Yes, it's already counted] [No, add it to my balance]
  - "No" makes the transaction count toward the balance DESPITE its date.
  - The choice is REQUIRED. Either silent default is wrong: yes reproduces
    the bug, no double-counts someone back-filling history.
  - The transaction must SHOW afterwards that it counts despite its date.
    Invisible exceptions make a balance inexplicable later.
  - Do NOT infer it from created_at > anchor set_at. That breaks for anyone
    who sets a balance and then enters last month's spending — those WERE
    in the figure. The app cannot tell these apart; ask.
  - This must flow through the SINGLE rule function, not a second
    comparison.

ITEM 2 — carry budgets forward by DERIVING, never writing:
  A month with no rows shows the MOST RECENT month that has rows — not
  strictly last month, so a skipped month doesn't reset anyone.
  Rows are created only when the user edits, and only for that month.
  NO scheduled job, NO rollover event, and NOTHING written by opening the
  page — that's the render-write rule.
  Label it: "carried from October".
  $0 carries as $0. Deleted categories are skipped.

ITEM 3 — unique (userid, month, categoryid), AFTER the production check.
  If any tester has duplicates, stop and tell me — that's their data and a
  conversation, not a repair. Also fix whatever write path allows them; the
  constraint is the backstop, not the fix.

ITEM 1 — reminders as a SECOND STATE on the existing queue item, not a
second list:
    5 days before due -> "Coming up": "Rent · $1,850 · Friday"
    on/after due      -> "To confirm": "Did rent come out?"
  One component. The item seen Monday is the item confirmed Friday.
  NO COUNT BADGE — a number in a circle reads as unread email.
  Warm colour, never red, never amber-as-warning. "Friday", not "in 5
  days". Never "due soon" or "overdue".
  Dismissible per item: hides the coming-up state until the due date,
  without affecting the confirmation.

ITEM 5 — last activity per account on the dashboard, from CREATED_AT not
  transaction_date. "Last logged 12 days ago" — a fact, not "you haven't
  logged anything in 12 days". Neutral, no threshold that turns red.

ITEM 6 — remove quick add from Categories and Settings, and INVERT THE
  RULE: an allowlist of screens where it belongs, so a new screen defaults
  to not showing it. This is the second removal; there shouldn't be a
  third.

VERIFY:
  - A transaction dated before the anchor cannot be saved without answering
    the question.
  - "No" moves the balance by exactly that amount, once; "Yes" doesn't move
    it at all.
  - Opening that transaction later shows which answer was given.
  - A fresh month shows last month's budget amounts with NO rows written —
    confirm by row count before and after loading the page.
  - Editing one category in a derived month creates rows for that month
    only.
  - A duplicate budget row is rejected by the database, not only the form.
  - A schedule due in 5 days shows as Coming up and becomes To confirm on
    the day, as the same item.
  - Quick add appears only on allowlisted screens; adding a new route
    doesn't get it by default.
```
