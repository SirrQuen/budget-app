Sent:      not yet
Migration: 76
Merge:     not yet
Deployed:  not yet

---

**Draft. Matt sends it; never Claude. Rename this file to the date it goes
out. No privacy-policy email is owed (the wording change is a correction,
ruled 2026-11-20), so this can go out with the deploy or after it.**

Two changes to importing a CSV file.

**Every row gets its own category.** If your file has no category column,
you no longer pick one category for the whole file. Each transaction has
its own choice, and Sorrel suggests one from how you've filed that shop
before. A suggestion says it's a suggestion, and you can change it. Set
one TESCO row and Sorrel offers to do the other TESCO rows too. You can
still set a whole group at once. Nothing is imported until every row has
a category.

**Transfers come in as transfers.** A move from checking to savings, or a
card payment, used to come in as spending. Now each row can be Spending,
Income or a Transfer. Sorrel marks the ones that look like transfers, but
you decide. If the other side is already in Sorrel (say you logged the
Visa payment by hand), you're asked whether they're the same transfer, and
a Yes joins them into one. Otherwise both sides are added. If anything
lands before an account's balance date, you're asked about that account's
balance, one account at a time.

**Why a number may move.** A transfer counts once now. Money moving into
savings comes off Safe to Spend once, and savings goes up by the same
amount. A card payment lowers what the card owes as well as your
checking, so it isn't counted again as a bill still to pay.

**If you've already imported transfers as spending**, Sorrel leaves them
as they are. To fix them, go to Settings › Import, choose **Undo this
import** for that file, then import it again and mark the transfers. Undo
puts everything that import added back the way it was.

One wording fix while we were here: the import screen said the file never
leaves your device until you press Import. The file itself never does, but
before you confirm, Sorrel checks the file's dates against your balance
dates. Descriptions and amounts stay on your device until you confirm. The
privacy policy now says exactly that.
