Sent:      not yet (planned 2026-11-13 -- the 11th and 12th have notes;
           send BEFORE the deploy, not after)
Migration: 65
Merge:     (fill in on merge)
Deployed:  not yet

Before sending: re-run docs/future-dated-audit-by-user.sql against
production the day before. On 2026-11-10 one tester had 12 rows (9 items,
2026-11-11 to 2026-12-02); others may have added some since. The note
below is written for everyone either way -- anyone can have logged
something dated ahead.

# A transaction dated ahead counts on its date

Today's update: when you log something with a date after today -- rent
for the 28th, say -- your account balance now counts it on the 28th, not
the day you enter it. Until now it moved your balance straight away,
though the money hadn't moved yet.

**If you've already logged anything dated ahead, your balance changes
today.** Each of those transactions steps out of the balance and comes
back in on its own date, with nothing for you to do. Nothing is deleted
or changed; they're all still in your list, shown faded with their date
beside them. On the day, each one fills in and counts.

Safe to Spend may shift a little too, because it now counts each of them
on its date rather than today. Something dated beyond the forecast's
reach joins it when the forecast gets there.

What you'll see from now on:

- **In your transactions**, anything dated ahead is shown faded, with a
  dashed edge and its date: "28 Nov". On that day it fills in and counts
  toward the balance. There's nothing to confirm, because you entered it
  yourself. If it doesn't happen, edit or delete it like any other
  transaction.
- **In Safe to Spend**, nothing waits. A charge on checking or cash
  dated ahead counts against Safe to Spend from the moment you enter it,
  on its date, the same way a recurring bill does. It's listed under
  Upcoming with "(as entered)" beside it. Anything dated ahead on
  savings or a card stays out of Safe to Spend, as it always has.

Budgets haven't changed: a transaction dated ahead counts toward its
budget from the day you enter it, so rent for the 28th shows as spent
this month already. That's a known difference we'll settle later.

Does the faded row read clearly as "not yet"? Tell me if anything looked
like it had gone wrong.
