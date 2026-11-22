# The dashboard sorrel: roselle that opens and closes

**The dashboard flower becomes a realistic roselle, the Jamaican sorrel. It has pale blush petals, a crimson eye, a gold centre, glossy deep-red calyces ("bulbs"), maroon stems and lobed green leaves. It opens with the morning and closes in the evening, playing once at each change. The design canvas board "Round 3 · The sorrel, alive" shows it.**

**Reference file:** `docs/design/roselle-reference.html` is the canvas board itself. It contains the exact SVG drawing (paths, gradients, colours) and the keyframes for opening and closing. Use the drawing exactly. The board loops its animations for viewing, so convert them to single-play.

The motion rules in `docs/Motion-and-Delight.md` apply throughout.

---

## Rules

1. **The red calyces must always be visible on the dashboard,** open or closed, at every screen width. They're what makes it unmistakably sorrel. At the sizes used:
   - the plant is at least **120px tall on desktop and 88px on a phone**;
   - every calyx is at least **14px tall** on screen;
   - nothing crops, hides or overlaps them;
   - if the space is too small for that, the plant scales down as a whole, never by dropping the calyces.
2. **The flower's own calyx shows when it's open too:** the red pointed sepals between the petals and the large crimson eye, as on the board.
3. **The logo stays the logo.** The three-leaflet mark is unchanged everywhere it's used as the brand (icons, sign-in, the welcome bloom, goal completion). Only the dashboard's living plant changes.
4. **Illustration colours are local constants.** These reds are a plant, not money, so the "red never describes money" rule isn't affected. Nothing about a figure changes colour.
5. **Never over a number or a control.**
6. Decorative: `aria-hidden`, not focusable.

## When it moves

- **Open from 7:00 to 18:59, closed from 19:00 to 6:59,** in the user's stored timezone, read from `lib/timeOfDay`. These are the same hours the dashboard flower uses today, so there's one source and no second clock.
- **It plays once per change, per device:** the first dashboard visit after the state changes plays the open or close animation. Every other visit shows it at rest. Keep this in localStorage (`sorrel-plant-seen` = `<local date>:<open|closed>`), inside try/catch. If storage is unavailable, show it at rest with no animation.
- **One at a time:** first the welcome bloom (when it plays), then the sorrel opens or closes (about 1.6 seconds), then the visitor arrives. The visitor currently waits at least 1.6s after mount, so make it wait for the plant instead.
- **Reduced motion:** at rest, open or closed for the time of day.
- **Transform and opacity only,** with CSS keyframes. No new dependency and no image files.

## The animation (single-play versions of the board's loops)

| | Duration | What happens |
|---|---|---|
| **Opening** | ~1.6s | The leaves lift slightly. The petals and sepals spiral open from the twisted bud, with a small overshoot and settle. The crimson eye fades and grows in. |
| **Closing** | ~1.6s | The eye fades. The petals and sepals twist shut into a pale bud sitting in its red calyx. The leaves relax down about 14°. |

The calyces on the stems don't animate. They're the constant.

## Light theme

On a light page, the pale petals need their thin outline stroke (as on the board) so they don't disappear. Check both themes.

## Also

- **Report first:** where the current dashboard flower lives, **why its open/close animation stopped** (find the change that did it and say what it was), and where the plant sits now relative to the greeting, the "Your Sorrel" button and the visitor's perch.
- **Storage:** list `sorrel-plant-seen` per the merge-gate rule. The privacy policy's "what you last saw" wording already covers it. Confirm that.

---

## The prompt (Sonnet), to run after the recurring-schedule bug fix ships

```
Read docs/Roselle.md in full, and docs/design/roselle-reference.html
(the design canvas board: use its SVG drawing exactly, convert its
looping keyframes to single-play). New branch off main. Display only:
if anything needs a migration, write path, dependency or image file,
STOP and tell me.

REPORT FIRST, then build:
  - Where the current dashboard flower lives and which component draws
    it.
  - WHY its open/close animation stopped: the change that did it, with
    the commit, and what it was trying to do.
  - Where the plant sits relative to the greeting, Your Sorrel button
    and visitor perch, at 1440, 1024 and 390px.

BUILD per the doc:
  - A Roselle component from the reference drawing: open and closed
    states, the flower's sepals and large crimson eye visible when open,
    the stem calyces ALWAYS visible, plant >= 120px tall desktop /
    88px phone, every calyx >= 14px tall on screen, nothing cropping
    them; scale the whole plant down rather than drop calyces.
  - State from lib/timeOfDay in the user's zone: open 7:00–18:59.
  - Plays once per change per device (sorrel-plant-seen); otherwise at
    rest. Waits for the welcome bloom; the visitor waits for the plant.
  - Reduced motion: at rest. Transform/opacity only.
  - Petal outline kept for the light theme.
  - The three-leaflet mark unchanged everywhere else.
  - List the localStorage key; confirm the policy wording covers it.

VERIFY (I'll sign you in on dev; if screenshots time out, tell me and
I'll check visually):
  - Unit tests: open/closed at 6:59, 7:00, 18:59, 19:00 in two zones;
    plays once; storage unavailable; reduced motion.
  - Browser: clear sorrel-plant-seen and reload -> it animates once,
    then the visitor arrives; reload -> at rest.
  - The calyces clearly visible open and closed at 1440, 1024 and
    390px, both themes, not overlapping any number or control.
  tsc, eslint, full npm test. Tester note (Sent: not yet, not
  before-deploy). Report, then stop. Don't merge.
```
