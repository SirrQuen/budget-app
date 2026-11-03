# Safe to Spend v2.1 — the income horizon bug, and squeeze points

> **Historical spec (sent 2026-10-02, added to the repo 2026-11-03).** Kept for
> the reasoning behind decisions. It describes work as planned, not as it
> stands: the code, CLAUDE.md and docs/phase-7-findings.md are the authority
> where they differ.

Two items. The first is a defect that makes the number badly wrong. The second is a feature that makes it genuinely useful.

Do them in order. The second is pointless until the first is fixed, because it would just display a distorted forecast in more detail.

---

# Item 1 — Income and expenses are using different horizons

## What's happening

The projection walks 35 days forward. Across that window it includes **every obligation** — four or five weeks of rent, cards, utilities, subscriptions.

But it includes **only the next income occurrence**, and in some cases only after that one has been confirmed.

So the forecast models a person who gets paid once and then never again, while every bill keeps arriving on schedule. Of course the number looks bleak. The number is describing a catastrophe.

## Why it happened — and it's partly my fault

Two rules from earlier phases collided, and the wrong one won.

Phase 6.75 item 6 established: **"Auto-create outflows. Confirm inflows."** That rule is correct and should stay. It governs *writing transactions into the ledger* — a paycheck that may not have arrived must not appear as money you have.

Safe to Spend v2 established that the projection uses income at the **late edge of its date tolerance and the low end of its amount estimate.** That presupposes every expected income occurrence is in the projection, conservatively estimated.

Those two documents never said explicitly that confirmation gates *creation only* and never *projection*. Read together, it's a reasonable misreading. The implementation applied "confirm inflows" to the forecast, and the forecast lost four weeks of income.

## Why leaving income out is wrong, not cautious

This is the part worth being precise about, because "it's conservative" is the natural defence and it's false.

Omitting future income doesn't make the forecast safer. It makes it **model a different person** — one whose income stops. The trough it finds isn't a pessimistic version of the user's real low point; it's the low point of a fiction.

And it fails in the specific direction that destroys trust. A user who looks at the breakdown, sees a projected low point three weeks out, and knows perfectly well they get paid twice before then, learns that the app doesn't understand their money. That's worse than a number being slightly off — it's the app being obviously, checkably wrong about something the user can see.

The conservative treatment of uncertain income is to **estimate it low and late**. It is not to pretend it doesn't exist.

## The diagnostic signature

Here's how to confirm this is what's happening, and it's a useful check to keep:

> **If the trough lands on or near the last day of the horizon, almost every time, the projection is missing income.**

A real financial life has its low point *just before a paycheck* — somewhere in the middle of the window, recovering afterwards. A projection whose minimum is always the final day is a projection that only goes down, which means money is going out across the whole window and coming in across only part of it.

## Worked case

Today is 1 October. Paid on the 15th and the last day of the month, $1,800 each.

| Date | Event |
|---|---|
| Oct 3 | Rent −$1,200 |
| Oct 10 | Car −$400 |
| Oct 15 | **Paycheck +$1,800** |
| Oct 20 | Utilities −$250 |
| Oct 25 | Card payment −$600 |
| Oct 31 | **Paycheck +$1,800** |
| Nov 1 | Rent −$1,200 |

Cash today: **$2,400**. Cushion: $300. Horizon: 35 days, to 5 November.

**What the app currently computes** — all obligations, only the 15 Oct paycheck:

| Date | Balance |
|---|---|
| Oct 1 | $2,400 |
| Oct 3 | $1,200 |
| Oct 10 | $800 |
| Oct 15 | $2,600 |
| Oct 20 | $2,350 |
| Oct 25 | $1,750 |
| Oct 31 | $1,750 — *paycheck missing* |
| Nov 1 | **$550** ← reported trough |

Safe to spend: $550 − $300 = **$250**. Low point reported as 1 November.

**What's actually true** — both paychecks included:

| Date | Balance |
|---|---|
| Oct 1 | $2,400 |
| Oct 3 | $1,200 |
| **Oct 10** | **$800** ← real trough |
| Oct 15 | $2,600 |
| Oct 20 | $2,350 |
| Oct 25 | $1,750 |
| Oct 31 | $3,550 |
| Nov 1 | $2,350 |

Safe to spend: $800 − $300 = **$500**.

Twice the number. And the low-point line — the feature that makes the whole thing worth having — moves from **1 November**, which is an artifact, to **10 October**, which is real, nine days away, and genuinely worth knowing.

## The rule

> **Confirmation gates transaction creation. It never gates the projection.**
>
> Every expected income occurrence inside the horizon appears in the projection, whether or not it has been confirmed, estimated conservatively:
> - **Amount:** the low end of the estimate
> - **Date:** the late edge of the date tolerance
>
> A confirmed occurrence uses its confirmed amount and date instead, because that's better information.
>
> This is symmetric with obligations, which already project across the full horizon without anyone confirming them.

## The prompt

```
There is a defect in the safe-to-spend projection: obligations project across the
full horizon, but income does not. Only the next income occurrence is included,
and in some paths only after it has been confirmed. The forecast therefore models
a person whose income stops after one payday while every bill continues.

THE RULE: confirmation gates transaction CREATION only. It must never gate the
PROJECTION.

Fix:

1. The projection must generate EVERY expected income occurrence inside the
   horizon from each active recurring income schedule — the same way it already
   generates every expected obligation. Not just the next one. Not only
   confirmed ones.

2. Estimate unconfirmed income conservatively, as the v2 spec already requires:
     - Amount: the LOW end of the estimate range
     - Date: the LATE edge of the date tolerance
   A confirmed occurrence uses its confirmed amount and date instead.

3. Do NOT change the auto-create / confirm asymmetry for actual transactions.
   Income still requires confirmation before a row is written to the ledger.
   Only the forecast changes.

4. Check whether the same bug exists for variable-amount EXPENSES — particularly
   variable credit-card payments, which also have a confirmation step. If those
   are also being dropped from the projection beyond the first occurrence, that's
   the same defect in the opposite direction and understates the risk. Report
   what you find.

Before you change anything, show me for my own account:
  - Every income occurrence the projection currently includes, with dates
  - Every income occurrence it SHOULD include across the full horizon
  - The same two lists for obligations

I want to see the asymmetry stated as data before it's fixed.

Add these tests:
  - Semi-monthly income over a 35-day horizon → projection contains 2 or 3
    income events, not 1
  - Weekly income over a 35-day horizon → 5 income events
  - Monthly income, horizon extended to the payday after next → 2 income events
  - An unconfirmed variable income occurrence → included at the LOW amount and
    the LATE date
  - A confirmed occurrence → uses the confirmed values, not the estimate
  - Regression guard: assert the trough does NOT land on the final day of the
    horizon in a scenario with recurring income — that pattern is the signature
    of this bug returning
```

---

# Item 2 — Show every squeeze, not just the deepest

## Why one number isn't enough

The trough answers "how much can I spend." It doesn't answer "when should I be careful," and those are different questions with different answers.

A forecast can dip below zero on the 9th, recover on payday, and dip again on the 24th. If the 24th is deeper, that's the only one the breakdown mentions — and the 9th, which is **two weeks sooner and still a bounced payment**, goes unsaid.

Soonest matters more than deepest. The user can act on something nine days out. Something twenty-four days out will probably have resolved itself by the time it arrives.

## Episodes, not days

A dip isn't a day. A balance that goes negative on the 14th and recovers on payday the 17th is **one event lasting four days**, not four events. List it as four rows and the breakdown becomes unreadable noise.

So group contiguous runs:

```
Classify each day in the projection:
  shortfall:  projected < 0
  tight:      0 ≤ projected < cushion
  clear:      projected ≥ cushion

Group contiguous non-clear days into one episode.

Each episode carries:
  - start date        first day it leaves clear
  - end date          last day before it returns to clear
  - severity          the worst class reached inside the run
  - low point         minimum projected balance in the run, and its date
  - drivers           obligations landing inside the run, largest first
  - recovery          the date and the event that ends it, usually a paycheck
  - open_ended        true if it has not recovered by the end of the horizon
```

## What the user sees

The breakdown keeps its current shape and gains a section beneath it:

> **$500**
> Safe to spend
>
> ---
> Cash on hand today — $2,400
> **Your lowest point ahead: $800 on Friday 10 October**
> Cushion — $300
> **= $500 safe to spend**
>
> ---
> **What's ahead**
>
> **3–10 Oct** · down to $800, your lowest point
> Rent on the 3rd, car payment on the 10th. Clears with your paycheck on the 15th.
>
> **1–3 Nov** · down to $140, below your cushion
> Rent on the 1st. Clears with your paycheck on the 3rd.
>
> *Next: about $1,800 expected Wednesday 15 October*

Rules for that section:

- **Chronological order, always.** Not sorted by severity. The soonest one is the one the user can still do something about.
- **The trough's episode is marked inline** ("your lowest point") rather than listed twice. The trough line above and the episode list are the same forecast seen two ways; don't make the user reconcile them.
- **Name the cause.** An episode with no explanation is just anxiety. "Rent on the 3rd" turns it into a fact.
- **Name the recovery.** Every episode that ends should say what ends it. This is the single most reassuring piece of information available, and it costs nothing — the projection already knows.
- **Cap at five episodes**, then "and N more later in the forecast". More than five in 35 days means something is wrong with the data, not with the user's finances.
- **Open-ended episodes read differently.** If the balance is still below the line at the end of the horizon, say *"continues past the end of the forecast"* rather than inventing a recovery date. An episode that doesn't recover within five weeks is partly an artifact of where the window stops, and the copy shouldn't pretend otherwise.

## When there's nothing to show

Say so. Plainly, once, and then stop:

> **What's ahead**
> No tight days in the next five weeks.

Don't celebrate it, don't add an icon, don't offer advice. The absence of a warning is the information.

## Tone — this is the part that matters

The product rule stands: **never discourage users about spending.** A list of upcoming squeezes is the easiest place in the entire app to break it.

- **No red.** Red is mark-only, per Phase 6.9 item 1. Not for shortfalls, not for severity, not for anything here.
- **No warning icons, no exclamation marks, no "alert", "danger", "warning" or "risk" in any string.**
- **Severity is carried by the words**, not by colour or iconography. "Down to $140, below your cushion" and "projected $180 short" are different sentences; they don't need different colours.
- **State facts, name days, name causes.** Three weeks of notice before a bounced payment is the most valuable thing this app can give someone — and it only lands if it reads as information rather than as the app being worried about them.

The test for any string in this section: would it read as useful if someone's finances were completely fine and they were just curious about the month ahead? If not, rewrite it.

## The prompt

```
Extend the safe-to-spend breakdown to surface every squeeze in the forecast, not
only the single lowest point. Do this AFTER the income-horizon fix is merged —
this feature displays the projection in more detail, so the projection must be
correct first.

CALCULATION

Walk the existing projection and classify each day:
    shortfall   projected < 0
    tight       0 <= projected < cushion
    clear       projected >= cushion

Group contiguous non-clear days into episodes. Return from getSafeToSpend() an
array of episodes, each with:
    startDate, endDate
    severity          "shortfall" | "tight"   (worst class reached in the run)
    lowPoint          { amount, date }
    drivers           obligations landing inside the run, largest first
    recovery          { date, description } — the event that ends it
    openEnded         true if still non-clear at the end of the horizon
    containsTrough    true for the episode holding the overall minimum

Episodes must be chronological. Do not sort by severity.

UI

Add a "What's ahead" block beneath the existing breakdown lines.

  - Chronological order
  - The trough's episode is annotated inline ("your lowest point"), not listed
    separately — the trough line above and this list are one forecast, and the
    user must not have to reconcile two numbers
  - Each episode names its drivers and its recovery event
  - Open-ended episodes say "continues past the end of the forecast" rather than
    inventing a recovery date
  - Show at most 5, then "and N more later in the forecast"
  - No episodes → one line: "No tight days in the next five weeks." Nothing else.

COPY AND TONE — these are hard constraints, not preferences

  - NO red anywhere in this feature. Red is reserved for the Sorrel mark.
  - No warning icons, no exclamation marks.
  - The words "alert", "warning", "danger", "risk", "overdraft" and "negative"
    must not appear in any user-facing string.
  - Severity is expressed in wording, not colour or iconography.
  - Shortfall phrasing: "projected $180 short on 14 October"
  - Tight phrasing: "down to $140, below your $300 cushion"

Every string must read as useful to someone whose finances are fine and who is
simply looking at the month ahead. If a string only makes sense as a warning,
rewrite it.

TESTS

  - Two separate dips with a recovery between → 2 episodes, chronological
  - A four-day continuous dip → ONE episode spanning four days, not four
  - A dip containing the overall trough → containsTrough true, and the UI does
    not list that episode twice
  - A dip still below the line on the final horizon day → openEnded true, no
    recovery date rendered
  - Balance never falls below the cushion → empty array, and the UI renders the
    single "no tight days" line
  - A day exactly equal to the cushion → clear, not tight (boundary check)
  - A day exactly at zero → tight, not shortfall (boundary check)
  - Seven or more episodes → exactly 5 rendered plus an accurate "and N more"
```

---

## Sequencing

1. **Item 1 first**, on its own branch. Verify against your own account using the before/after data the prompt asks for — you'll know immediately whether the income list looks like your actual pay schedule.
2. **Then item 2.**
3. **Then** start Phase 7 Section 1.

Doing item 1 before Phase 7 is the right call. Section 6b of Phase 7 asks you to hand-check the live projection against what you know about your own money — and you'd have found this bug there anyway. Better to fix it now than to discover it mid-audit and have to decide whether to break Rule 1.
