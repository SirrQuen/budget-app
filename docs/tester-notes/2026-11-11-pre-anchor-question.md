Sent:      not yet (planned 2026-11-11 -- not the 10th, which has goal money)
Migration: 62
Merge:     not yet
Deployed:  not yet

# A new question when you log something dated before your balance

Today's update: when you log a transaction dated before the day you set
an account's balance, Sorrel now asks you one thing:

> This is dated before your balance of $1,240 on 3 November.
> Was it already included in that balance?
>
> Yes, it's already counted · No, add it to my balance

Why it asks: your bank shows what has posted, not everything that's
happened. A card charge can sit pending for a day or two, then post
backdated to the day you made it. If you set your balance while it was
pending, that charge wasn't in the figure. Logged on its posted date,
Sorrel used to leave it out of your balance with nothing on screen to
say so.

What each answer does:

- **Yes, it's already counted.** Nothing changes. The transaction is
  kept for your history, and your balance stays as it is. This is the
  right answer when you're filling in past spending for the record.
- **No, add it to my balance.** It counts toward the balance despite its
  date, so the balance moves by exactly that amount, once.

Sorrel can't tell these two apart on its own, so there's no default: you
choose each time. It only asks when the date is before your balance
date, which shouldn't happen often. Open the transaction later and it
shows which answer you gave. If you set a new balance afterwards, the
new figure replaces those earlier answers.

Your numbers don't move on their own. Nothing you've already logged
changes, and a balance only moves when you answer "No". Editing a
description or a note never asks. Changing an older transaction's date,
amount or account does.

You'll also see it when you confirm a recurring item dated before your
balance date. "It landed" opens the sheet so you can answer, and
"Confirm all" tells you how many it left for you.

Does the question make sense the first time you see it? I'd like to
hear if you weren't sure which answer was yours.
