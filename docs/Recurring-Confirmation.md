# Recurring transactions — confirm what happened, don't assume it

**Three reported problems, one model. Nothing posts itself.**

> **Amended 2026-10-17 after the Phase 1 report.** Three lines below were
> ruled against and are marked *Withdrawn* where they stand, with the reason.
> Where this document and CLAUDE.md disagree, CLAUDE.md wins. Don't reinstate
> a withdrawn line without a new ruling.
>
> 1. **Income past its late edge leaves the projection** (CLAUDE.md's existing
>    rule) but **never leaves the confirmation queue.**
> 2. **"Don't shift expenses earlier" is withdrawn.** The projection keeps the
>    early edge for obligations; the queue opens on the expected date.
> 3. **Revised dates are out of v1.** "Hasn't landed yet" changes nothing and
>    asks again tomorrow.

---

## The rule this extends

Already in CLAUDE.md, written for income during Safe to Spend v2.1:

> **Confirmation gates transaction creation. It never gates the projection.**

Everything below is that one sentence applied to every recurring type instead of just one, plus the realisation that **the predicted date is as unreliable as the predicted amount.**

Item 3 — the credit card statement posting on the wrong day — is not a separate defect. It is what the absence of this rule looks like from the outside: the app took a prediction, treated it as a fact, and wrote a financial record nobody approved.

---

## The model

A recurring schedule produces an **expectation**, never a transaction.

| | |
|---|---|
| **An expectation** | has an estimated date and an estimated amount. It appears in the projection, in Safe to Spend, and in What's Ahead. It is **not** in the ledger and does **not** move any balance. |
| **A transaction** | is a record of something that happened. It exists only because a person said it happened. |

The crossing from one to the other is confirmation, and it is the only crossing.

**Nothing creates a transaction from a schedule automatically. Not on its due date, not on a grace period, not on app open, not ever.**

---

## Three outcomes, not two

The mistake almost every app makes here is offering confirm or dismiss. There are three real answers, and the third is the one that matters most.

### 1. It landed as expected

One tap. Creates the transaction with the predicted date and the predicted amount. This is the common case and it must cost exactly one tap — if it costs two, people stop doing it, and an abandoned queue is worse than no queue.

### 2. It landed differently

Opens the amount and the date for editing, pre-filled with the predictions. The user changes what's wrong and saves. **The date is editable in every case**, not only when the amount changed — that's the core of items 1, 2 and 3.

### 3. It hasn't landed yet

Creates nothing. The expectation **stays in the projection** — it hasn't been cancelled, it's just late. ~~Optionally the user gives a revised date.~~

> *Withdrawn (ruling 4): no revised date in v1.* "Hasn't landed yet" leaves the expectation exactly as it was and the queue asks again tomorrow. A revision needs somewhere on the schedule to live for one occurrence only, which means a new column or overloading `next_due_date` (and so the `recurring_due_date_stale` integrity check). Neither is worth it yet: the real date arrives through "landed differently".
>
> *Amended (ruling 1):* for income, "stays in the projection" holds only until its late edge. Past that, unconfirmed income leaves the projection — counting money that probably isn't coming over-promises — but it stays in the queue, so a late paycheck that does land is still one tap away.

This third outcome is what makes the feature honest. A bill that hasn't come out yet is still coming out, and an app that quietly drops it from the forecast has lied about the user's future balance. That is the exact failure Safe to Spend exists to prevent.

There is also a fourth, rarer answer: **it's not happening this time** — skipped, cancelled, refunded. That removes this one occurrence from the projection without touching the schedule.

---

## Never auto-confirm. Bulk-confirm instead.

The obvious shortcut — "auto-post anything the user hasn't reviewed in seven days" — reintroduces the whole defect with a delay on it. A record nobody approved is a record nobody approved, whether it was written on day zero or day seven.

The real problem it tries to solve is drudgery, and the right answer to drudgery is **bulk confirmation**:

> **4 things to confirm** — Rent $1,850 · Car payment $412 · Netflix $22.99 · Transfer to Savings $300
> **[ Confirm all as expected ]**  ·  review individually

One tap for four items when the month was ordinary. Individual review when it wasn't. No automatic writes anywhere.

---

## Where confirmation lives

A **queue**, not a modal.

A dialog that blocks the dashboard until it's dealt with trains people to dismiss it without reading — which produces confirmations that are technically user actions and factually meaningless.

- A quiet, persistent entry point: a count on the dashboard, and a section on the recurring page
- Nothing is blocked while the queue has items in it
- Items appear when their estimated date arrives, and stay until answered
- The queue never scolds. "4 to confirm" — not "4 overdue", not red, not an alert. These are housekeeping, not failures.

**Unconfirmed is not invisible.** Safe to Spend already counts every expectation whether or not it's been confirmed, so the headline number is correct either way. The only thing an unanswered queue costs is a ledger that lags reality — which is the user's choice to make.

> *Amended (ruling 1):* every **outflow** expectation, yes. **Income** is counted until its late edge and then dropped, unconfirmed; it stays in the queue regardless. The hero explains a dropped paycheck in place.

---

## Item 3 specifically: the date is an estimate

A credit card statement doesn't arrive on a fixed day of the month. Cycles shift with weekends and month lengths. Treating "the 14th" as a fact rather than an estimate is what produced the premature post.

**Every recurring schedule gets an estimated date and a confidence about it.** At minimum, two kinds:

| | Behaviour |
|---|---|
| **Fixed** | Happens on this day, reliably. Rent, a subscription. Appears for confirmation on the day. |
| **Approximate** | Happens around this day. A statement, a variable utility, a paycheque with date variance. Appears for confirmation on the estimated day, and the confirmation step makes the date prominent rather than incidental. |

Income with date variance — item 2 — is already the "approximate" case. It should use the same mechanism rather than a parallel one.

~~The projection uses the estimated date in both cases. Don't shift expenses earlier to be "safe": a forecast that deliberately overstates the trough is a forecast that lies, and the user will learn to discount it.~~

> *Withdrawn (ruling 2):* CLAUDE.md's "Uncertainty always pushes the forecast down" stands — income on its late edge at its low amount, obligations on their early edge at their high amount. Safe to Spend is a floor, not an expected value, so a bill that can land early is counted early. The two uses of one schedule don't conflict: the **projection** uses the tolerance edges; the **queue** opens on the expected date (minus the tolerance, so an early arrival can be confirmed the day it lands; for a fixed schedule, the expected date itself). Tolerance stays one concept, `date_tolerance_days`, now allowed on transfers too (migration 50).

**Later, not now:** modelling a statement properly as a closing date plus a due date some weeks after. That's the correct shape for credit cards and it's a bigger change. The estimate-plus-confirmation model above fixes the reported bug without it.

---

## Scope

**Now, before testers arrive:**

- Nothing posts automatically, for any recurring type
- The confirmation queue, with all four outcomes
- Date editable on every confirmation
- Bulk "confirm all as expected"
- Fixed vs approximate on the schedule

**Later:**

- Statement closing date and due date as separate concepts
- Learning a schedule's real pattern from confirmation history
- Reminders

---

## Two things not to do

**Don't touch history.** Transactions already created by the old auto-posting exist and the user can edit them. Retroactively marking them unconfirmed would put a pile of busywork in the queue on day one and teach everyone to ignore it.

**Don't add a second date column.** "Posted date" and "transaction date" are the same thing — what the user confirms *is* the transaction's date. The schedule holds the estimate; the transaction holds the fact. Resist a schema where a row carries both.

---

## The prompt

```
Recurring transactions must stop creating themselves. Confirmation becomes
the only path from a schedule to a transaction, for every type.

READ docs/Recurring-Confirmation.md in full first.

PHASE 1 — REPORT ONLY. Build nothing until I've seen this.

My spec is written against a model I have not verified. Tell me where it
doesn't match the code rather than forcing it to fit.

 1. Where does catch-up / auto-creation of recurring transactions happen?
    Quote the entry point. CRITICAL: does it run during a page render? Phase
    7 found three render-time writes and "dashboard creating recurring
    transactions" was one of them. If it still renders-and-writes, that
    alone may be the cause of the premature statement post.

 2. The income confirmation flow that already exists — where is it, what
    does it write, and what does it do with the date? This is the mechanism
    to extend. I do not want a second one.

 3. The schedule model: which columns define when an occurrence is due?
    Is there any notion of an estimated vs fixed date today?

 4. Credit card statements: how is the statement date currently derived,
    and how does card_balance_owed in v_upcoming_recurring relate to it?

 5. What distinguishes an expectation from a transaction in the current
    schema? Is there a row for an unconfirmed occurrence, or is "unconfirmed"
    simply the absence of a row?

 6. Which surfaces read recurring occurrences — the projection, Safe to
    Spend, What's Ahead, UpcomingList, the dashboard? List them. This has
    the same one-rule-many-consumers shape as Batch 2 and must end with a
    single source of truth, not a comparison written out five times.

Report all six, then stop.

PHASE 2 — after I've ruled on your report:

THE INVARIANT: a recurring schedule never creates a transaction. Only a
person's confirmation does. No grace period, no auto-post, no write on app
open. If you find a code path that writes one without an explicit user
action, that is a bug regardless of what any comment says.

FOUR OUTCOMES on each confirmation:
  - Landed as expected   -> create with predicted date and amount. ONE TAP.
  - Landed differently   -> edit amount and/or date, pre-filled. The DATE is
                            editable in every case, not just when the amount
                            changed.
  - Hasn't landed yet    -> create nothing. The expectation STAYS IN THE
                            PROJECTION. Optional revised date.
                            [Withdrawn, ruling 4 -- see above.]
  - Not happening        -> drop this occurrence only; the schedule stands.

BULK: "Confirm all as expected" for the whole queue. No automatic writes.

PLACEMENT: a queue, not a modal. Nothing is blocked. Neutral tone and
neutral colour — "4 to confirm", never "overdue", never red. These are
housekeeping items, not failures. The red rule applies.

FIXED vs APPROXIMATE on the schedule. Income with date variance uses the
same mechanism — do not build a parallel path for it.

NOT IN SCOPE: separate statement-closing and payment-due dates; pattern
learning; reminders; retroactively unconfirming existing transactions.

NO SECOND DATE COLUMN. The confirmed date IS the transaction date.

VERIFY:
  - Grep for every write of a transaction row that is not downstream of an
    explicit user action. There must be none.
  - A schedule whose date passes with no user interaction creates nothing,
    and Safe to Spend's number is unchanged by that fact.
  - "Hasn't landed yet" leaves the projection identical.
  - Confirming with a changed date puts the transaction on the changed date
    and moves the balance accordingly — this interacts with the anchor rule
    from the balance batch, so test them together.
  - Bulk confirm of 4 items produces exactly 4 transactions.
```
