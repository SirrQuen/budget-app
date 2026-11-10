# Tester notes

One file per change that moves a number a tester can see, as sent. The
point is traceability: "my safe to spend dropped on the 4th" should lead
to a cause in this directory, not to someone's memory. That's why goal
money (57) could ship before the 9th instead of being held.

## Every note starts with

```
Sent:      YYYY-MM-DD           the day it went to testers
Migration: NN                   or "none" for an app-only change
Merge:     <short sha>          the merge commit that put it on main
Deployed:  YYYY-MM-DD           production push + main deploy
```

Then the message, exactly as sent. A draft says `Sent: not yet`; fill
the date in when it goes out, and the merge commit when it merges.

## Rules

- One change per note, one note per day. Two numbers moving on the same
  day can't be told apart; that's the whole problem this solves.
- Name the file `YYYY-MM-DD-<slug>.md` by the date sent (the merge date
  until it's sent).
- Written in Sorrel's voice (CLAUDE.md "Voice"): second person, says
  what changed and why the number moved, never alarm.
- Notes go out by message, not in the app. An in-app "what changed"
  surface is a commercial-launch question (docs/phase-7-findings.md).
