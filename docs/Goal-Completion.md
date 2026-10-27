# The bloom — where it plays, and what Sorrel says

**Four placements, one animation, one arbitration rule. The hard parts are the copy and knowing when *not* to play it.**

---

## The four

| | Where | How often | What it marks |
|---|---|---|---|
| **A** | First sign-in of the day | Once per day, per person | The app opening for you today |
| **B** | Email confirmed | Once, ever | The account coming to life |
| **C** | Waitlist success | Once per visitor | The first motion Sorrel ever shows someone |
| **D** | Goal completion | Rare, earned | The one unambiguously good thing that happens here |

Three of these cluster at the start of a session, which is the problem the arbitration rule below exists to solve.

---

## The rule that governs all four

> **The bloom runs concurrently with work, never in series with it.**

It fills time already being spent, or it celebrates something that just happened. The page behind it loads the whole time.

- **It dissolves on its own** when the animation finishes. No button to press.
- **It never blocks the page behind it** from loading or preparing. Whether it blocks *interaction* varies by placement.
- **Reduced motion removes the animation, not the message** — see each placement.

**Placement A is a deliberate exception on one point.** It is a brand gate: it plays to completion and is not dismissible by input. That's a product decision, and the concurrency rule above is what keeps it affordable — see that section for the distinction between a gate that costs a second and one that costs a second *plus* the load.

The other three dismiss on any input — click, key, tap, scroll — with nothing lost.

---

## Arbitration: one bloom per sign-in

A new user confirms their email, lands signed in, and it is also their first sign-in of the day. Without a rule, that's **two blooms in five seconds**, which reads as a bug.

> **The first bloom to fire in a session suppresses the others for that session, and marks the day as welcomed.**

So the confirmation bloom plays, and the welcome bloom doesn't. Goal completion is exempt — it happens minutes or hours later, in response to something the user did, and is never part of the sign-in cluster.

> **The bloom supersedes the sign-in fold.** On a load where a bloom plays, the dashboard flower's sign-in fold (fold → hold → reopen, `DayNightMark`) does not. They never play together. Every other sign-in that day keeps the existing fold sequence unchanged.

"One bloom per session" didn't cover the fold, because the fold isn't a bloom — it's the other sign-in animation, and without this rule a confirmed signup would get both. Mechanism: the authenticated layout reads both one-shot cookies (`sorrel_welcome`, `sorrel_signed_in`) on the server, and `components/SessionFlags.tsx` deletes them as the layout mounts -- on every app page, so an empty-state dashboard can't leave the sign-in flag behind. It offers the fold to `DayNightMark` only when no bloom plays, and only on the landing page.

---

## The animation itself

Reuse `SorrelFlower` with a `bloom` state. **It does not go in `SorrelMark`** — that file stays untouched, as it has through the flower work.

```css
--flower-bloom-duration: 900ms;
--flower-bloom-stagger:  110ms;
--flower-ease: cubic-bezier(.34, .02, .24, 1);   /* the app's one curve, unchanged */
```

Each leaflet goes from `rotate(-54deg) scale(.08)`, opacity 0, to rest — staggered 110ms, back to front. Transform and opacity only. Plays once. No loop, no replay, no idle motion afterwards.

**It must survive being cut short.** Dismissal at 300ms unmounts the component mid-animation and nothing throws. Don't restart it with a `key` change; that fights reconciliation and is how this project produced `removeChild` errors before.

**No sound.** Anywhere. The nav spec's silence rule holds.

### The bloom is not the fold

The dashboard flower folds to show the time of day, and **nothing may loop the fold**. The bloom is a different verb — assembly from nothing — so there's no collision, but keep them visually and conceptually separate.

In particular: **the welcome bloom shows the mark fully open regardless of the hour.** It's a greeting, not a weather report. Someone signing in at 11pm gets an open flower in the overlay and a folded one on the dashboard behind it, and that is correct. Do not "unify" these later; they mean different things.

---

# A — First sign-in of the day

The one with the most ways to go wrong.

## It is a gate. It plays to completion.

This is a deliberate product decision: the bloom is part of what Sorrel *is*, and an animation that gets tapped away half the time isn't a brand moment. It runs start to finish, with no skip and no dismiss-on-input.

**That makes one engineering detail the whole ballgame.**

There are two ways to build a gate, and they feel completely different to the user:

| | Cost |
|---|---|
| Bloom finishes → *then* the dashboard starts loading | `bloom + load` — the bloom's duration is added to every first sign-in, on top of whatever the data takes |
| Bloom plays **while** the dashboard loads behind it | `max(bloom, load)` — the bloom is free whenever the data was going to take that long anyway |

**Build the second one.** The dashboard's fetch starts immediately, in parallel with the animation. The user sees an uninterrupted bloom either way — nothing about the experience you asked for changes — but the cost is bounded to roughly the animation's length instead of stacking on top of the load.

Getting this backwards is the single most likely way this ships feeling slow, and it won't be visible in testing on a fast connection, because a 200ms load hides inside a 900ms bloom in both designs. It shows up on a tester's phone on mobile data.

**If the data outlasts the bloom**, the bloom resolves into the loading state — the same flower, now doing the stem sway. One component, continuous motion, no flash of a different thing. That's why the loader got the sway rather than a fold in the first place.

**Budget:** 900ms bloom plus a ~200ms dissolve. About 1.1 seconds, roughly thirty seconds of a tester's month. Treat that as a ceiling, not a starting point — this is exactly the kind of number that creeps.

**Mark the day as welcomed when the bloom *starts*, not when it finishes.** Otherwise a refresh at 400ms replays it, and so does a back-and-forward.

**Reduced motion still skips it entirely.** That isn't a preference being honoured, it's a WCAG requirement, and you've just finished an accessibility pass worth not regressing. Someone with `prefers-reduced-motion` set lands on the dashboard directly.

## Knowing it's the first sign-in today

**Decided in the sign-in action, carried in cookies.** Not a database column, and not localStorage (the first build used localStorage; it was replaced, so there is one mechanism, not two).

The reason is specific to this codebase: `record_login()` writing on every page load is a bug you already found and removed, and it corrupted `profiles.updated_at` on the way. A "last welcomed" write is the same shape. Don't rebuild it.

- **`login()` compares `sorrel_welcomed_on` (the date alone, kept a week) to today in the user's timezone.** A different day sets the one-shot `sorrel_welcome=daily` and updates the date cookie -- at sign-in, before the bloom, so a refresh mid-bloom can't replay it.
- **The authenticated layout reads the one-shot on the server and renders the overlay in the first render** -- in the initial HTML of a full load, in the first commit of a client navigation -- ahead of the layout's own data, which streams in behind it. A client-side overlay can't exist before hydration; that put the loader in front of the bloom, serial again. This doesn't.
- **The day is the user's calendar day.** Their stored zone; else the zone the browser sends with the form (`BrowserTimeZoneField` -- a new user has none stored); else UTC. Someone in Georgia signing in at 8pm must not get a second bloom at 8:01pm because UTC rolled over — migration 22's backfill bug came from exactly this.
- **Reduced motion:** the server can't know it, so the overlay is in the HTML and CSS keeps it from painting (`.welcome-bloom--gate`).

The cost of this choice is that someone using a laptop and a phone on the same day sees it twice. That's an acceptable trade for not touching the write path.

> **If this ever needs to be correct across devices**, it belongs in the activity table already planned for the streak rework — the one meant to serve streak, last-seen, and getting activity data off `profiles`. Not in a new column, and not here.

## Copy

A name and nothing else. This happens 30 times a month; anything with a sentence in it becomes a tax.

> ## Good morning, Matt.

Morning / afternoon / evening from the user's local time. The preferred name if they gave one, first name otherwise, and **nothing at all** if neither exists — "Good morning, there" is worse than just the flower.

No figures. No "you have 3 things to confirm." The dashboard behind it already says that, and putting a number on a greeting turns a welcome into a task list.

## Reduced motion

No overlay at all. The user lands on the dashboard directly. There is no message being withheld — the greeting is decoration here, unlike in placement D.

## Be willing to cut it

Once a day is the upper edge of what survives repetition. The two things making it survivable are that it never blocks and that any input kills it.

**Put the whole thing behind one constant** so it can be turned off in a line, and ask two testers in week two whether it's still charming. If the answer is "I stopped noticing," fine. If it's "I've started tapping through it," that's your signal and you remove it without regret.

---

# B — Email confirmed

The interstitial you just built: a GET renders the page, the button's POST calls `verifyOtp`, the session is established.

On success, the bloom plays and the page says the account is live, then moves to the dashboard. It marks the day as welcomed, so placement A doesn't also fire.

**It is the dashboard overlay — the same component as A, its copy chosen by reason.** The successful `verifyOtp` POST sets `sorrel_welcome=confirmed` unconditionally (and marks the day), and the layout renders it like A's. It is a **force**: it bypasses the date check entirely. B is once-ever and must never be suppressed by a date key — a user who happened to be welcomed earlier the same day (another account, a shared browser) still gets it.

> ## Sorrel is yours.
> You're signed in and ready to go.

**Reduced motion:** the flower renders at rest, the copy appears unchanged. The message is not decoration here.

**On failure, nothing blooms.** A real `verifyOtp` error gets the honest message and the offer to resend — that's the whole point of the interstitial, and a celebration firing on a failed confirmation would be the "failures reported as something they aren't" pattern in its purest form.

---

# C — Waitlist success

The cheapest of the four and the only one that's live today.

The success block already exists, already moves focus to itself, already has `role="status"`. Add the bloom inside it. Nothing else changes.

> **You're on the list.**
> Sorrel will send an email to matt@example.com once it launches.

No persistence, no arbitration, no state. One visitor, one submission, one bloom.

**Reduced motion:** the flower at rest, the message unchanged. It's announced to screen readers either way — don't let the animation become a condition of the confirmation appearing.

---

# D — Goal completion

The one worth the most thought, because the question isn't the animation. It's what Sorrel says to someone who just paid off a credit card.

Sorrel's position is that it never makes anyone feel bad about spending. That's half a stance. The other half is acknowledging something good when it happens — otherwise the product is merely neutral, and neutral is what a spreadsheet already offers.

This is also the only place the "video-game appeal" intent belongs. Not on a badge that rewards activity — you found and killed one of those — but on the one moment that is unambiguously earned.

## When it fires, and the architectural ruling underneath

**The celebration is part of the response to the action that completed the goal.** The user presses Save; the moment happens right there, in that interaction.

That single decision removes a class of problems:

- **No render-time write.** Completion is detected in the server action that wrote the contribution or edited the goal, after the write, by recomputing progress. Not during a render. That rule is where three Phase 7 findings came from, and detecting completion while rendering is how you'd break it again.
- **No pending-celebration state.** Nothing to store, mark as seen, or expire.
- **No stale celebration.** Complete a goal on your phone, open your laptop, and you aren't congratulated for yesterday. The moment belongs to the action.

Record `completed_at` on the goal anyway — real history, and it drives the completed resting state. It just doesn't drive the celebration.

> **When linked goals land, this responsibility moves.** A linked goal completes because an account balance changed, in a different action entirely. Whatever action moves that balance owns the detection. Write this on the linked-goals branch now, or it gets rediscovered as a render-time write.

## One treatment. The copy carries the weight.

Resist tiering by goal size. A threshold deciding whose achievement is big enough for the full animation is a judgment Sorrel has no business making — paying off $400 can matter more to one person than $14,000 does to another.

**Staging:** a centred panel over a dimmed page, not a full takeover. This is a budgeting app, not a game; it should feel like being handed something, not like winning a level.

- Flower blooms at the top of the panel, 160–200px
- Headline, figure, then what happens next
- One primary action, one way out
- Focus moves into the panel, Escape closes it, dismissing immediately loses nothing

**No confetti, no emoji, no exclamation marks.** The achievement is real; treating it as real means stating it plainly rather than decorating it.

## The copy

Three parts, every time: the headline names the thing **in the user's own words** (the goal's name as they typed it); one line with the **real figure and one real detail**; then **what happens next**.

### Debt payoff

> ## Visa is paid off.
> **$4,280 cleared since March** — seven weeks ahead of your date.
>
> The $340 a month you were sending to this card isn't committed to anything now.
>
> `[ Where should that go? ]` · Keep it for later

### Savings

> ## New laptop — done.
> **$1,400 set aside** over four months.
>
> `[ Start another goal ]` · Close

### Retirement

A milestone, not an ending. The copy must not imply the work is over.

> ## You've reached $50,000.
> **Your first milestone**, eleven months in.
>
> `[ Set the next one ]` · Close

## The part only Sorrel can say

> **"The $340 a month you were sending to this card isn't committed to anything now."**

That line is why this is worth building rather than installing a confetti library.

Sorrel knows a recurring transfer fed that goal, and that the schedule is **still live** — still in the projection, still going to fire next month against a zero balance. Nobody else's budgeting app is positioned to notice.

So the panel's primary action resolves the schedule: stop it, redirect it to another goal, or leave it alone deliberately. And **say the amount, not a generality** — "you've freed up money" is a greeting card; "$340 a month" is information.

**If the schedule can't be identified with confidence, drop the line entirely.** A confident sentence about the wrong number is worse than silence, and this project has a running theme of prose asserting things that turned out not to be true.

## Reduced motion

No animation. The panel, headline, figure and next step all appear exactly as they do for everyone else. Someone with vestibular sensitivity does not get a lesser acknowledgement of having paid off their credit card.

## Reversal

Delete the contribution that completed the goal, progress drops below 100%, the goal un-completes and `completed_at` clears — **silently**. No "you've lost your completion," no toast. The user corrected a mistake; Sorrel notices and says nothing.

Re-completing later fires the moment again. Rare enough not to matter, and suppressing it would mean storing the seen-state this spec exists to avoid.

## Afterwards

A completed goal **stays on the goals page** with a completed treatment — meter full, the date it completed, and an **Archive** action. Don't auto-hide it. Someone who has just paid off a credit card wants to be able to look at it.

---

## Not in scope, anywhere

Sharing or screenshots · streaks, badges, levels or points · a completion history · sound · tiering by amount · the bloom in any loading state (the loader uses the stem sway, because a loop looks right cut off at any duration and a truncated bloom reads as a glitch) · the bloom on every login.

---

## Order

**C first** — it's an hour, it's on a branch you can ship immediately, and it's the one real visitors see. **B next**, small and bounded. **A and D** together, since they share the arbitration rule and the overlay component.

---

## The prompt

```
Add the bloom animation in four places. Read docs/Goal-Completion.md in full
first.

PHASE 1 — REPORT ONLY:

 1. Which server actions can cause a goal to reach 100%? Contribution
    insert, contribution edit, goal edit (target lowered) — all of them,
    file and line.
 2. Does `goals` have a completed_at column? If not, sketch the migration.
 3. For a goal funded by a recurring schedule, can that schedule be
    identified from the goal WITH CONFIDENCE? Quote the relationship. If it
    is a guess, say so — the copy drops that line rather than name a wrong
    figure.
 4. What does the goals page show today for a goal at 100%?
 5. Where does the app establish "today" in the user's timezone on the
    client? I need it for the once-per-day check and it must NOT be UTC.
 6. Does SorrelFlower exist yet on a merged branch, or only on the flower
    branch?

Report, then stop.

PHASE 2 — build in this order: C, then B, then A and D together.

THE RULE FOR ALL FOUR: the bloom NEVER sits in front of something the user
is waiting for. It fills time already being spent, or it celebrates
something that just happened. Any input dismisses it instantly. It
dissolves on its own. It never blocks the page behind it.

ARBITRATION: the first bloom to fire in a session suppresses the others for
that session AND marks the day as welcomed. Otherwise a new user confirming
their email gets two blooms in five seconds. Goal completion is exempt — it
is never part of the sign-in cluster.

THE ANIMATION: SorrelFlower only, `bloom` state. SorrelMark stays untouched.
  --flower-bloom-duration: 900ms
  --flower-bloom-stagger:  110ms
  the app's existing easing curve, unchanged
Each leaflet from rotate(-54deg) scale(.08) opacity 0 to rest, staggered
back to front. Transform and opacity only. Plays once. Survives an unmount
mid-animation; do NOT restart it with a key change. NO SOUND anywhere.

The welcome bloom shows the mark FULLY OPEN regardless of the hour. It is a
greeting, not the day/night fold. Keep them separate.

C — WAITLIST SUCCESS: add the bloom inside the existing success block.
No persistence, no arbitration, no state. Reduced motion: flower at rest,
message unchanged, still announced to screen readers.

B — EMAIL CONFIRMED: on a SUCCESSFUL verifyOtp POST only. Marks the day as
welcomed. "Sorrel is yours. / You're signed in and ready to go."
ON FAILURE NOTHING BLOOMS — a real error gets the honest message and the
resend offer. A celebration on a failed confirmation is the exact pattern
the interstitial was built to remove.

A — FIRST SIGN-IN OF THE DAY:
  - A GATE. It plays to completion. No skip, no dismiss-on-input. This is
    deliberate — it's a brand moment.
  - CONCURRENCY IS THE WHOLE POINT. Start the dashboard's data fetch
    IMMEDIATELY, in parallel with the animation. Cost must be
    max(bloom, load), NEVER bloom + load. Both designs look identical on a
    fast connection, which is why this has to be right by construction
    rather than by testing — it only shows up on mobile data.
  - If the data outlasts the bloom, the bloom resolves into the LOADING
    STATE: same flower, stem sway, continuous. No flash of a different
    component.
  - Budget 900ms + ~200ms dissolve. Treat 1.1s as a ceiling.
  - MARK THE DAY AS WELCOMED WHEN THE BLOOM STARTS, not when it finishes,
    or a refresh at 400ms replays it.
  - localStorage, keyed to the USER'S TIMEZONE calendar day. NOT a database
    column: record_login() writing on every page load is a bug already
    removed from this codebase and this is the same shape. NOT UTC —
    migration 22's backfill bug came from exactly that.
  - Failure default is DON'T PLAY. If localStorage throws, skip it. Wrap
    every read and write in try/catch.
  - Copy: "Good morning, <name>." by local time. Preferred name, else first
    name, else NO NAME AT ALL — not "there". No figures, no counts.
  - Reduced motion: SKIPPED ENTIRELY, straight to the dashboard. This is a
    WCAG requirement, not a preference, and it is the one exception to "it
    always plays".
  - PUT THE WHOLE PLACEMENT BEHIND ONE CONSTANT so it can be disabled in a
    line, and the duration beside it. I want to ask testers in week two
    whether it still charms.

D — GOAL COMPLETION:
  - Detected IN THE SERVER ACTION that wrote the change, after the write, by
    recomputing progress. NEVER during a render. The action returns a flag;
    the panel shows in that same interaction. No pending-celebration state,
    nothing to mark as seen.
  - Record completed_at for history and the completed resting state; it does
    not drive the celebration.
  - Centred panel over a dimmed page, flower 160-200px, headline, figure
    line, next step. Focus enters it, Escape closes, dismissing loses
    nothing. No confetti, no emoji, no exclamation marks.
  - Copy: headline names the goal in the user's own words; one line with the
    real figure and one real detail; then what happens next. Retirement copy
    must NOT imply the work is finished.
  - THE FREED-UP MONEY: when a recurring schedule fed the goal, name the
    amount and make the primary action resolve the schedule — a live
    recurring payment to a zero-balance card keeps posting. IF THE SCHEDULE
    CANNOT BE IDENTIFIED WITH CONFIDENCE, DROP THE LINE.
  - Reduced motion: no animation, but the panel and all copy appear.
  - Reversal: deleting the completing contribution un-completes the goal and
    clears completed_at SILENTLY.
  - Afterwards: the goal stays on the page with a completed treatment and an
    Archive action. Do not auto-hide it.

ALSO RECORD on the linked-goals branch: when linked goals land, completion
detection moves to whatever action changes the linked account's balance.
Put it in that branch's commit message.

VERIFY:
  - Sign in twice in one day: bloom once. Sign in the next day: bloom again.
  - Sign in at 11:55pm and again at 12:05am local: TWO blooms. Confirm the
    boundary is local, not UTC.
  - With localStorage blocked: no bloom, no error, no bloom on every login.
  - Confirm an email and land on the dashboard: ONE bloom, not two.
  - A failed verifyOtp: no bloom, honest error.
  - CONCURRENCY, measured on a throttled connection (DevTools "Slow 4G"):
    time from sign-in to interactive dashboard must be max(bloom, load),
    not bloom + load. Report both numbers. On a fast connection the two
    designs are indistinguishable, so this test only means anything
    throttled.
  - The dashboard's data request starts BEFORE the bloom finishes — confirm
    it in the network panel, don't infer it.
  - If the load outlasts the bloom, the transition into the stem sway has
    no flash or layout shift.
  - A refresh at 400ms into the bloom does NOT replay it.
  - Completing a goal shows the panel once, in that interaction; reloading
    does not show it again; another device does not show it.
  - No row is written by any page render.
  - Reduced motion on each of the four.
  - Keyboard only on B and D.
```
