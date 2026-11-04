# How a recurring amount evolves, and editing a transfer

**Four changes. Two of them are one subject, and the answer isn't a new prompt.**

---

# 1 and 2 — the amount that carries forward

## The problem, stated precisely

> **Correction (2026-11-02, from the Phase 1 report).** The premise below is
> wrong in its detail: the next occurrence never carried the last confirmed
> amount forward. It was the **mean of the last three confirmed**, or the
> schedule's own amount with fewer than three -- and the projection counted
> that mean for an obligation, breaking "uncertainty pushes the forecast
> down". Migration 58 (1b) fixes the forecast; 1a's labels matter more for
> it, since "amount is an estimate" never said what the estimate rests on.
> CLAUDE.md, "Recurring transactions", records the rule as it now stands.

A variable bill is confirmed at $142. The next occurrence queues at $142. Next month's bill is $210, and until someone notices, Safe to Spend is $68 optimistic.

The instinct is to prompt for the new amount. **Resist it.** The user usually doesn't have next month's figure at the moment you'd be asking, and a queue that asks questions nobody can answer is a queue people stop reading. Once they stop reading it, the confirmation model that everything else rests on quietly dies.

Three cheaper changes do more.

## a. Label the estimate — this is most of the win

Today the queue shows `$142`. It should show where that number came from:

> **Electric** · $142 *(last month)*
> **Water** · $64 *(average of last 3)*
> **Rent** · $1,850 *(fixed)*

A number with its provenance attached is a number the user can judge. Seeing *(last month)* next to a summer air-conditioning bill in October is all the prompt anyone needs — and it costs a parenthesis rather than a new surface.

This is the single highest-value item in this document, and it's close to free.

## b. Estimate better than "last month"

Carrying the last value forward is the worst defensible estimate. In rough order of preference, when the data exists:

1. **The same month last year**, for anything seasonal — heating, cooling, water
2. **The average of the last three**, for anything that drifts
3. **The last confirmed amount**, as the fallback

And per the standing invariant — uncertainty pushes the forecast down — an obligation takes **the high end of the recent range**, not the mean. A bill that has been $120, $190 and $142 is estimated at $190, labelled *(highest of last 3)*.

That label matters as much as the number. A user who sees $190 on a bill that averages $150 will wonder why; *(highest of last 3)* answers it before they ask.

## c. An amount window with a lead time

The card payment already has this: the statement posts, a window opens, the user enters the real figure. Generalise it, keyed on **days before due** rather than a statement day, because a non-card bill has no statement date.

> **Electric** · due Friday · $190 estimated
> `[ I know the amount ]`

In the existing confirmation queue. Not a notification, not a badge, not a separate screen.

**And it must never read as a task.** The estimate is always usable; updating it is always optional. If someone never touches it, nothing is broken and nothing nags. The moment this feels like homework, item (a)'s benefit goes with it.

## d. Editing a logged amount — ask the scope

Item 2 asks that editing a logged recurring transaction updates the next queued one. That's right in one case and wrong in the other, and the app can't tell which:

- *"It was $142, I typed $412"* — the schedule was wrong too. Propagate.
- *"It was $412 this month because of the repair"* — the schedule is fine. Don't.

Silently propagating a one-off correction into the forecast is worse than not propagating at all, because the user has no idea their future number just moved.

So **ask**, with the pattern every calendar app has taught people:

> **Just this one** · **This and future occurrences**

With a smart default, because the likely answer differs by schedule type:

| Schedule | Default | Why |
|---|---|---|
| **Fixed amount** | This and future | A changed rent is a changed rent |
| **Variable amount** | Just this one | Variation is the point of a variable schedule |

The choice stays visible either way. Defaults are a courtesy, not a decision made on the user's behalf.

---

# 3 — Quick add on recurring and goals

Remove it from those two screens, leave it everywhere else.

Worth one check before deleting: report what it currently does there. On a page about *schedules*, a control that creates a *transaction* is a category error, which is presumably why you want it gone — but confirm it isn't wired to something else first.

---

# 4 — Editing a transfer

## The model

A transfer is **one thing with two legs**. Everything follows from that.

- Opening **either** leg opens the transfer editor, not a transaction editor
- The editor shows the transfer: from, to, amount, date, description
- Saving writes **both legs atomically** — both, or neither
- Direction can be swapped; from and to can each be changed

The reason editing is blocked today is that editing one leg desyncs the pair. The fix isn't to allow that carefully — it's to stop exposing legs as editable things at all.

## Atomicity is not optional

Two sequential updates from the client can leave a transfer whose legs disagree, and a transfer whose legs disagree is money that doesn't net to zero. Supabase's client can't wrap two statements in a transaction, so this wants **one SQL function** that updates both legs, `SECURITY DEFINER`, scoped to `auth.uid()`, with a pinned `search_path` — the same shape as `delete_own_account()`.

That function becomes the **only** write path for an existing transfer. One place where "both legs agree" is enforced, rather than an invariant maintained by whoever remembers.

## What changes when the accounts change

Changing an account can move the transfer across the spendable-set boundary, which changes Safe to Spend. That's correct and needs no special handling — the classifier does it. But it does mean an edit to a transfer can move the hero number, and the editor shouldn't hide that.

## Two edges worth getting right

**The balance anchors differ per account.** A transfer's two legs sit on two accounts with two anchor dates. Moving the transfer's date can put it before one account's anchor and after the other's — so one leg counts toward its balance and the other doesn't. That's already possible when creating a transfer today, so it isn't new, but an editor makes it reachable by accident.

Surface it with the note that already exists: *"this is before your balance date"*, per account, reading the answer from SQL rather than recomputing it.

**A transfer generated by a recurring schedule** gets the same scope question as item 2 — just this occurrence, or this and future.

---

## Order

1. **Label the estimate** (1a). Nearly free, highest value, and it makes the rest optional rather than urgent.
2. **Transfer editing** (4). The clearest user-facing gap — delete-and-recreate is a real tax on a normal action.
3. **The scope question on amount edits** (2d). Small, and it prevents a silent forecast change.
4. **Better estimates** (1b) and **the amount window** (1c). More work, less urgent once the estimate is labelled.
5. **Quick add** (3). Whenever.

## On timing

The beta is running and the hero number has already moved twice in a week, with the goal-contribution change held until 9 November for that reason.

Items 1a, 2d, 3 and 4 don't change the number — they change labels, scope prompts, and what's editable. Those can ship as they're ready.

**Item 1b does change it**, for every variable bill, and in the direction of a smaller number. That one belongs with the goal-contribution change or after it, not as a third separate surprise.

---

## The prompt

```
Four changes. Read docs/Recurring-Amounts-and-Transfer-Editing.md in full
first.

PHASE 1 — REPORT ONLY:

 1. How is the next occurrence's amount determined today for a variable
    recurring expense? Quote the code. Is it the last confirmed amount, an
    estimate range, or something else?
 2. Is there any history available to estimate from — are confirmed
    amounts per occurrence recoverable, or only the schedule's current
    amount?
 3. How are the two legs of a transfer stored and linked? What exactly
    blocks editing, and where?
 4. Is there a single write path for creating a transfer, or is the pairing
    maintained by callers?
 5. What does quick add do on the recurring and goals screens — does it
    create a transaction, or something else?
 6. When a logged transaction came from a recurring schedule, is that
    link recoverable from the transaction?

Report all six, then stop.

PHASE 2 — in the order the doc gives:

1a. LABEL THE ESTIMATE in the confirmation queue and anywhere an upcoming
    amount is shown: "$142 (last month)", "$190 (highest of last 3)",
    "$1,850 (fixed)". A number with its provenance is a number the user can
    judge. This is the highest-value item here and it is nearly free.

4.  TRANSFER EDITING. A transfer is ONE THING WITH TWO LEGS.
    - Opening either leg opens the TRANSFER editor, not a transaction
      editor. Stop exposing legs as editable.
    - From, to, amount, date, description all editable. Direction can be
      swapped.
    - ATOMIC: one SQL function updating both legs, SECURITY DEFINER scoped
      to auth.uid(), pinned search_path — the shape of delete_own_account().
      Two sequential client updates can leave legs that disagree, which is
      money that doesn't net to zero.
    - That function is the ONLY write path for an existing transfer.
    - Per-account anchor note: moving the date can put the transfer before
      one account's anchor and after the other's, so one leg counts and the
      other doesn't. Show the existing "before your balance date" note per
      account, reading the answer from SQL.
    - A transfer from a recurring schedule gets the scope question below.

2d. SCOPE QUESTION on editing a logged recurring transaction's amount:
    "Just this one" / "This and future occurrences".
    Default: THIS AND FUTURE for a fixed schedule, JUST THIS ONE for a
    variable one. The choice stays visible either way.
    Do NOT propagate silently — a one-off correction quietly moving the
    forecast is worse than not propagating at all.

1b. BETTER ESTIMATES, when the history exists: same month last year, else
    average of last 3, else last confirmed. For an OBLIGATION take the HIGH
    END of the recent range, not the mean — uncertainty pushes the forecast
    down. Label it as such.
    THIS CHANGES THE HERO NUMBER. Hold it to ship with or after the
    goal-contribution change on 9 November.

1c. AMOUNT WINDOW with a lead time in days before due, in the existing
    confirmation queue. Not a notification, not a badge, not a new screen.
    IT MUST NEVER READ AS A TASK — the estimate is always usable, updating
    is always optional.

3.  REMOVE QUICK ADD from the recurring and goals screens only.

VERIFY:
  - Every upcoming amount shown anywhere carries its provenance label.
  - Editing a transfer from either leg updates both, and a forced failure
    mid-update leaves neither changed.
  - Swapping direction produces a correct pair.
  - Changing an account across the spendable boundary moves Safe to Spend
    correctly, once.
  - Moving a transfer's date before one account's anchor shows the note for
    that account only.
  - "Just this one" leaves the schedule untouched; "this and future"
    updates it; neither does the other.
  - Quick add is gone from exactly two screens and present everywhere else.
```
