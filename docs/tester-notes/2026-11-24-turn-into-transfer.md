Sent:      not yet
Migration: 80, 81
Merge:     9ac8506 (fast-forward of turn-into-transfer, squashed; no merge commit)
Deployed:  2026-11-24 (80 and 81 on production first, checked read-only)

---

**Draft. Not before-deploy: no processor, bank connection or deletion
change (ruled 2026-11-24 -- separating and undoing are a person's own
actions on their own entries; docs/phase-7-findings.md). It moves
numbers, but only when a tester uses it. Named by its draft date
(2026-11-24) until it's sent; rename to the date it goes out (README),
and keep it off a day another number-moving note goes out. Matt sends
it; never Claude.**

You can now turn an entry into a transfer.

If you logged a move to savings or a card payment as spending -- or
imported it that way before import learned about transfers -- open it
and choose **Turn into a transfer**. Pick the other account. If that
account already has the matching entry (the other side of the same
move, within a few days), Sorrel asks whether they're the same
transfer, and a Yes joins them. Otherwise the other side is added for
you, and if it's dated before that account's balance date you're asked
about that balance first. If it looks like a scheduled transfer still
waiting in your confirmation list -- your monthly card payment, say --
you're asked whether it's the same one, so it isn't counted twice.

**Why a number may move.** A transfer isn't spending, so it comes out of
its category and your spending totals. Money moved to savings now shows
in savings too. A card payment now lowers what the card owes, so it
isn't counted again as a bill still to pay -- your Safe to Spend can go
up by that amount. Joining two entries you already had doesn't change
either balance.

**Changed your mind?** The transfer says where it came from, with an
**Undo** that puts everything back, keeping any edits you made since.
Deleting it asks first, names both entries, and offers **Separate them
instead**. The same choice now appears when you delete a transfer an
import joined to an entry you already had: both entries stay, yours
goes back to its category, and you pick a category for the one from
your file.
