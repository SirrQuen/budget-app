Sent:      not yet
Migration: none
Merge:     d8e6e7f (fast-forward of import-transfer-answer; no merge commit)
Deployed:  2026-11-24 (reached origin/main in the 10:04 push, with d191b12)

---

**Draft. Not before-deploy: no processor, bank connection or deletion
change, and no cookie or on-device key is added. No number moves by
itself -- a row is asked about, and the person decides. Named by its
draft date (2026-11-24) until it's sent; rename to the date it goes out
(README). Matt sends it; never Claude.**

Import now asks about rows that look like transfers.

When you import a file, a row that reads like money moving between your
own accounts -- a transfer to savings, a card payment, an autopay --
used to carry a quiet "Looks like a transfer" note and come in as
spending unless you changed it. Now Sorrel asks. Each of those rows
shows two choices: **Transfer to…** or **Keep as spending** (Transfer
from… or Keep as income, for money coming in). Nothing is picked for
you, and Import waits until each one has an answer.

Choose Transfer to… and pick the other account, and both sides are
recorded: your checking goes down and your savings goes up, or what
your card owes goes down. If you keep a row as spending, the line above
the Import button says how many look like transfers but will come in as
spending, so nothing slips through.

Sorrel also recognises more of the ways banks word a card payment
(MOBILE PMT, CRD EPAY, E-PAYMENT and the like). Zelle, Venmo and Cash App
payments aren't flagged by their wording, since they usually go to other
people. And each row's type control now has a "Type" label, so it's
easier to find.
