# Motion and delight: building the design canvas into Sorrel

**The canvas "Sorrel — Bringing it to life" shows nine steps. This doc turns them into build instructions. Claude Code can't open the canvas, which is private to Matt, so everything it needs is written here.**

---

## Rules every step follows

These come before any single effect, and Claude Code checks each step against them.

1. **Motion celebrates. It never warns.** No red, no shake, no flashing. A falling number moves as calmly as a rising one.
2. **Celebrate the effort, not the streak.** Nothing counts days or notices a missed one.
3. **Coral is the mark.** Money and progress use gold. Red never describes anyone's money.
4. **Quick and never in the way.** Taps and moves finish in under 300ms. Celebrations take at most 1.2s and never block input.
5. **Every effect has a calm version.** With `prefers-reduced-motion`, the end state appears at once. Nothing loops at the edge of the eye, except a loading state.
6. **Motion only means change.** Nothing animates on every page load. It animates when a value changes while the user is watching.
7. **No render writes, ever.** "First save today", "seen this recap" and similar are derived on read or kept in a cookie, never written to the database by a page render.
8. **Animate transform and opacity only.** Never width, height, top or left. A meter fills with `transform: scaleX()`, not `width`.
9. **No new animation library.** CSS plus small React hooks. dnd-kit is already there for dragging. If a step seems to need a library, stop and ask.
10. **Screen readers get the result, not the motion.** Moving digits are `aria-hidden`. The real value sits in text a screen reader can read, announced politely when it changes.

---

## Step 0: the foundation (do this first, in the same branch as steps 1–4)

- **Check the colours.** The canvas uses the Brand Kit's colours, which were matched by eye: gold `#E8B44A`, pale gold `#F3CF7A`, deep gold `#C99632`, ink `#0B0B12`, surface `#13131D`, raised surface `#1B1B27`, text `#F6F4F8`, muted text `#A5A2B4`. Compare them with `globals.css`. **Where the app already has a token, use the app's value.** Add only what's missing, and report every difference.
- **Motion tokens** in `globals.css`, used everywhere instead of numbers typed inline:
  - `--motion-fast: 160ms` (page arrival, small fades)
  - `--motion-base: 220ms` (toggles, slides)
  - `--motion-roll: 500ms` (number rolls)
  - `--motion-celebrate: 900ms` (glows, blooms)
  - `--ease-out: cubic-bezier(.34,.02,.24,1)` (the Brand Kit's bloom curve)
  - `--ease-spring: cubic-bezier(.34,1.25,.5,1)` (a slight overshoot)
- **One reduced-motion switch.** A global CSS rule under `@media (prefers-reduced-motion: reduce)` that removes animations and transitions, plus one `useReducedMotion()` hook for JavaScript-driven effects. Every effect is tested with it on.
- **One "value changed" hook,** for example `usePrevious(value)`, so effects fire on change only, never on first render.

---

## The steps

### 1 · Small touches (size S)

| Control | Effect |
|---|---|
| "Got it" and confirm checks | The check's stroke draws itself in 250ms |
| Toggles | The knob moves with `--ease-spring`, 220ms; the track turns gold |
| Primary buttons | A soft ripple from the tap point, white at 35% fading to 0 in 400ms |
| Page changes | Fade plus an 8px rise, `--motion-fast` |
| Loading placeholders | A slow pulse, opacity 0.45 to 0.8 over 1.6s. Replaces any shimmer |
| Account balances after a save | The new figure sharpens in over 300ms (opacity plus a 2px blur clearing). Same in either direction |

### 2 · Safe to Spend comes alive (size S)

- **When the figure changes while on screen,** the digits roll to the new value in `--motion-roll` with `--ease-spring`. Upward for a rise, downward for a fall.
- **A rise** also gets a gold glow *behind* the number: a radial gradient at 28% fading out over `--motion-celebrate`.
- **A fall gets no glow,** no colour change and no shake.
- **No change, no motion.** First load shows the number still.
- **Screen readers:** the rolling digits are `aria-hidden`. The real figure is in text a screen reader can read, in an `aria-live="polite"` region.
- Never red, never flashing, never pulsing on its own.

### 3 · Logging feels good (size S)

- **On a successful save** (any create through the normal path, including Log again and quick add):
  - the Save button briefly shows a check and "Saved";
  - one or two gold leaves float up from it and fade, 900ms in total;
  - the toast reads *"Logged · Coffee $5.75"* with a **Log again** link.
- **The first save of the day** also shows a small *"First one today"* chip with a leaf. "Today" means the user's timezone. It's worked out **from the save action's response** (were there other transactions created today before this one?), not stored anywhere.
- **The same reaction for every amount.** Never bigger for a big purchase.
- **No streaks, no counts, nothing about yesterday.**
- **Haptics:** a light `navigator.vibrate(10)` where supported (Android). iPhones' Safari doesn't support it, which is fine.
- **Reduced motion:** the toast appears and no leaves fly.

### 4 · Empty states with character (size S)

Each empty screen gets a small inline-SVG drawing, one sentence and a button. The drawing sways gently: ±4° over 6s, still under reduced motion.

| Screen | Drawing | Heading | Line | Button |
|---|---|---|---|---|
| Goals | A seed in soil, one shoot | Plant your first goal | Something you're saving toward. Sorrel helps it grow a little each month. | New goal |
| Transactions | A two-leaf sprout | Nothing logged yet | Add your first one, or import a file from your bank. | Add · Import |
| Search, no results | A magnifier with a leaf | Nothing matches "*query*" in *account* | Try another word, or clear the filters. | Clear filters |

- **Never "You haven't…"** Find every empty state in the app, list them, and apply the pattern to each one. Report the ones not in this table with the wording you chose.

### 5 · Goals that grow (size M, after the debt-goal work ships)

- **The meter becomes a stem:** a 10px track in the raised surface colour, with a gold gradient fill (`#C99632` → `#E8B44A` → `#F3CF7A`) drawn with `scaleX`.
- **Leaves at 25%, 50% and 75%:**
  - passed leaves are solid gold;
  - unpassed leaves are an outline in muted text colour;
  - a leaf unfurls once, 250ms with `--ease-spring`, at the moment the fill passes it **on a change**.
- **The fill grows over 700ms** when progress changes, never on page load.
- **Completion:** the existing `SorrelFlower` bloom, played only in response to the action that completed the goal (the existing `detectCompletion` path, and the shared helper for debt goals). At rest, the open flower sits beside *"Reached on Dec 3"* (or *"Paid off on Dec 3"* for debt goals).
- **A debt goal that slips back** shrinks without comment. The line still reads *"$1,240 to go"*, and nothing turns red.

### 6 · A dashboard you can hold (size S)

Polish on the existing dnd-kit drag:

- **Lift:** 120ms. The card scales to 1.03, tilts about −1°, gets a deeper shadow and a thin gold ring.
- **Slide:** the other cards move aside in 200ms. A dashed gold outline shows where the card will land.
- **Settle:** 180ms with `--ease-spring`, then the existing "Moved · Undo" toast.
- **Haptics:** a light tick on pick-up and on drop, where supported.
- **Reduced motion:** no lift or tilt, just the outline and an instant move. That's today's behaviour.
- Pointer-first collision and keyboard moves stay exactly as they are.

### 7 · The mark, alive (size M)

- **Launch bloom:** on a cold start only (once per session, kept in a session cookie), the mark blooms as in the Brand Kit: three leaflets, 900ms, staggered 110ms. It must **never delay the dashboard.** If loading takes longer than 600ms, the flower breathes (scale 1 to 1.035 over 5s). **Never a spinner.**
- **Brand rules:** any glow sits behind the mark, never on it. The mark is coral, white or ink only, and flat coral below 24px.
- **App icons:** primary (gradient mark on ink, with a faint warm glow behind), gold (white mark on a gold gradient), light (ink mark on `#F4F1F5`), and flat coral on ink for small sizes.
- **Home screen:** first report whether the app has a web app manifest and icons. Use Next.js's built-in file conventions (`app/manifest.ts`, `app/icon`, `app/apple-icon`, with `ImageResponse` from `next/og` if PNGs need generating) and **no new dependency.** Sizes 180, 192 and 512.

### 8 · Seasons and time of day (size M)

- **A light glow at the top of the dashboard,** behind everything, by the user's local time (the same timezone balances use):

  | When | Greeting | Light |
  |---|---|---|
  | 5am–noon | Good morning | gold `rgba(232,180,74,.24)` top-left |
  | noon–5pm | Good afternoon | pale gold `rgba(243,207,122,.18)` top-centre |
  | 5pm–10pm | Good evening | violet `rgba(142,124,255,.22)` top-right |
  | 10pm–5am | Hi, night owl | deep blue `rgba(90,120,230,.16)` |

  These are the most saturated values allowed. **Numbers and text never change colour.**
- **A seasonal leaf beside the greeting:**
  - spring: a sprout (Mar–May);
  - summer: a full stem (Jun–Aug);
  - autumn: one leaf drifting slowly (Sep–Nov);
  - winter: a bare stem with frost (Dec–Feb).

  Northern hemisphere for now. Note a hemisphere setting in the queue.
- Rendered on the server from the user's timezone, so there's no flash. Nothing is stored.

### 9 · Your month, as a story (size L, after goal links ship)

- **Four cards** you tap through, story-style, with progress bars at the top:
  1. *"Your November"*: the mark and "A look back at your month".
  2. *"You logged N times this month."* Count of transactions **created** that month.
  3. *"You set aside $X for <goal>."* From the single goal-money source built in migration 69, with the goal's meter.
  4. *"December starts with $Y safe to spend."*, then Done and Share.
- **Only good news or plain facts.** If a card has nothing positive or neutral to say (no goals, say), **leave the card out.** Never "you overspent", and never a comparison with other people or with last month. Below a minimum (fewer than 5 logs, say), skip the recap entirely.
- **When:** the first time the app opens in the first 7 days of a month. Dismissed by Done or close, and kept dismissed by a cookie named with the month. Never shown again that month.
- **Derived on read from existing views. Nothing new stored.**
- **Share** makes an image **on the device.** No amounts are sent to a server to draw it. **Amounts are hidden by default,** with a toggle to include them.
- **Reduced motion:** cards swap without sliding.

---

## Order, models and branches

| Batch | Steps | Model | When |
|---|---|---|---|
| **A** | 0, 1, 2, 3, 4, 6 | Sonnet | After goal links (69) merges |
| **B** | 7 | Sonnet | After A |
| **C** | 5 | Sonnet | After debt goals (70) merges, because it changes the goal cards that 70 touches |
| **D** | 8 | Sonnet | After C |
| **E** | 9 | **Opus** | After D. It computes money figures and has privacy rules |

All of these are user-visible, so each batch adds lines to the next **What's new** card, with a new dated cookie.

---

## Prompts

Batches C to E get their prompts when their turn comes. Each depends on work that isn't finished yet (debt goals, goal links), so its prompt is written from the state the code is actually in at that point.

## Prompt for batch A

```
Read docs/Motion-and-Delight.md in full. Add batches A–E to queue.md
in the doc's order.

Build BATCH A on its own branch off main: step 0 (foundation), then
steps 1, 2, 3, 4 and 6.

Before writing code, report: (a) the colour comparison against
globals.css — app values win where they exist; (b) any existing
animation library or motion code; (c) every empty state in the app.
Then build.

The ten rules at the top of the doc are requirements, not style
notes. In particular: nothing animates on page load, nothing is
written by a render, transform/opacity only, no new dependency, and
every effect is tested with prefers-reduced-motion on.

If anything here needs a migration, a change to a write path, or a
change to how any number is calculated: STOP and tell me.

VERIFY, in the browser on dev (I'll sign in for you):
  - Safe to Spend rolls up with a glow when a paycheck is confirmed,
    rolls down with no glow when an expense is added, and doesn't move
    on page load.
  - A save shows the leaves and the toast with Log again; the first save
    of the day shows "First one today", the second doesn't.
  - Each empty state renders with its button.
  - Drag lifts, slides and settles; keyboard moves are unchanged.
  - With reduced motion forced on: every effect shows its end state at
    once.
  - A screen reader reads the final Safe to Spend value, not the
    rolling digits.
  - tsc, eslint, full npm test.
Add a tester note (Sent: not yet, not before-deploy) for the next
What's new card. Report, then stop. Don't merge.
```

## Prompt for batch B

```
Batch B: step 7 of docs/Motion-and-Delight.md (The mark, alive). Own
branch off main.

PRECONDITION: batch A (feat/motion-and-delight-a) is merged into main.
If it isn't, stop and tell me.

REPORT FIRST, then build:
  - Does the app have a web app manifest, favicon/icon files, or an
    apple-touch-icon today? Where?
  - Where does the Sorrel mark's SVG live (SorrelMark.tsx)? Use THAT
    path for every icon — never redraw the mark.

BUILD:
1. LAUNCH BLOOM — cold start only:
   - The Brand Kit bloom: three leaflets, 900ms, staggered 110ms, using
     the motion tokens from batch A.
   - Once per browser session: a session cookie set by the client AFTER
     it plays. Nothing written by a render, nothing in the database.
   - It must NEVER delay the dashboard. The bloom overlays or precedes
     content that is already loading, and content shows the moment it's
     ready.
   - If loading passes 600ms, the flower breathes (scale 1 -> 1.035 over
     5s). NEVER a spinner anywhere this replaces one.
   - Reduced motion: the mark appears still, no bloom, no breathing.
2. APP ICONS, from the real mark:
   - Primary: gradient mark on ink (#0B0B12) with a faint warm glow
     BEHIND the mark, never on it.
   - Light: ink mark on #F4F1F5.
   - Small sizes (under 24px): flat coral, no gradient.
   - Gold variant: build it but don't wire it anywhere; it's for
     marketing.
3. HOME SCREEN: Next.js built-in conventions only — app/manifest.ts,
   app/icon, app/apple-icon, ImageResponse from next/og if PNGs must be
   generated. Sizes 180, 192, 512. NO new dependency. The apple icon has
   a solid background (iOS fills transparency with black). Manifest
   name "Sorrel", theme and background colour from the app's existing
   ink token.

VERIFY (I'll sign you in on dev):
  - A new browser session shows the bloom once; navigating and reloading
    in the same session don't.
  - Time until dashboard content appears is the same with and without
    the bloom. Report both numbers.
  - A slow load (throttle the network) shows breathing, no spinner.
  - Reduced motion forced on: still mark, nothing moves.
  - The manifest loads with no errors in DevTools (Application tab),
    and each icon size renders correctly.
  - tsc, eslint, full npm test.
Add a tester note (Sent: not yet, not before-deploy). Report, then
stop. Don't merge.
```

## Prompt for batch C

```
Batch C: step 5 of docs/Motion-and-Delight.md (Goals that grow). Own
branch off main. 

PRECONDITION: migration 70 (debt goals that follow a card) is merged to
main AND applied to production. If not, stop and tell me.

REPORT FIRST, then build:
  - Every place a goal meter renders (goals page, dashboard Goals card,
    goal detail, anywhere else). They must all become ONE component.
  - Which colour token CLAUDE.md allows for progress. The doc says gold;
    CLAUDE.md wins. Tell me what you're using.

BUILD — one GoalStem component:
  - A 10px track with the fill drawn by transform: scaleX(), never
    width. Colour from the token CLAUDE.md allows.
  - Leaves at 25%, 50%, 75%: passed = solid, not yet passed = outline in
    the muted text colour. A leaf unfurls once, 250ms with
    --ease-spring, when the fill passes it ON A CHANGE (useValueChange).
  - Going backwards (a debt goal after a new charge): the fill shrinks
    calmly over the same 700ms, and a leaf it falls below simply returns
    to outline with NO animation — nothing that reads as wilting or
    loss. No red, no direction words. "To go" stays the only line.
  - The fill grows over 700ms only when progress changes while on
    screen. Never on page load or navigation.
  - Completion: the existing SorrelFlower bloom, ONLY through the
    existing completion paths (detectCompletion and
    lib/goalCompletionCheck.ts). At rest: the open flower, static, beside
    "Reached on <date>" or "Paid off on <date>" (debt goals). No new
    bloom triggers.
  - Accessibility: role="progressbar" with aria-valuenow/min/max and an
    aria-valuetext like "72 percent, $560 to go". Leaves aria-hidden.
  - Reduced motion: final state at once, no unfurl.
  - Works identically for manual goals, goals with linked transactions,
    and goals that follow a card.

If anything needs a migration, a write-path change, or a change to how
progress is calculated: STOP and tell me. This is display only.

VERIFY (I'll sign you in on dev):
  - Adding a contribution grows the meter on screen; reloading shows it
    still, no animation.
  - Crossing 50% unfurls that leaf once; a reload doesn't replay it.
  - A charge on a followed card shrinks the meter calmly; the leaf it
    drops below changes with no animation; no red anywhere.
  - Completing a goal plays the bloom once; afterwards the resting
    flower and date show.
  - Reduced motion forced on: everything at its end state.
  - A screen reader reads the progress text, not the leaves.
  - Every meter location from your report uses the new component.
  - tsc, eslint, full npm test. Delete anything you created on dev.
Tester note (Sent: not yet, not before-deploy). Report, then stop.
Don't merge.
```
