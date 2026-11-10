# Safe to Spend — say why it's the number it is

> **Spec, 2026-11-10. Next up, ahead of the rest of the queue.**
> Found when the builder expected the figure to move after adding a
> future expense, and it didn't (docs/phase-7-findings.md, "Not a defect:
> safe to spend's low point 'in the past'"). This is the fourth time the
> gap has come up and the first time it caught us instead of a
> hypothetical user. Its history is in docs/phase-7-findings.md, "Safe
> to spend doesn't say why it's the number it is".

## The gap

The breakdown shows the low point, its date and the payment that lands on
that day. It doesn't connect them to what someone actually wants to know:

- **Why is it this number?** The figure comes from one day. The screen
  never says so.
- **What will change it?** Anything dated on or before that day lowers
  the figure dollar for dollar. Anything after it lowers the figure only
  once it's large enough to create a new, later low point. A person who
  adds a $300 bill for the 18th and sees no change will decide the app is
  broken.

"No tight days in the next five weeks" is true, but it doesn't connect
to the figure above it.

## What it says

Two sentences: the cause, then what follows from it.

> **Your tightest day is Wednesday 11 November, after Payment to Active
> Cash Visa Card comes out. Anything dated after the 11th leaves this
> figure as it is, up to $1,240 in total.**

(The $1,240 is illustrative. The real figure comes from the walk.)

The figure is exact, not "mostly": playful in framing, precise in
figures. It's a single amount that holds for every date after the
tightest day, because it's measured against the lowest later point.

### The arithmetic (in the projection, in cents)

The walk already has each day's `lowCents` (after that day's
obligations, before its income) and the trough. Add two values to
`SafeToSpendProjection`, worked out in `projectSafeToSpend()` from
`days`, in integer cents. No money arithmetic in the copy layer.

```
lastTightest  the LAST day whose lowCents == troughCents
              (the trough's date is the FIRST such day, since the
              earliest day wins a tie; these differ when a later day
              falls exactly as low)
roomAfter     min(lowCents over days after lastTightest) - troughCents
              null when lastTightest is the horizon's last day
```

What it means: expenses dated after `lastTightest` that total
`roomAfter` or less never lower the figure, whatever their dates. Past
that, the figure drops by at most `a - roomAfter`. It drops by exactly
that amount when the expense lands on or before the lowest later day. A
later date has at least as much room, and usually more. An expense dated
on or before `lastTightest` lowers the figure by `a`, until the figure
reaches zero. So the copy promises "leaves it as it is, up to {room}"
and nothing about what happens past that amount.

Return it as
`after: { date: string; room: number } | null` (`date` = `lastTightest`,
`room` = `roomAfter` in dollars). Leave `trough` as it is.

### Copy, by case

Copy goes in `lib/whatsAhead.ts` beside the rest of the breakdown copy,
as a pure function (`whyThisNumber(data)`), unit tested there.

| Case | Sentence 1 (cause) | Sentence 2 (what follows) |
|---|---|---|
| Trough later than today, one item that day | "Your tightest day is {Weekday D Month}, after {name} comes out." | "Anything dated after the {Dth} leaves this figure as it is, up to {room} in total." |
| Several items that day | "…after {largest} and {n} more come out." (largest first, at most 2 named, as `cause()` does) | same |
| Trough today, nothing ahead goes lower | "Today is your tightest day. Nothing ahead takes your balance below where it is now." | same, with "after today" |
| Trough today from items moved to today (overdue, due today) | "Today is your tightest day, after {name} comes out." | same |
| A later day falls exactly as low (`lastTightest` after trough date) | Sentence 1 for the trough's date | "Anything dated up to {lastTightest} comes off this figure in full. After that, up to {room} in total leaves it as it is." |
| `after` is null (tightest day is the last day: no income in the window, or the balance only falls) | as above | "Anything dated before {horizon end} comes off this figure in full." |
| Safe to spend is $0 | Sentence 1 only | none. "Room" against a figure already at zero would mislead, and the shortfall subline already says what matters |
| Window mode (no paycheck) | same rules. Its walk falls until the last obligation, so it usually ends up in the `after` null case | |

The weekday and date match the "Low point" line (`formatDateWithWeekday`),
the same as everywhere else in the app. The "11th" style is used only in
sentence 2, once the day has been named in full. Never "tomorrow" (see
"Decided").

### The "no tight days" line connects to the figure

When there are no episodes, the low point stays above the cushion. Say
that, with the figures:

> No tight days in the next five weeks. Your lowest point, $2,348.43 on
> Wednesday 11 November, stays above your $500 cushion.

The window-mode version keeps its own ending ("through {date}").

## Where it goes (decided 2026-11-10)

**Sentence 1 goes on the closed card. Sentence 2 goes inside.** The
cause sits with the number, and the consequence sits with the detail. A
figure on its own reads as a verdict. With its cause beside it, it
reads as an explanation. The tester who never opens the breakdown is the
one who decides the number is broken. The line won't read as decoration
because it changes whenever the low point moves.

- **Closed card:** sentence 1 goes under the "$X a day" subline, in
  muted ink at the subline's size or one step down. The card's
  `<button>` gets it in its accessible name, so a screen reader hears the
  cause with the figure.
- **Breakdown:** sentence 2 is the first line, before "Cash on hand".
  Unconfirmed items still go above it, because they're what moves the
  figure today. A $0 figure has no sentence 2, so the breakdown starts
  as it does now.
- Not repeated: sentence 1 isn't shown again inside, and the "Low point"
  line keeps the figure and the payments.
- No icon, no colour.

## After a save: "this doesn't change it" (decided 2026-11-10)

This answers the question at the moment it comes up, without predicting
anything in the form. Once a save succeeds, and only when it's true:

> Saved. This doesn't change your safe-to-spend figure. Your tightest
> day is Wednesday 11 November, before this.

**When it shows.** All four must hold:
- the saved row is dated after today;
- it's an expense on Checking or Cash, or a transfer out of the
  spendable set (the classifier, `isSafeToSpendCommitment`, not a copy
  of it);
- after the save, safe to spend is above $0;
- the row's date is after the new projection's `after.date`.

The last test needs only the projection *after* the save, with no
before-and-after comparison. If the row comes after the last tightest
day, the low point is set by an earlier day the row can't reach, so the
low point (and the figure) is what it was before the save. When it's
unsure, the note stays silent. A tie the row created would be one of
those silent cases, and that's fine.

**What it costs.** Cheap for the create paths, not for the edit paths:

- **Create** (full form and quick add, both through
  `createTransactionAction`): the action already returns an
  `ActionState` that carries a post-save message (`milestone`, shown by
  both forms). Add a second field for this note.
  `afterTransactionCreated()` calls `getSafeToSpend()` once, and only
  for a row that meets the first two conditions. Those are the same reads
  a dashboard load makes, and most saves skip them. No migration, no
  stored state. One correction to the draft: the action doesn't
  recompute the projection now. The dashboard does on its next render,
  so this adds one projection to a future-dated save. It's still cheap.
- **Edit** (`updateTransactionAction`, the transfer editor): these
  redirect to /transactions and return nothing to the form. Carrying the
  note across the redirect needs a one-time message: a cookie set by the
  action, read on the next render, and cleared by an action. That's
  more moving parts for a rarer moment. **Deferred**: create only in this
  spec.
- **Confirmation queue:** never applies. A confirmation is dated on or
  before today.

Shown where the milestone message shows, in the same style. Neutral ink,
no icon, no exclamation mark. It's a fact about the figure, not a
reward.

## Tone constraints (unchanged from v2.1, restated because this is a "why")

- It states facts, names days and names causes. It never advises ("try
  to spend after the 11th"). Saying what changes the figure is fine.
  Telling someone when to spend isn't.
- No exclamation marks. No "warning", "alert", "risk", "careful",
  "only". No red. Ink tokens only.
- It must read as useful to someone whose money is fine.

## Not in this spec

- **The after-save note on the edit paths** (the transaction and transfer
  edit forms). See "What it costs" above.
- **Predicting the effect inside the form, before a save.** Ruled out:
  the note after the save covers the same moment without any guessing.
- The "$X a day for N days left" subline. It's left alone.

## Decided

1. **Dates (2026-11-10):** the weekday and date, "today" for today,
   never "tomorrow" or any other relative word. Relative words go stale
   on a page left open, and they're ambiguous near midnight, which has
   already caused problems twice through timezones.
2. **Placement (2026-11-10):** sentence 1 on the closed card, sentence 2
   in the breakdown. See "Where it goes".

## Tests

`lib/safeToSpendProjection.test.ts`:

- Trough mid-window, recovering on a payday: `after.date` = trough date,
  `room` = the lowest later point minus the trough, exact to the cent.
- Two days tie for the trough: `trough.date` is the first,
  `after.date` the last.
- Trough on the final horizon day: `after` is null.
- Trough today, balance only rises: `after.date` = today.
- Check the property directly. Adding an expense of `room` on any date
  after `after.date` leaves the figure unchanged. Adding `room + $0.01` on
  the day of the lowest later point drops it by exactly $0.01. Adding any
  amount on or before `after.date` drops it by that amount, until the
  figure reaches zero.

`lib/whatsAhead.test.ts`:

- One row per case in the copy table.
- $0 figure: sentence 1 only.
- No episodes: the line names the low point, its date and the cushion.
- Banned words and "!" never appear in any output (extend the existing
  check).
- No output contains "tomorrow", "yesterday" or "in N days".

After-save note (pure decision function, tested beside the copy):

- Future-dated Checking expense after `after.date`, figure above $0:
  the note shows.
- The same expense on or before `after.date`: no note.
- Dated today or earlier: no note.
- On a credit card or Savings: no note.
- Figure $0: no note.
- Income: no note.

## Shipping

The copy changes but no number moves, so no tester note is needed under
the CLAUDE.md rule. No migration. The data already reaches the client
through `getSafeToSpend()`.
