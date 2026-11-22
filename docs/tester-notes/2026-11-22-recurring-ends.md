Sent:      not yet
Migration: 79
Merge:     1a3bffb (fast-forward of recurring-ends; no merge commit)
Deployed:  2026-11-22

---

**Draft. Not before-deploy: no processor, bank connection or deletion
change, and no cookie or on-device key is added. Named by its merge
date (2026-11-22) until it's sent; rename to the date it goes out
(README). One number can move:
a schedule set to end "On" a date whose last occurrence before that date
isn't answered yet now stays in Safe to Spend and the confirmation list
until it's answered -- before, it dropped out the day after the end
date. Production had 0 schedules in that state on 2026-11-22
(read-only), so no one's figure moves at deploy. One schedule moves to
the new Ended section. Matt sends it; never Claude.**

Two fixes to recurring schedules.

**Ended schedules have their own place.** When a schedule reaches its end
-- the last of "After 3 times", or its end date -- it now moves to an
Ended section at the bottom of Recurring, with no next date, and nothing
counts it. Before, it could sit in your list showing next month's date
even though it was done. Want it back? Edit it and add more times or a
later end date, and it picks up again.

If a schedule's last bill before its end date hasn't been confirmed yet,
it stays in your list to confirm, and in Safe to Spend, until you answer
it.

**Earlier or later on weekends now saves.** In a schedule's timing, "move
to the nearest business day, earlier" or "later" wasn't saving. It does
now, and a bill or paycheck that falls on a weekend moves the way you
chose.
