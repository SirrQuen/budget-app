Sent:      not yet
Migration: 82
Merge:     not yet
Deployed:  not yet

---

**Draft. DEPLOY-DAY, announced by the dashboard's What's new card (the
"goal-schedules" line, lib/whatsNew.ts; ruled 2026-11-28), not before
deploy. Safe to spend moves for anyone with a goal that
has a monthly target and a recurring transfer feeding it (on sorrel-dev,
1 goal: its hold went from $0 to $7.78; production's count comes from
docs/goal-hold-netting-check.sql, read-only, run before the push). No
processor, bank connection or deletion change; no cookie or on-device key.
Named by its draft date until it's sent; rename to the date it goes out
(README). Matt sends it; never Claude.**

A goal can now be fed by more than one recurring transfer, and by any
one-time transaction you choose.

Each transfer you confirm now counts toward its goal straight away. Your
goal page lists the transfers that fund each goal, with "Still to come
this month" beside them, and you can unlink one there. If a transfer you
confirmed earlier isn't counted yet, the goal offers to count it. Nothing
is counted until you tap.

Safe to spend now sets aside exactly what your transfers don't cover. Say
Emergency fund has a $400 monthly target and $50 goes to savings every
Friday: four Fridays cover $200 of it, so safe to spend sets aside the
other $200. Before, a goal with a transfer set aside nothing, so your safe
to spend may be a little lower than yesterday. It's the same money, now
planned for once.

If you confirmed one of those transfers earlier this month, open the goal
and tap Count them. Safe to spend then knows that money is already set
aside.
