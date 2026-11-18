# Decide and grow: building Round 2

**This builds the six "Round 2" boards on the design canvas. Claude Code can't open the canvas, so everything it needs is written here. The ten motion rules in `docs/Motion-and-Delight.md` still apply to everything below.**

---

## Five more rules for this round

1. **One forecast.** The runway and the "Can I afford it?" answer both come from the same projection as the Safe to Spend hero. There's never a second calculation in the browser or a copy in SQL. If the projection can't provide something, it gets extended in one place.
2. **Questions never write.** Asking "what if" saves nothing, logs nothing and sends nothing to analytics. Only "Log it" saves, and it does so through the normal add form.
3. **Never judge.** No "can't afford", "behind", "over" or "missed". When something doesn't fit, say *when* it would.
4. **Estimates say so.** Anything forecast reads "At this pace" or carries its existing estimate label.
5. **Every number is a door.** Every point, pebble and figure opens the item it comes from.

---

## F1 · The runway

- **Opened by tapping the Safe to Spend figure.** It shows a panel or page with the next horizon (the same weeks the hero uses) drawn as the spendable balance, day by day.
- **Data:** the projection's own day-by-day series, covering the spendable set only (Checking and Cash), with the same uncertainty rules (expenses at the high end, income at the low end).
- **Marks:**
  - each payday is a gold sun;
  - each bill is a dip;
  - the lowest point gets a leaf and the label *"<Weekday, Mon D> · $X · your lowest point, after <item>"*, matching the existing tightest-day sentence.
- **The calculation, in one line:** *"$2,800 lowest point − $300 cushion = $2,500 safe to spend."* If the hero clamps to $0, the line says so plainly, in neutral wording.
- **Doors:** tapping a dip opens that transaction or schedule. Tapping a sun opens the paycheck schedule.
- **"View as list":** the same points as a table, for screen readers and anyone who prefers it.
- **Motion:** draws once (800ms) the first time it opens in a session, revealed by a mask per rule 8. After that it's still. Reduced motion: drawn already.
- **Charting:** reuse whatever the app's existing charts use. No new dependency.

## F2 · Can I afford it?

- **Where:** a "What if…" link on the hero and inside the runway.
- **Inputs:**
  - an amount, in integer cents;
  - a day: Today, upcoming weekday chips, or "Pick a date", limited to the forecast horizon.
- **Answer:** the projection run again with that pretend expense added, server-side and read-only. It shows the new Safe to Spend figure, with a digit roll, plus whether the tightest day changes. At most 4 updates a second while typing or dragging.
- **When it doesn't fit** (the figure would go below $0): find the earliest date from the chosen day onward where it *would* fit, by asking the same projection. Say *"$900 on Saturday doesn't fit yet. From Nov 27, there's room."* If nothing in the horizon fits, say *"Not within the next 5 weeks."* Neutral ink, no red, never "can't afford".
- **Buttons:** "Log it" opens the normal add form already filled in (expense, amount, date). "Just looking" closes and leaves no trace.
- **Accessibility:** the answer sits in a polite live region.

## G · Onboarding that grows

- **When:** a user with no accounts. It replaces or absorbs today's dashboard onboarding views. Phase 1 reports what exists.
- **Step 1, an account:** name, type (Checking by default), and the balance right now. Created through the **existing** account-creation path, with the balance date set to today. No bank login and no account numbers.
- **Step 2, a paycheck:** amount, next payday, how often (weekly, every 2 weeks, twice a month, monthly). Created as a recurring income schedule through the **existing** path, with the amount marked as typed by a person, so it isn't flagged as an estimate. **Skippable:** "My pay isn't regular, so skip this."
- **Step 3, the number:** the first Safe to Spend figure appears with the existing WelcomeBloom flower, plus "See how we got there", which opens the runway.
- **Resumable without a new stored flag:** which step to show is worked out from what exists (no account means step 1; an account but no income schedule, and not skipped, means step 2). The "skipped" choice is a cookie.
- **Under two minutes,** three screens, progress shown, keyboard and screen-reader friendly.

### G, addition (2026-11-17): bills

- **Step 3 is honest.** Right after onboarding the number counts the paycheck but no bills, so it overstates. Under the figure: *"That counts your paycheck. Add your regular bills and it gets sharper."* Primary button "Add your bills", secondary "Later". "See how we got there" stays.
- **Add your bills:** chips for Rent or mortgage, Phone, Internet, Car payment, Insurance, Subscriptions and Other. Each opens the **existing** recurring create form, prefilled with an expense and a name. Category: an existing match if there is one, otherwise the picker. **Never create a category silently.** Adding several in a row returns to the chips, each added one with a quiet "Added" check.
- **Dashboard card, if they chose Later:** *"Have regular bills? Add them for a sharper Safe to Spend."* with the same chips. Shown until it's dismissed, 3 recurring expenses exist, or 14 days have passed since the first account was created. Derived from data plus a dismiss cookie (listed per the merge-gate rule; the corrected policy wording covers it). No badge, no notification, never shown to existing users.
- **Tone:** adding a bill lowers the number. It rolls down calmly, with no glow, no leaves and no comment.
- **Verify:** a new user who taps Later sees the card; adding one bill moves the number by that bill and the card stays; adding three hides it; dismissing hides it; an existing user never sees it.

## H · Goal pace

- **Pace:** the average monthly goal money over the last 3 complete months, from the single goal-money source (migration 69). Shown only when there's enough history (Phase 1 proposes the minimum) and the pace is above zero.
- **Bloom month:** today plus remaining ÷ pace, rounded up to whole months. *"At this pace, Japan trip blooms in April."* plus *"Based on about $400 a month over the last 3 months."*
- **With a target date:**
  - if the bloom month is on or before it: *"On pace for your June date."*
  - otherwise: *"About $490 a month would bloom it by March."* (rounded up to $10).
  - A target date already past is treated as no date. Never "missed".
- **Debt goals that follow a card:** pace is the average monthly drop in what the card owes, by month-end balances, with the same balance-date rule as the recap's paydown card. Shown only if positive: *"At this pace, Visa is paid off in May."*
- **Not enough history:** *"Add to it a few more times and Sorrel will estimate when it blooms."* With no pace, the line is hidden entirely.
- **Motion:** the month calendar flips only when the estimate changes (on screen, or since last seen). Reduced motion: it just shows the month.
- **Calculation in SQL.** Phase 1 proposes where it lives.

## I · Coming up as a timeline

- **A List / Timeline switch** on the Coming up card, remembered per device. List stays the default.
- **14 days from today** in the user's timezone, from the **same data** Coming up already uses.
- **Marks:**
  - every bill is the **same-sized** pebble;
  - income arriving into the spendable set is a sunrise;
  - transfers within the spendable set don't appear, as in the forecast;
  - the tightest day gets the leaf, but only if it falls inside the 14 days and comes from the same source as the hero's tightest-day sentence.
- **Tapping a day** shows its items with the account and the existing estimate labels, each linking to its schedule.
- **Phone:** scrolls sideways, today first.
- **Screen readers:** each day is a button labelled *"Friday, Nov 20: Visa payment, $1,320"*.
- **Motion:** none, apart from the selected day's ring (160ms).

## J · Lifetime milestones

- **The set:**
  - first log, then 10th, 100th, 500th and 1,000th log. Counted like the recap: hand-logged plus queue confirmations, **excluding imports**;
  - first import;
  - first goal set and first goal reached;
  - one month, three months and one year with Sorrel, from when the account was created.
- **Never about amounts,** never a comparison, and no locked list. Unearned milestones aren't shown.
- **Settings › Your Sorrel** lists the earned ones, each with its date. A log milestone's date is when that log was created.
- **Celebrated once:** a toast with the logging leaves, from the save action's response (like "First one today") for log milestones, or on the dashboard for time and goal milestones. "Already celebrated" is kept per device in localStorage, inside try/catch.
- **First run after deploy: everything already earned is marked celebrated silently.** No pile of toasts for existing users.
- No notifications, no badge counts, nothing stored in the database. Reduced motion: a toast without leaves.

---

## Batches and order

| Batch | Contents | Model | Gate |
|---|---|---|---|
| **Phase 1** | One combined report for F, G and H | **Opus** | Report only |
| **I** | Timeline | Sonnet | Can start now |
| **J** | Milestones | Sonnet | Can start now |
| **F** | Runway + Can I afford it? | **Opus** | After my rulings on Phase 1 |
| **G** | Onboarding | **Opus** | After F; before any new testers |
| **H** | Goal pace | **Opus** | After G |

F, G and H get their build prompts once the Phase 1 report is ruled on. Each one touches the forecast, creates accounts and schedules, or calculates money, so it's written from what the code actually does.

Every batch adds a tester note (Sent: not yet, not before-deploy) for the next What's new card.

---

## Prompt: Phase 1 for F, G and H (Opus)

```
Read docs/Decide-and-Grow.md in full, and the rules in
docs/Motion-and-Delight.md. Add batches I, J, F, G, H to queue.md in the
doc's order.

PHASE 1 — REPORT ONLY for F, G and H. Build nothing, no branch.

RUNWAY + CAN I AFFORD IT (F):
 1. Does projectSafeToSpend produce a day-by-day balance series, or only
    the trough? Quote it. How would the runway get the series WITHOUT a
    second projection?
 2. How would a pretend expense be passed into the SAME projection,
    read-only, server-side? Propose the smallest change.
 3. "Doesn't fit yet": how to find the earliest date it fits using the
    same projection; the cost (calls per answer) and how to keep it
    cheap.
 4. What chart library or SVG approach do existing charts use?
 5. Where the cushion and the $0 clamp live, and how the one-line
    calculation can read them rather than recompute them.

ONBOARDING (G):
 6. What onboarding exists today (the two dashboard onboarding views,
    anything else)? What happens for a user with no accounts?
 7. The existing write paths for creating an account (with its balance
    date) and a recurring income schedule. Quote them. Is the amount
    marked as typed by a person?
 8. Can the step be derived from data alone, plus a "skipped payday"
    cookie? Any case where that fails?

GOAL PACE (H):
 9. Propose where pace is calculated (SQL function, view or extend
    month_story) and its minimum-history rule. Show the dev test user's
    values for each goal, read-only against sorrel-dev with the Target
    line.
10. Debt-goal pace: month-end balances via counts_in_balance's as-of
    date with the recap's balance-date rule. Confirm feasible.

For each of F, G, H: does it need a migration? Say which and why.
Report all, then stop.
```

## Prompt: batch I, timeline (Sonnet)

```
Batch I: section I of docs/Decide-and-Grow.md (Coming up as a timeline).
Own branch off main.

REPORT FIRST, then build:
  - What data the Coming up card renders from, and where the hero's
    tightest-day sentence gets its day. The timeline uses BOTH as they
    are, with no new query logic.

BUILD per the doc:
  - List / Timeline switch on Coming up, remembered per device
    (localStorage, try/catch). List stays the default.
  - 14 days from today in the user's timezone. Same-size pebbles for
    bills; sunrise for income into the spendable set; transfers inside
    the spendable set not shown; tightest-day leaf only if inside the 14
    days.
  - Tap a day: its items with account and existing estimate labels,
    each linking to its schedule.
  - Phone: horizontal scroll, today first. Each day a <button> with a
    full aria-label. No motion except the 160ms selection ring.
  - Colours per CLAUDE.md (no gold on data where it says so).
No migration, no write path. If either seems needed: STOP and tell me.
VERIFY (I'll sign you in on dev): the timeline shows exactly the items
the list shows for the same 14 days; the leaf sits on the hero's
tightest day; a day with two items shows both; phone width scrolls;
keyboard and screen reader; tsc, eslint, full npm test. Tester note.
Report, then stop. Don't merge.
```

## Prompt: batch J, milestones (Sonnet)

```
Batch J: section J of docs/Decide-and-Grow.md (Lifetime milestones).
Own branch off main.

REPORT FIRST, then build:
  - How each milestone will be derived from existing data (read-only
    counts and dates), and how log counting matches the recap's rule:
    hand-logged plus queue confirmations, imports excluded.

BUILD per the doc:
  - The milestone set exactly as listed. Earned ones only; no locked
    list; never amounts.
  - Settings > Your Sorrel: earned milestones with dates.
  - Toast with the logging leaves, once per milestone per device
    (localStorage, try/catch). Log milestones come from the save
    action's response (same pattern as firstToday); time and goal
    milestones on the dashboard.
  - FIRST RUN: everything already earned is marked celebrated silently.
    An existing user must not get a pile of toasts.
  - No notifications, no badges, nothing written to the database.
    Reduced motion: toast, no leaves.
No migration, no write-path change. If either seems needed: STOP.
VERIFY (I'll sign you in on dev): first run shows no toasts and lists
the earned ones; the next log that crosses a threshold toasts once; a
reload doesn't repeat it; an import of 20 rows doesn't count toward
logs; Settings lists dates correctly; tsc, eslint, full npm test.
Delete anything you created on dev. Tester note. Report, then stop.
Don't merge.
```

---

## Rulings on Phase 1

**F: runway and Can I afford it?**
- Add each day's outgoing and incoming items to `ProjectedDay`, so every point carries its own doors. Approved.
- Split `getSafeToSpend()` into `getSafeToSpendInputs()` plus the existing projection call. The hero's function is unchanged. The pretend expense goes into `futureTransactions` with a sentinel id that doors ignore. Approved.
- Expose the signed value (before the $0 floor) from the projection itself, the one place the floor lives. "Fits" means signed ≥ 0. Approved.
- "Doesn't fit yet": a binary search on one load of inputs. The "not within" line names the real horizon end: *"It doesn't fit before Dec 22, the furthest Sorrel can see."*
- **Transport: a POST route handler, never GET.** Amounts must not go in URLs, because URLs end up in logs. The client aborts a stale request with AbortController.
- The one-line calculation includes goal money when there is any: *"$2,800 lowest point − $300 cushion − $150 for goals = $2,350 safe to spend."*
- Suns use the theme accent or income colour per CLAUDE.md. No gold.

**G: onboarding**
- **One bloom, not two.** For a user with no accounts, WelcomeBloom yields. Step 3 carries the bloom.
- `createAccountAction` returns the new id and also revalidates `/dashboard`. Approved.
- Income category: Paychecks/Salary by default. If it's archived, the step shows a category picker. **Never create a category silently.**
- **Twice a month: two Monthly schedules,** one per payday, with two date pickers, and no migration. First confirm that a Monthly schedule handles days 29–31 and "last day of the month" correctly. If it doesn't, stop and report. Queue a proper semi-monthly frequency.
- Step 2 appears only at the no-transactions stage, so existing testers never see onboarding. Approved.
- Step 3 comes from the step-2 action's response. Approved.
- Step 1 offers Checking and Cash only. Approved.
- Skip cookie: keyed to the user id. **First quote the privacy policy's cookie paragraph.** If it already covers "remembering choices you make in the app", change nothing. If not, stop and tell me before editing the policy.

**H: goal pace**
- Migration 72, `goal_pace()`: read-only, SECURITY INVOKER, STABLE, pinned search path, no user-id parameter, the full migration 57 grant block, and an RLS-harness case. Approved.
- Minimum history: money in at least 2 of the last 3 complete months, always dividing by 3, keyed on money dates. Approved.
- **One pace on the card: the history-based one.** Report every place `projected_completion_date` and `is_on_track` appear in the UI. Any "behind" or "off track" wording becomes neutral. The view's columns stay, since other code may read them.
- Debt goal without enough history: *"A payoff estimate appears after a few months of this card's balances."*
- Real debt figures get checked by a rolled-back test script that switches role, which Matt runs.

---

## Prompt: batch F, runway and Can I afford it? (Opus)

```
Batch F per docs/Decide-and-Grow.md sections F1, F2 and the "Rulings on
Phase 1" for F. Own branch off main. No migration expected; if one is
needed, STOP and tell me.

BUILD:
  - ProjectedDay carries its day's out/in items (with ids) for doors.
  - getSafeToSpendInputs() split out; the hero's getSafeToSpend()
    unchanged in behaviour.
  - Signed safe-to-spend (pre-floor) exposed from the projection.
  - Runway panel opened from the hero: hand-written SVG in the
    CashflowChart pattern, spendable set only, lowest-point leaf with
    the tightest-day wording, suns per CLAUDE.md colours, dips and suns
    as doors, "View as list" table, the one-line calculation including
    goal money, mask-reveal draw once per session, reduced motion static.
  - "What if…" on the hero and in the runway: amount (integer cents),
    day chips + date picker within the horizon, POST route handler with
    AbortController, at most 4 updates/second, digit roll on the answer,
    tightest-day change noted, "doesn't fit yet" via binary search with
    the horizon-end wording, "Log it" opens the normal add form
    prefilled, "Just looking" closes. Polite live region. Writes NOTHING.

VERIFY (I'll sign you in on dev):
  - The runway's lowest point, cushion and goal figures equal the hero's.
  - What-if of $0 returns exactly the hero's figure.
  - A what-if that fits, one that doesn't (earliest-fit date correct by
    checking the day before it doesn't fit), and one beyond the horizon.
  - Network tab: no amount in any URL; requests abort when superseded.
  - Database row counts unchanged after a dozen what-ifs.
  - Doors open the right items; keyboard; screen reader; reduced motion.
  - Unit tests for the split, the signed value and the binary search.
  - tsc, eslint, full npm test. Tester note. Report, then stop.
```

## Prompt: batch G, onboarding (Opus) — after F is merged

```
Batch G per docs/Decide-and-Grow.md section G and the "Rulings on Phase
1" for G. Own branch off main. PRECONDITION: batch F merged (step 3
links to the runway).

REPORT FIRST: (a) the privacy policy's cookie paragraph, quoted, and
whether it already covers the skip cookie; (b) whether a Monthly schedule
handles days 29–31 and "last day of the month" correctly. If either
fails, STOP and tell me.

BUILD:
  - Three steps for a user at the no-accounts stage (and step 2 only at
    no-transactions), replacing NoAccountsView.
  - Step 1: name, type (Checking or Cash), balance; balance date today;
    createAccountAction returning the id and revalidating /dashboard.
  - Step 2: amount, next payday, how often (weekly, every 2 weeks =
    Weekly interval 2, twice a month = two Monthly schedules with two
    date pickers, monthly); amount_is_variable = false; Paychecks/Salary
    or a category picker if it's archived; skippable (cookie keyed to
    the user id).
  - Step 3 from the step-2 response: the first Safe to Spend figure with
    the bloom, "See how we got there" opening the runway. WelcomeBloom
    yields for users with no accounts.
  - Progress shown; keyboard and screen reader; reduced motion.
VERIFY (I'll sign you in as a NEW user on dev — I'll create it):
  - A brand-new user gets one bloom, not two.
  - Each frequency creates the right schedule(s) and next dates.
  - Skip works and persists; existing users never see onboarding.
  - The step-3 figure equals the dashboard hero afterwards.
  - Delete the test user's data afterwards. tsc, eslint, full npm test.
Tester note. Report, then stop.
```

## Prompt: batch H, goal pace (Opus) — after G is merged

```
Batch H per docs/Decide-and-Grow.md section H and the "Rulings on Phase
1" for H. Own branch off main.

REPORT FIRST: every UI place projected_completion_date and is_on_track
appear, and any "behind"/"off track" wording.

BUILD:
  - Migration 72 goal_pace(): read-only, SECURITY INVOKER, STABLE,
    pinned search_path, no user-id parameter, full migration 57 grant
    block. Last 3 complete months, money in at least 2 of them, divide
    by 3, carried_over excluded. Debt goals: month-end balance drop over
    3 months with the recap's balance-date rule, positive only.
  - Goal card line per the doc (bloom month, "On pace for your <Month>
    date", "About $X a month would bloom it by <Month>" rounded up to
    $10, past target dates treated as no date, the two
    not-enough-history lines). History pace is the only pace shown.
  - Neutral wording wherever is_on_track surfaced as "behind".
  - Calendar flip on change (on screen or since last seen); reduced
    motion static.
  - RLS-harness case for goal_pace; docs/goal-pace-test.sql, rolled back,
    switching role to check a debt goal's real figures.
Migration 72 to DEV only; I run the push. Then give me the test
commands. VERIFY in the browser on dev: Japan trip shows "About $390 a
month would bloom it by April". tsc, eslint, full npm test. Tester note.
Report, then stop.
```
