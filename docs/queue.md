# Queue

The one written order of work. It holds pointers only: each item's detail
lives in its findings entry (docs/phase-7-findings.md) or spec. "Do this
next" means editing this file. Launch blockers live in the findings'
authoritative list, not here.

Last updated 2026-11-10.

## Next

1. **Safe to spend says why it's the number it is.** Spec:
   docs/Safe-to-Spend-Why.md. Findings: "Safe to spend doesn't say why
   it's the number it is" (2026-11-10). Moved ahead of everything else
   2026-11-10. It's copy only: no migration and no number moves, so no
   tester note.

## Launch blockers still open

See docs/phase-7-findings.md, "Launch blockers". As of 2026-11-10, 3
(WCAG; its repo-state notes say fixed, but it isn't struck through), 5
(custom SMTP) and 8 (verify the error-handling pass in a production build)
aren't struck through.

## Held

| Item | Since | Held until | Where |
|---|---|---|---|
| `feat/linked-goals`: migration 52, a goal's progress read from a linked account | 2026-10-26 | After the beta. It must be re-derived on top of 53, 57 and everything since, not just given a new timestamp. | Findings, "Held branches that touch goals"; the branch's own commits |

## Deferred

| Item | Recorded | Decide or do when | Where |
|---|---|---|---|
| Budget progress counts future-dated transactions, but the balance doesn't (budget vs balance) | 2026-11-10 | Before commercial launch | Findings, same title |
| After-save "doesn't change your figure" note on the edit paths | 2026-11-10 | After the create-path note ships | docs/Safe-to-Spend-Why.md, "What it costs" |
| Amount window with a lead time (1c): optional update of a variable amount before it's due, in the queue | not dated in the repo | Unscheduled | docs/Recurring-Amounts-and-Transfer-Editing.md, 1c. **No findings entry yet**: needs one with the dates it was raised |
| A statement date has no tolerance: the "enter the amount" window opens on `statement_day` wherever the statement actually posted | 2026-10-31 | When a tester hits it | Findings, "Recurring dates: what each one means" |
| Goal money columns are bare `numeric` | 2026-11-03 | After 52 is decided (it touches the views 52 replaces) | Findings, same title |
| In-app "what changed" surface | 2026-11-03 | At commercial launch | Findings, "Commercial launch, not beta" |
| Forms require JavaScript | 2026-10-27 | After the beta | Findings, "Known limitation: forms require JavaScript" |
| `record_login()` writes on render, and the streak rebuilt as days opened: one job | 2026-10-10 | After the launch blockers | Findings, "`record_login()` writes on every page load" and "Streak: redefined as days opened" |

## Done, still named in conversation

Listed so they aren't queued again.

- **Squeeze points ("What's ahead").** Shipped 2026-10-01 (`8b67f1f`,
  `feat/whats-ahead` merged). The part still missing, tying the low point
  to the figure, is "Next" item 1.
- **The February `statementDateForCycle` bug.** Fixed 2026-10-31 (merge
  `8860140`). It wasn't February-only: any due day of 28 or later broke in
  short months. Findings, "Recurring dates", "Short months walked back to
  the wrong statement". The statement-date item still deferred above is a
  different gap.
