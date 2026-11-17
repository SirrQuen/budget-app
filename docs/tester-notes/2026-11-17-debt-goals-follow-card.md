Sent:      not yet
Migration: 70
Merge:     not merged (feat/debt-goals)
Deployed:  not yet

---

**Draft. Not before-deploy: no processor, bank connection or deletion
change. It can move safe to spend, but only for someone who links a debt
goal that has a monthly amount (below), so it goes in the next What's new
card with the other goal features. Matt sends it; never Claude.**

A debt payoff goal can now follow a credit card or loan. On the goal,
choose **Follow a card** and pick the card. From then on the goal measures
itself by what the card owes in Sorrel:

- **"To go" is the card's balance.** A payment brings it down; a new charge
  or interest you log brings it up. You don't log payments on the goal any
  more.
- **The meter runs from what the card owed when you linked it**, so it
  starts at 0% and fills as the balance falls.
- **When the card reaches zero, the goal is paid off**, and stays paid off:
  using the card again later doesn't undo it. Only changing or deleting the
  payments that got it to zero can.
- **Interest is only in Sorrel when it's in Sorrel**: logged, imported with
  a statement, or the card's balance updated.
- Payments you'd already logged on the goal stay in its history. **Stop
  following** puts the goal back to manual and keeps its number.

If your debt goal had a monthly amount, Sorrel was setting that aside from
safe to spend. Once the goal follows the card it doesn't: your card
payments already come out of safe to spend, so setting money aside as well
would count them twice. Your safe to spend may go up by that monthly
amount when you link it.
