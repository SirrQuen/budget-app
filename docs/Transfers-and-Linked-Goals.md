# Transfers in the forecast, and goals that fill themselves

**Four changes. Three of them are the same rule wearing different clothes.**

---

## The through-line

Sorrel already knows which account types hold spendable cash — `SPENDABLE_ACCOUNT_TYPES`, `spendable_cash_balance()`, `leaves_spendable_set()`. Item 1 applies that classifier to *scheduled transfers* instead of only to balances. Items 2 and 3 apply the same idea to goals: read an account, don't ask the user to retype what the account already says.

Nothing below introduces a new comparison. If a new `IN ('checking','savings','cash')` appears anywhere in the diff, it's wrong — that's the one-rule-many-consumers failure this project has already dug out of three times.

---

# 1 — Transfers in the Safe to Spend forecast

A transfer has two legs. What matters to the hero number is only whether money crosses the boundary of the spendable set.

| From | To | Effect on cash on hand | Treat as |
|---|---|---|---|
| spendable | spendable | none — the money is still spendable | **ignore entirely** |
| spendable | not spendable | leaves the set | **upcoming expense** |
| not spendable | spendable | enters the set | **upcoming income** |
| not spendable | not spendable | none | **ignore entirely** |

Checking → savings must not appear anywhere in the forecast. It changes nothing about what you can spend, and showing it as an outflow would understate the hero number for a user who sweeps money between accounts — which is most careful people.

## The part that's easy to miss

A crossing transfer doesn't just become "an expense" or "an income." **It inherits that side's uncertainty rule.**

From the recurring batch:

- **Acting as an obligation** (spendable → not spendable, e.g. paying a card): uncertainty pushes the forecast down. Early date, high amount. Stays counted when overdue.
- **Acting as income** (not spendable → spendable, e.g. moving money in from a brokerage): late date. Drops out of the projection past its late edge, while staying in the confirmation queue.

The direction across the boundary decides which rule applies — not the fact that the row is a transfer. A transfer schedule with `date_tolerance_days` now resolves its edge differently depending on which way the money goes.

## Before writing anything: the double-count check

`v_upcoming_recurring` already carries `card_balance_owed`, and `main`'s commit before the merge was "Price card payments per statement cycle." If the projection already accounts for card payments by some other path, adding transfers-as-expenses counts them twice — and a credit card payment is the single most common crossing transfer there is.

**Find out how card payments reach the projection today before adding a second route.** This is the first thing to report.

## Also

Only *upcoming* transfers matter. A transfer that already happened has already moved the balances the forecast starts from; counting it again would be double-counting of a different kind.

---

# 2 and 3 — Goals linked to an account

One mechanism, two formulas.

| Goal type | Link to | Progress |
|---|---|---|
| **Debt payoff** | a credit card or other liability account | starting balance − current balance |
| **Retirement** | an investment account | current account value |

Both read the linked account's balance. Neither asks the user to enter anything.

## Why debt is measured by balance, not by payments

You said "as the user is making payments or transfers to that card." The natural reading is *sum of payments*, and I'd argue against it.

Pay $500 on the card and charge $400 to it the same month, and a payments-based meter shows $500 of progress while the debt fell by $100. The meter fills while the thing it describes barely moves. That's the same defect as the streak badge you found and killed — a number that rewards activity rather than outcome.

**The point of a debt payoff goal is to owe less.** Measure the thing the goal is named after.

## The honest-but-not-discouraging problem

Balance-based progress can go backwards. A meter that retreats collides with the rule that Sorrel never makes anyone feel bad about spending.

The resolution is that the rule is about **tone, not arithmetic**. Show the true figure. Never editorialise the direction.

- Say *"$1,240 to go"* — not *"you lost ground this month"*, not *"−$310 since last month"*
- No red on the meter, ever. The red rule holds: red never describes the user's money.
- No "behind schedule" badge, no comparison to a pace the user never agreed to

A user whose card balance went up already knows. Sorrel's job is to show the number, not to comment on it.

## Why retirement is measured by value, including growth

A retirement goal's target is a number you need to **have**, not a number you need to **deposit**. $500,000 by 65 is a balance. Measuring contributions would leave the meter permanently understating a portfolio that's doing its job.

This does mean the meter moves with the market. That's correct — it's what the goal is actually tracking — and the same tone rules apply.

> The asymmetry between the two is deliberate and worth writing in the code comment: **for debt, the balance is the goal; for investments, the balance is the goal.** Both are balances. The only difference is which direction counts as progress.

## The invariant that keeps this safe

**A linked goal derives its progress at read time. It never writes contribution rows.**

Materialising derived progress would create phantom transactions — rows that look like something the user did, that nothing in the ledger backs, and that would then be counted a second time by anything summing contributions. It's the same shape as the rule that a page render never writes.

So: while a goal is linked, the contributions table gets nothing from it.

## Linking, and unlinking

**Linking is optional and per goal.** A debt payoff goal without a linked card keeps working exactly as it does today.

**Target on link.** For debt payoff, the card's balance at the moment of linking becomes the goal's starting balance. Record it; don't recompute it later, or the meter resets every time someone looks at it.

**Manual contributions and linking are mutually exclusive.** A goal is either derived or manual, never both — a half-derived meter is uninterpretable. If a goal already has manual contributions, linking an account must say plainly what will happen before it happens.

**Unlinking returns the goal to manual** and preserves the number: write the derived progress at that moment as a single contribution, labelled as carried over. Losing someone's progress because they changed their mind about a link is not acceptable.

**Which accounts can be offered.** Debt payoff: liability accounts only. Retirement: investment accounts only. Don't present a list the user has to reason about — if no eligible account exists, say so and say what kind would qualify.

**Completion.** Debt payoff completes when the balance reaches zero. Clamp at 100% — an overpaid card must not show 103%.

---

# 4 — Edit and delete goals

The same gap you closed for contributions, one level up. A user who mistypes a target has a permanently wrong goal.

**Edit:** name, target amount, target date, type, and the linked account.

**Changing the type clears the link.** A debt payoff goal switched to savings has no business still pointing at a credit card.

**Delete** removes the goal and its contributions. The confirmation says how many contributions go with it — "Delete this goal and its 7 contributions?" — because that's the part people don't expect. Same confirm pattern as transactions, and only the confirm button is red.

**"Saved toward your goals" on the dashboard must recompute**, not go stale. Same requirement as contribution deletion.

---

## Order

1. **Transfers in the forecast.** Money math on the hero number — highest value and highest risk, and it's arguably a defect rather than a feature: anyone who pays a card by scheduled transfer is seeing a wrong Safe to Spend today.
2. **Edit and delete goals.** Needed before linking, since linking is an edit.
3. **Linked goals**, both types together — one mechanism, so build it once.

One branch each.

A note on timing: the beta is running. Changing the product while you're measuring it costs you the ability to tell which version a tester hit. Item 1 is a correctness fix and belongs in now. Items 2–4 are features — worth deciding deliberately whether they go out mid-beta or wait for the end of it, rather than defaulting into shipping them because they're ready.

---

## The prompt

```
Four changes. Read docs/Transfers-and-Linked-Goals.md in full first.

PHASE 1 — REPORT ONLY. Build nothing. My spec is written against a model I
haven't verified; tell me where it doesn't match rather than forcing it.

 1. How do CREDIT CARD PAYMENTS reach the Safe to Spend projection today?
    v_upcoming_recurring carries card_balance_owed, and there's a commit
    "Price card payments per statement cycle". If card payments already
    enter the forecast by some path, adding transfers-as-expenses would
    DOUBLE COUNT the most common crossing transfer there is. Quote the code.

 2. Are scheduled TRANSFERS in the projection at all right now — ignored,
    partially counted, or counted wrongly? Quote projectSafeToSpend's
    handling.

 3. Where is the spendable-set classifier, and what are its callers?
    SPENDABLE_ACCOUNT_TYPES, spendable_cash_balance(), leaves_spendable_set().
    I want ONE rule applied here, not a new comparison.

 4. The goals model: what defines a goal, how is progress computed, and
    where does "Saved toward your goals" read from? Are goal types an enum?
    What values?

 5. Account types: what identifies a liability account and an investment
    account? Exact values.

 6. Does anything already link a goal to an account?

Report all six, then stop.

PHASE 2 — after I rule on the report:

TRANSFERS: classify by whether money crosses the spendable-set boundary.
  spendable -> spendable        : IGNORE (nothing changes)
  spendable -> not spendable    : upcoming EXPENSE
  not spendable -> spendable    : upcoming INCOME
  not spendable -> not spendable: IGNORE
Checking -> savings must not appear in the forecast at all.

AND IT INHERITS THAT SIDE'S UNCERTAINTY RULE, not a transfer rule:
  acting as an obligation -> early date, high amount, stays counted overdue
  acting as income        -> late date, drops out past its late edge while
                             staying in the confirmation queue
Use the EXISTING classifier. A new IN ('checking','savings','cash') anywhere
in the diff is a bug.

Only UPCOMING transfers. Past ones already moved the balances.

LINKED GOALS — optional, per goal:
  debt payoff  -> liability account.  progress = starting balance - current
  retirement   -> investment account. progress = current value
Both read the account's balance. Record the starting balance AT LINK TIME
for debt; never recompute it.

  - DERIVED AT READ TIME. A linked goal NEVER writes contribution rows.
    Materialising it creates phantom transactions that get counted twice.
  - Derived or manual, never both. Linking a goal that has manual
    contributions must state what happens before it happens.
  - Unlinking returns the goal to manual and writes the derived progress as
    one contribution, labelled as carried over. Do not lose the number.
  - Clamp at 100%.
  - Only eligible account types in the picker. If none exist, say which kind
    would qualify.

TONE on a meter that can go backwards: show the true figure, never comment
on the direction. "$1,240 to go", never "behind" or "lost ground". NO RED on
the meter — red never describes the user's money.

EDIT AND DELETE GOALS: name, target amount, target date, type, linked
account. Changing the type CLEARS the link. Delete removes the goal and its
contributions, and the confirmation names the count. "Saved toward your
goals" recomputes.

VERIFY:
  - A checking->savings scheduled transfer leaves the hero number unchanged.
  - A checking->credit-card scheduled transfer lowers it by exactly the
    amount, ONCE. Prove it isn't also counted via card_balance_owed.
  - A brokerage->checking scheduled transfer raises it, and drops out past
    its late edge while staying in the confirmation queue.
  - A linked debt goal's meter moves when the card balance moves, and the
    contributions table gains NO rows.
  - Paying a card below zero shows 100%, not more.
  - Unlink, and the progress number survives.
  - Delete a goal with contributions: gone, and the dashboard total is right.
```
