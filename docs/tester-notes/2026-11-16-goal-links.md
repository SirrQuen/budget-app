Sent:      not yet
Migration: 69
Merge:     8570469 (feat/transaction-goal-links; merged locally 2026-11-16, not yet pushed)
Deployed:  not yet

---

**Draft. Not before-deploy: no processor, bank connection or deletion
change, so the privacy policy is untouched. It goes in the next What's new
card (a new dated cookie), beside Log again and debt goals that follow a
card. Matt sends it; never Claude. It moves safe to spend, so it says so.**

# A transaction can now be for a goal

When you move money toward a goal, you can now say so. Adding a
transaction or a transfer, there's a **Goal** line under the accounts.
Pick the goal and that transaction counts toward it. You don't need to
add the same money on the Goals page as well.

A transfer from checking to savings opens the line for you and asks
"Is this for a goal?". It's always optional. Income can't be for a goal:
move it into savings first, then pick the goal on that transfer.

**This can change your safe to spend.** If a goal has a monthly target,
safe to spend sets aside what's still to go into it this month. Until
now, a transfer to savings lowered your balance, but the goal didn't know
about it, so the same money came off twice. Picked for the goal, the
transfer counts toward it, and the money comes off once.

Say safe to spend is $2,500, with $200 set aside for a goal. You move
$200 to savings:

- Picked for the goal, it stays $2,500. The money was already set aside.
- Not picked for a goal, it shows $2,300, as it does today.

A transfer dated later this month counts for this month straight away.
One dated next month counts for next month.

If you've already added that money on the Goals page, Sorrel asks "Is
this the same money?". Say yes and it's counted once, as the transaction.
Say no and both count.

Change the amount and the goal follows. Delete the transaction and it
comes off the goal too, and the delete confirmation says so.
