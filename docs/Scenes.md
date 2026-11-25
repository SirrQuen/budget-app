# A scene for every part of the day

**The dashboard banner becomes a small painted landscape for the time of day: morning, afternoon, evening or night. Each scene has sky, a sun or moon, distant mountains, two layers of hills, trees, mist, and birds or stars. The roselle stands on the near hill, and the day's visitor perches on it. Each scene is drawn twice: deep for the dark theme and airy for the light theme. It has no edge. It melts into the page background at the bottom and sides, so the cards below sit on the same ground. It replaces the Step 8 glow. The design canvas board "Round 3 · A scene for every part of the day" shows all eight.**

**Reference file:** `docs/design/scenes-reference.html` is the canvas board itself. It contains every scene's SVG: paths, gradients, colours, the scrim and the masks. Use the drawings exactly. The board's `.ban::after` strip only stands in for the cards, so don't build it.

The motion rules in `docs/Motion-and-Delight.md` apply throughout. `docs/Roselle.md` and `docs/Visitors.md` still apply to the plant and the visitor.

---

## Rules

1. **One clock.** Which scene shows comes from `lib/timeOfDay`, the same function that picks the greeting, in the user's stored timezone:
   - morning 5am–noon;
   - afternoon noon–5pm;
   - evening 5pm–10pm;
   - night 10pm–5am.

   The greeting and the scene can never disagree. The roselle keeps its own open and closed hours (open 7:00–18:59) from the same module. So between 5:00 and 6:59 the morning scene shows a closed bud that's about to open, and between 17:00 and 18:59 the evening scene shows it still open. That's intended.
2. **Always readable.** The date, the greeting and the Your Sorrel pill keep **4.5:1 or better** against what is actually behind them, in all eight scenes, at 1440, 1024 and 390px.
   - The left-side scrim on the board does this. If any measurement falls short, strengthen that scene's scrim.
   - Never change the text colours or the drawings to fix contrast.
   - Report every ratio.
3. **Melts into the page, using the page's own colour.**
   - The banner has **no background colour of its own.** The scene is masked to transparent at the bottom (fade from 74% to 97% of the height) and at both sides (the outer 2.5%), so what shows through is the real page background token in each theme.
   - Don't hard-code `#0B0B12` or `#F4F1F5`. Those are only the board's stand-ins.
   - No border, no box shadow and no visible seam at any width.
4. **Still, not busy.** Nothing in the scene moves: no drifting clouds, no twinkling, no loops.
   - The only motion is a **single cross-fade of about 600ms** (`--ease-*` token, opacity only) when the part of the day changes **while the dashboard is open**.
   - Schedule one timer for the next boundary (no polling) and clear it on unmount.
   - On load, the current scene simply appears.
   - Reduced motion: the new scene replaces the old one with no fade.
5. **Never over a number or a control.** The scene is the banner's backdrop only. The cards, tiles and figures below it are untouched.
6. **Decorative.** `aria-hidden`, not focusable, and no text inside the SVG. The greeting stays real text, with the same heading level as today.
7. **Illustration colours are local constants,** like the roselle's. They aren't theme tokens, and "red never describes money" isn't affected. Nothing about a figure changes colour.
8. **No images, no new dependency, no new storage.**
   - Inline SVG drawn in code.
   - No cookie, and no localStorage key. The cross-fade only needs to know the band the page rendered with.
   - If you find you need storage, STOP.

## How to build it

- **One SVG per band, themed with CSS variables.** Dark and light versions of each scene share the same shapes; only the fills differ. (The night pair may differ slightly: report it if so.) So render one SVG for the current band, and take each fill and gradient stop from a custom property (e.g. `--scene-sky-1`) defined under the light and dark theme selectors. Switching themes then swaps colours instantly with no second SVG and no flash. Only the current band is in the DOM, plus the outgoing one during a cross-fade.
- **Rendered on the server** for the band in the user's stored timezone, the same way the greeting is now, so there's no flash of the wrong scene on load.
- **Scaling:** use `preserveAspectRatio="xMaxYMax slice"`. The board uses `none` only for the mockup; on the real page that would stretch the sun and moon into ovals.
  - With `slice`, the right-hand detail (the sun or moon, the trees and the plant's hill) is always kept.
  - Narrow screens crop from the left, behind the greeting.
  - Very wide screens crop sky from the top. That's fine, but check that the sun, moon and mountains stay in view at 1440px and above.
- **Height:** 300px on desktop, as on the board. Propose the 1024 and 390px heights in the report. Shorter on a phone is fine, as long as the plant meets Roselle.md's sizes (88px tall, calyces 14px) without covering the greeting or the pill.
- **The plant stands in the scene.** The roselle's base sits on the near hill (the board places it 92px from the right and 40px from the bottom). The visitor perches on the plant, not on the twig beside the greeting.
  - Update the perch point from Visitors.md.
  - The visitor's arrival, keys and timing are otherwise unchanged.
  - Check the base still looks grounded at all three widths, because with `slice` the hill's height on screen changes with the width.
- **The seasonal leaf** beside the greeting stays as it is, unless the report shows it now crowds the scene. If it does, say so and propose a fix; don't remove it on your own.
- **Removed:** the Step 8 glow (the four radial glows). The scene replaces it, so take out its code and styles rather than layering both.
- **Forced colours** (`@media (forced-colors: active)`) and **print:** hide the scene. The greeting shows as plain text.
- **Weight:** each scene is about 2.5KB of SVG. Keep the shipped component under about 25KB of markup across all four bands.

## Light theme

On light pages, the airy palettes on the board already keep the ink text above 4.5:1. The petal outline from Roselle.md still applies. Check that the night-light scene (pale lavender sky with a moon) doesn't read as daytime next to the "Hi, night owl" greeting. If it does, flag it and I'll adjust the board.

## Also

- **Report first:**
  - what the banner is now (component, height at three widths, its background);
  - where the Step 8 glow is drawn;
  - whether Roselle and Visitors are on main yet;
  - where the seasonal leaf, Your Sorrel pill, plant and visitor sit at 1440, 1024 and 390px.

  If Roselle isn't on main, build the scene with the current plant in the same spot. The roselle drops in later.
- **Storage:** none. Confirm in the report.
- **Tester note:** Sent: not yet, not before-deploy. Add a What's new line: "Your dashboard now has a little landscape that follows the time of day."

---

## The prompt (Sonnet)

```
Read docs/Scenes.md in full, and docs/design/scenes-reference.html
(the design canvas board: use its eight SVG scenes exactly; ignore
the .ban::after card strip). Also re-read docs/Roselle.md and
docs/Visitors.md. New branch off main. Display only: if anything
needs a migration, write path, dependency, image file, cookie or
localStorage key, STOP and tell me.

REPORT FIRST, then build:
  - The current dashboard banner: component, height at 1440/1024/390,
    and its background.
  - Where the Step 8 glow is drawn (files, styles).
  - Whether Roselle and Visitors are merged to main.
  - Where the seasonal leaf, Your Sorrel pill, plant and visitor sit
    at 1440, 1024 and 390px. Propose banner heights for 1024 and 390.

BUILD per the doc:
  - Band from lib/timeOfDay in the user's stored zone (the same call
    as the greeting). Server-rendered, no flash.
  - One SVG per band; fills from CSS custom properties per theme;
    only the current band in the DOM. preserveAspectRatio
    "xMaxYMax slice", not "none".
  - Banner has no background; scene masked to transparent (bottom
    74%->97%, sides 2.5%) so the real page token shows. No seam.
  - Scrim on the left; text, date and pill >= 4.5:1 in all 8 scenes
    at all 3 widths. Fix by strengthening the scrim, never by
    changing text colours.
  - Single ~600ms opacity cross-fade only when the band changes while
    the page is open (one timer to the boundary, cleared on unmount).
    Load: no animation. Reduced motion: instant swap.
  - Roselle stands on the near hill; visitor perches on the plant.
    Roselle.md sizes still hold.
  - Remove the Step 8 glow. Keep the seasonal leaf unless it crowds
    (then propose, don't remove).
  - aria-hidden; hidden in forced-colors and print.

VERIFY:
  - Unit tests: band at 4:59, 5:00, 11:59, 12:00, 16:59, 17:00,
    21:59, 22:00 in America/New_York and Pacific/Auckland, and the
    greeting and scene agree at each; the cross-fade timer fires once
    at the boundary and is cleared on unmount.
  - Browser on dev (I'll sign you in; if screenshots time out, tell
    me and I'll check visually): all 4 bands x both themes x 1440,
    1024, 390. To see other bands, change MY dev timezone, check, and
    CHANGE IT BACK. No visible edge or seam; sun/moon round; plant
    grounded; nothing over a number or control.
  - Contrast table: date, greeting and pill text for all 8 scenes x 3
    widths, measured against the actual pixels behind them.
  - Reduced motion forced in DevTools: no fade.
  tsc, eslint, full npm test. Tester note (Sent: not yet, not
  before-deploy) and the whatsNew line. List storage (none). Report,
  then stop. Don't merge.
```

## Rulings, 2026-11-25

These replace anything above they disagree with.

- **Below 1024px the words sit above and the scenery below them** (ruled at 768px first, then raised: the overlaid layout failed contrast from 768 to about 900), with no backing behind the text. At most 280px tall on a 390px screen. The narrow banner's crop put the sun and birds behind the words.
- **The top edge fades too**, over about the top 8%.
- **Sun and bird positions** are the corrected board's. The first board drew the morning and evening suns behind the mountains.
- **A dashboard with accounts but no transactions gets the scene.** The onboarding steps stay plain.
- Approved as built: the date line, the "Dashboard" heading, the translucent Your Sorrel pill, the plant at 120px, What's new merged into the plant line. The light night stays as it is for now.

## Changed by docs/Backdrop.md, 2026-11-25

- **The scene is no longer a banner with a bottom fade.** It's the top of a full-height fixed backdrop behind the whole dashboard: plain sky above it, the shipped scene, then ground to the bottom of the screen. The banner keeps the words and an empty slot the backdrop lines its scene up with at scroll 0. The sides and bottom are no longer masked (the near hill runs straight into the ground); the top fades into the plain sky.
- **The words-above-scenery arrangement below 1024px stays,** now with the plain sky behind the words, and so does the scrim behind the greeting on wider screens.
- **"Never over a number or a control" (rule 5)** now holds at scroll 0. When you scroll, the cards pass over the scene on frosted glass.
