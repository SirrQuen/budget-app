# Income and Spending: tap a tile to see what's in it

**The dashboard's Income and Spending tiles become links. Tapping one opens Transactions filtered to exactly the rows that make up that number, for the same period. A short summary sits at the top: the same total as the tile, the number of transactions, and a "Where it went" (or "Where it came from") list by category. The list always adds up to the tile. That's the whole point.**

Display only. No migration, no new write path, no new dependency, no new cookie or localStorage key.

---

## Rules

1. **One definition, used twice.** The tile's figure and the drill-down list come from the **same** scope function, so they can't drift apart. It goes in `lib/transactionFilters.ts` next to the budget drill-down scope, as something like `flowScope(kind: 'income' | 'spending', period)`. The tile sums what the scope returns; the list shows it. If the tile is currently computed somewhere else (a SQL view, an RPC, a separate TS sum), report it and move it onto the shared scope. If the tile is a SQL view, write a TS twin and a parity test, like `lib/recurringEnds.ts`.
2. **The drill-down never changes the tile's number.** Moving the tile onto the shared scope must give the same figure it shows today for every user. If the report-first step finds the tile is **wrong** (for example, it counts transfer legs), **STOP and tell me** before changing anything. A dashboard figure that moves is a separate decision with its own tester note.
3. **The total at the top equals the tile, to the cent,** for the same user, period and timezone. A test proves it (see Verify).
4. **Same period as the tile.** If the tile shows "this month" in the user's stored timezone, the drill-down uses that month in that timezone. The period label is shown, e.g. "November". The period follows the URL, so a link opened on 1 December still shows November.
5. **Red never describes money.** Income uses the income colour. Spending uses the normal text colour, as the tile does. No red, no warning tone, no comparison to last month in this branch.
6. **Never discourage.** No "You spent too much" copy. The empty state is friendly (see Copy).

## What's in each scope

Report what the tile does today for each case below. Then the shared scope does **exactly that**, unless rule 2's STOP applies.

| Case | Expected (confirm against the tile) |
|---|---|
| Transfer legs, including ones made with "Turn into a transfer" and import-joined transfers | Excluded from both |
| Transactions in the transfer category type | Excluded from both |
| Goal-linked expenses (money set aside for a goal) | Whatever the tile does. Report it and quote the line. |
| Refunds and credits on an expense category | Whatever the tile does (net, or counted as income). Report it. |
| Rows on archived accounts | Whatever the tile does. Report it. |
| Recurring occurrences not yet confirmed | Excluded. Only real transactions count. |
| Imported rows | Included like any other row once confirmed |
| A row at 23:30 on the last day of the month, local time | In that month, using the stored timezone and not UTC |

## How it looks

- **The tiles:** the whole tile is the link. Use the same "obviously clickable" style already used for All goals, All budgets and the Transactions link: the chevron or arrow, the hover state and the focus ring. Accessible name: "Spending in November, $1,234.56. See the transactions." Minimum tap target 44px.
- **Where it goes:** `/transactions` with the filter in the URL, e.g. `/transactions?flow=spending&period=2026-11`. For the dashboard's other ranges it is `period=from..to` (ruled 2026-11-25). Use the same mechanism the budget drill-down uses. Don't invent a second filter system. Back returns to the dashboard.
- **A filter chip** at the top of Transactions: "Spending · November ×". Removing it shows all transactions, as usual.
- **The summary card** above the list:
  - The headline is "Spending in November" and the total, which matches the tile.
  - The second line is "42 transactions".
  - **Where it went:** each category with its total, largest first. Show the top 5 on a phone and the top 8 on desktop; the rest go into "Other categories" with their combined total. Each category row narrows this drill-down to that category: same flow, same period, plus the category filter with its own removable chip, and the list adds up to the row. (Ruled 2026-11-25, replacing a link to the budget drill-down, which counts the whole month.) The category totals add up to the headline.
  - For Income the heading is **Where it came from**, with the same layout.
- **The list** below the summary is the normal Transactions list with the filter applied: same rows, same edit and delete actions. If a row is edited or deleted, the summary and the tile both update on the next render, as everything else does.
- **Search and other filters** still work on top. When another filter narrows the list, the summary says so: "Showing 12 of 42 · $310.00 of $1,234.56". It never presents a partial total as the tile's figure.

## Copy

- Spending, empty: "Nothing spent yet in November." Below it, a link: "Log a transaction".
- Income, empty: "No income logged yet in November." Below it, a link: "Log income".
- What's new (`lib/whatsNew.ts`): "Tap Income or Spending on your dashboard to see exactly what's in it."

## Also

- **Report first:**
  - where each tile's number is computed (file and function or view) and the period it uses;
  - every row of the scope table above, with the line of code that decides it;
  - how the budget drill-down passes its filter to Transactions.
- **Storage:** none expected. If you add a cookie or localStorage key, STOP.
- **Tester note:** Sent: not yet, not before-deploy. This doesn't change any number.

---

## The prompt (Sonnet)

```
Read docs/Income-Spending-Drilldown.md in full. New branch off main.
Display only: if anything needs a migration, write path, dependency,
cookie or localStorage key, STOP and tell me.

REPORT FIRST, then build:
  - Where the Income and Spending tile figures are computed (file +
    function/view), and the period and timezone they use.
  - Every row of the doc's scope table, as the tile does it TODAY,
    with the line of code that decides it.
  - How the budget drill-down passes its filter to Transactions
    (lib/transactionFilters.ts).
  - If the tile looks WRONG on any row (e.g. it counts transfer legs),
    STOP here and tell me. Don't change a dashboard number.

BUILD per the doc:
  - One shared scope in lib/transactionFilters.ts (flow: income |
    spending, period). The tile sums it; the drill-down lists it. The
    tile's number must not change for anyone.
  - Tiles become links in the existing "obviously clickable" style,
    accessible name with the period and amount, 44px tap target.
  - /transactions?flow=...&period=YYYY-MM via the same mechanism the
    budget drill-down uses; removable chip; Back returns to dashboard.
  - Summary card: total (equals tile), count, Where it went / Where it
    came from by category (top 5 phone / 8 desktop + Other), each
    category linking to the budget drill-down for that period.
  - Other filters on top show "Showing X of Y · $a of $b".
  - Copy, empty states and the whatsNew line from the doc. Income in
    the income colour; spending in normal text. No red.

VERIFY:
  - Parity test: for fixture users, tile total == drill-down total ==
    sum of category rows, to the cent. Fixtures include a transfer
    leg, a "Turn into a transfer" pair, an import-joined transfer, a
    goal-linked expense, a refund, an archived-account row, an
    unconfirmed recurring occurrence, an imported row, and a row at
    23:30 local on the last day of the month in America/New_York and
    in Pacific/Auckland.
  - Tile figures before vs after this branch are identical for every
    fixture user (snapshot them first).
  - Browser on dev (I'll sign you in; if screenshots time out, tell me
    and I'll check): tap each tile at 1440 and 390px, both themes;
    totals match; chip removes; Back works; empty month shows the
    friendly state; keyboard focus ring on the tiles.
  tsc, eslint, full npm test. Tester note (Sent: not yet, not
  before-deploy). Report, then stop. Don't merge.
```
