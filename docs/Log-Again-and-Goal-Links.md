# Log it again, debt goals that follow the card, and linking transactions to goals

**Three features. The first makes logging faster. The other two are about goals, and both have a way to count the same money twice that the design has to close.**

---

# 1 — Log it again

## Why

No file beats logging in the moment. Banks hold card charges as pending for a day or three before they appear in any download. Most of what people log is repetitive: the same coffee, the same gas station, the same weekly transfer. Repeating one should take seconds.

## What it is

**"Log again"** on any past transaction opens the add form **pre-filled**:

| Copied | Not copied |
|---|---|
| Account, type, category, description, amount | Notes, which are specific to that occurrence |
| For a transfer: from, to, amount, description | Import batch, schedule link, pre-anchor answer |
| The goal link (section 3), **visible and removable** | The original date |

- **The date is today**, in the user's timezone, and editable.
- **The amount is selected,** so typing replaces it. The same amount takes two taps (Log again, then Save). A different amount means typing it, then Save.
- **It never saves in one tap.** Amounts vary (gas, groceries), and a one-tap save produces wrong amounts and accidental duplicates. Undo isn't a substitute for a form. Earlier I said "one tap", and this is the correction.
- It goes through the **same write path** as any new transaction. The same-bill question, future-dated ghosting and every other rule apply unchanged.

## Where

- The transaction row menu, and the transaction detail screen.
- **A "Recent" strip in quick add.** It shows the five most recent **distinct** combinations of description, account and category from the last 60 days. Tapping one fills the form the same way Log again does.
  - Derived on read, with no new table.
  - Hidden when there's nothing to show.
  - It can't break the quick-add allowlist, because it lives inside quick add.

## Doesn't change

No balance or Safe to Spend logic. It only fills in a form.

---

# 2 — Debt payoff goals that follow the card's balance

## The request, and why it can't be done literally

The ask: let a debt payoff goal's **target** follow the credit card's current balance, so interest doesn't mean re-editing the target.

Doing that literally counts every payment twice. Take a card owing $2,000, with the goal's target linked to it and payments counted as contributions:

| | Card owes | Target (linked) | Payments counted | Meter |
|---|---|---|---|---|
| Start | $2,000 | $2,000 | $0 | 0% |
| Pay $500 | $1,500 | $1,500 | $500 | **33%**, should be 25% |
| Pay $1,000 more | $500 | $500 | $1,500 | **300%** |

The payment lowers the target **and** raises progress. **The card balance already says how much is left, so the card balance has to be the whole measure, not just the target.**

## The design: the goal follows the card

This is the linked debt goal from `Transfers-and-Linked-Goals.md`, held since then. This request is the reason to build it, debt payoff only. Retirement stays held.

- A debt payoff goal can be set to **follow a credit card**. The picker shows liability accounts only. If there are none, it says: *"Add a credit card on the Accounts screen to link it."*
- **"To go" is the card's current balance**, read from `v_account_balances` at render. Interest, new charges and payments are all reflected automatically, with no target to edit.
- **The meter** measures from the balance **recorded at the moment of linking**: (starting − current) ÷ starting, clamped between 0% and 100%. The starting balance is recorded once and never recomputed, or the meter would reset whenever someone looked.
- **The goal says where its number comes from:** *"Follows Visa's balance in Sorrel."*
- **Completion** is when the card balance reaches zero or below. That's 100%, never 103%.

## Interest is only in Sorrel if it's in Sorrel

Sorrel's card balance is the balance the user set plus what's been logged. **Interest appears when the interest charge is logged, imported, or the card's balance is updated.** Import is the easy route here: interest lines come in with the rest of the file. Say this plainly in the link dialog, so nobody expects Sorrel to know about interest by itself.

## Rules carried from the original spec

- **Derived at read time. A linked goal never writes contribution rows.** Materialising them creates phantom transactions that get counted again.
- **Derived or manual, never both.** Linking a goal that has manual contributions says what happens first: *"Your 4 payments ($900) stay in its history. From now on the goal follows Visa's balance."*
- **Unlinking returns the goal to manual and keeps the number.** The derived progress at that moment is written as one contribution labelled *carried over*.
- **Tone:** show the true figure and never comment on its direction. *"$1,240 to go"*, never "behind" or "lost ground". **No red on the meter.**
- Changing the goal's type clears the link.

## A completion question for Phase 1

A linked goal completes when the card hits zero, and that's discovered **on read**. If completion is recorded as a write (a completed flag, a completion date, the bloom being shown), recording it during a page render breaks the render-write rule. Phase 1 reports how completion is recorded today and proposes how a derived goal completes without a render write.

---

# 3 — "Is this for a goal?" on one-time transactions

## Push back on the question, keep the link

Asking *"Is this for a goal?"* on every transaction would slow down the thing items 1 and import exist to speed up, and it would teach people to dismiss it. Most transactions aren't for a goal. So:

- **An optional "Goal" field** on the add and edit forms, including quick add and Log again. One collapsed row, *Goal: none*. **Never required.**
- **It's shown only when the user has at least one active manual goal.**
- **It's asked inline only where a goal is likely:** a transfer from a spendable account to a non-spendable one, like checking to savings. There the field opens itself as *"Is this for a goal?"*, still optional, still defaulting to none.

## What can be linked

| Type | Linkable | Why |
|---|---|---|
| **Transfer** | Yes | Money moved toward a goal, which is the clearest case. One transfer is one contribution, never one per leg. |
| **Expense** | Yes | A payment on a debt Sorrel doesn't track as an account. |
| **Income** | **No, in v1** | Income lands in spendable cash. Counting it as saved while it's still spendable counts the same dollars twice: spendable and saved. Move it to savings, then link the transfer. |

- **Goals that follow a card (section 2) aren't offered.** Payments already count through the card's balance. Next to the field, say: *"Visa Payoff follows the card's balance, so payments count automatically."*
- **Import doesn't set goals** in v1.

## One money record, never two

- **The transaction is the contribution.** The amount is read from the transaction, never copied. Edit the amount and the goal follows. Delete the transaction and the contribution goes too, with the delete confirmation naming the goal.
- **A transaction counts toward at most one goal.**
- **A hand-entered contribution may already cover the same money.** Someone who added $200 on the goal page on Tuesday, then links Wednesday's $200 transfer, has counted it twice. When linking, if the goal has a hand-entered contribution of the same amount within 3 days, ask: *"Is this the same money as your $200 contribution on Nov 12?"* **Yes** replaces the hand entry with the link, and **No** keeps both. Never merge silently.

## Safe to Spend: this may *fix* a double count

If goals hold back their remaining monthly amount from Safe to Spend (`goal-monthly-holds-test.sql`), then today a $200 transfer to savings lowers the spendable balance by $200 **while the hold stays at $200**, because nothing knows the transfer was the goal's money. That money gets subtracted twice.

Linked, the hold drops by the $200 as the balance does, and Safe to Spend is unchanged. That's correct, because the money was already set aside. **This is my reading of the holds model, not a verified fact.** Phase 1 confirms it before anything is built.

---

## Order

1. **Log it again.** Small, changes no number, and it speeds up logging today.
2. **Goals: Phase 1 for sections 2 and 3 together.** They share a model and a rule (a followed card is excluded from goal links).
3. **Debt goals that follow the card.** Migration 52's design, renumbered to the next free number.
4. **Transaction goal links.** Last, because it can move Safe to Spend. If it does, it needs a tester note.

The import build carries on first. Its tester email still goes out before it deploys.

---

## The prompt

```
Three features. Read docs/Log-Again-and-Goal-Links.md in full first, and
docs/Transfers-and-Linked-Goals.md (linked goals section). Add all three
to docs/queue.md in the doc's order, after import.

Finish the import work in progress first.

ITEM 1 — LOG IT AGAIN. Its own branch off main. Build directly; no
Phase 1 needed.
  - "Log again" on the transaction row menu and detail screen: opens the
    add form PRE-FILLED — account, type, category, description, amount
    (transfers: from, to, amount, description), and any goal link,
    visible and removable. NOT copied: notes, import_id, schedule link,
    pre-anchor answer, date.
  - Date = today in the user's timezone, editable.
  - Amount field selected so typing replaces it.
  - NEVER saves in one tap. Save is always a second, deliberate tap.
  - Same write path as any new transaction; all rules apply.
  - "Recent" strip in quick add: five most recent DISTINCT (description,
    account, category) from the last 60 days. Tap fills the form like
    Log again. Derived on read, no new table, hidden when empty.
  VERIFY: Log again on an expense, an income and a transfer each produce
  a correct new row dated today and leave the original untouched; a
  transfer logged again produces a correct pair; nothing saves without
  Save; tsc, eslint, tests.
  Report, then stop. Don't merge.

ITEMS 2 + 3 — GOALS. PHASE 1, REPORT ONLY. Build nothing.
 1. Migration 52 (linked goals): does it exist anywhere — a file, a
    branch? What's the next free migration number?
 2. How are goal contributions stored, and how is progress computed?
 3. Do goal holds reduce Safe to Spend? Quote the code. Specifically:
    today, does a $200 transfer to savings for a goal lower Safe to Spend
    twice (balance AND an unchanged hold)? Show the arithmetic.
 4. Can transactions or schedules link to goals at all today?
 5. How is goal completion recorded — a flag, a date, a cookie? How does
    the bloom know to play? Propose how a DERIVED goal completes without
    a page render writing anything.
 6. What identifies a liability (credit card) account, exactly?
 7. Read-only against PRODUCTION by ref with the Target line: how many
    debt payoff goals exist, and how many have manual contributions?
    Counts only.
Report all seven, then stop.

PHASE 2 for goals waits for my ruling.
```
