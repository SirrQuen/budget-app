# The whole dashboard in the scene

**The time-of-day scene stops being a banner and becomes the dashboard's backdrop, like the weather app:**
- **At the top:** the scene shows clearly, with the greeting above the sky and the roselle and visitor on the hill.
- **Below the hills:** plain ground continues to the bottom of the screen, so there's always landscape behind the cards.
- **The tiles and charts:** they sit on frosted cards and read exactly as clearly as they do today.
- **When you scroll:** as the cards move over the hills, the scene softens and dims a little.

The design canvas board "Round 3 · The whole dashboard in the scene" shows it.

**Reference file:** `docs/design/backdrop-reference.html` is that board. It contains the phone and desktop layouts, the glass card styles, the ground gradients and the scrolled state. It builds on `docs/Scenes.md` and the scene component that shipped with it. Reuse that component; don't redraw it.

The rules in `docs/Motion-and-Delight.md`, `docs/Scenes.md`, `docs/Roselle.md` and `docs/Visitors.md` still apply, except where this doc changes them.

---

## Rules

1. **Numbers come first.** Every tile, figure, chart, bar and control is at least as readable as today, in all 8 scenes (4 times of day × 2 themes), at the top and when scrolled, at 390, 768, 1024 and 1440px.
   - Text on a card: **4.5:1 or better**, measured against the actual mix of card and scene behind it at the worst spot, muted text included.
   - Chart lines, bars, icons and focus rings: **3:1 or better.**
   - If anything falls short, make the card more opaque. Never change a text, chart or figure colour.
2. **Dashboard only.** The other pages are unchanged.
3. **The desktop sidebar stays solid.** The backdrop fills only the main area. On a phone it fills the whole screen behind the content.
4. **Things that open on top stay solid:** menus, popovers, dialogs, toasts, the logging form and the drag-and-drop lift (Step 6). Only the dashboard's tiles and the phone's existing top bar turn to glass.
5. **The scene never moves by itself.** The one change you can see is tied to scrolling: the scene softens and dims as the cards cover the hills. It stops when scrolling stops. The cross-fade when the time of day changes (Scenes.md) now applies to the whole backdrop.
6. **Opacity and transform only.** Never animate `filter` or `backdrop-filter`. The blurred version of the scene is a second, static copy that fades in (see How to build it).
7. **No images, no new dependency, no new storage.** If you need any of them, STOP.
8. **Decorative.** The backdrop is `aria-hidden` and not focusable. The visitor stays tappable at the top of the page, as Visitors.md describes.

### Changed from earlier docs

- **Roselle.md, rule 1:** the red calyces must be fully visible **when the dashboard is scrolled to the top**. When you scroll, cards may pass over the plant. The size rules still apply.
- **Scenes.md:** the scene is no longer a banner with a bottom fade. It's the top of a full-height backdrop. The words-above-scenery arrangement below 1024px stays, and so does the scrim behind the greeting on wider screens.

## What the backdrop is made of (top to bottom)

1. **Sky extension:** a plain fill above the scene in the sky gradient's first colour, so the sky reaches the top of the screen without a seam.
2. **The scene band:** the shipped scene component, unchanged, with the plant and visitor standing on its near hill.
3. **Ground:** from the scene's near-hill colour down to the bottom, a three-stop gradient (0%, 45%, 100%). Two very soft, wide ellipses in the top part of the ground hint at a meadow. Their colour is `rgba(255,255,255,.05)` in dark and `rgba(255,255,255,.28)` in light. There is no other detail in the ground; it sits behind the cards, so it stays calm.

| Scene | Ground 0% | 45% | 100% |
|---|---|---|---|
| Morning dark | `#1E2638` | `#151B2A` | `#0E1119` |
| Morning light | `#A9B9C9` | `#C3CFDB` | `#E2E8EF` |
| Afternoon dark | `#173342` | `#10232F` | `#0B141B` |
| Afternoon light | `#97BBA2` | `#B7D0BE` | `#DCE9DF` |
| Evening dark | `#22152C` | `#181020` | `#0F0A15` |
| Evening light | `#B49CBD` | `#CBB8D2` | `#E6DCE9` |
| Night dark | `#0B1022` | `#080B17` | `#06080F` |
| Night light | `#9EA8D4` | `#BAC2E2` | `#DDE1F2` |

The board shows four of these. The other four follow the same pattern. Like the scene, the colours are illustration constants set through the per-theme CSS variables the scene already uses.

## Glass cards

| | Dark | Light |
|---|---|---|
| Fill | the card token at **95%** (was 78%; see Rulings) | the card token at **92%** (was 82%; see Rulings) |
| Border | `rgba(255,255,255,.10)` | `rgba(11,11,18,.08)` |
| Shadow | none | `0 6px 18px rgba(60,40,80,.10)` |
| Blur | **none** (was `backdrop-filter: blur(16px) saturate(140%)`; see Rulings) | none |

- **Mix from the card token** (for example `color-mix(in srgb, var(--card) 78%, transparent)`), not a hard-coded hex, so it follows the theme.
- **Fallbacks:** cards are **solid** (exactly as today) when:
  - `color-mix()` isn't supported (`@supports`);
  - `prefers-reduced-transparency: reduce` is set;
  - forced colours are on;
  - printing.
- **The phone's top bar,** if the dashboard already has a sticky one, gets the same glass: dark `rgba(11,11,18,.55)` and light `rgba(255,255,255,.6)`, each with `blur(14px)`. **Don't add a new sticky bar** if there isn't one.

## How to build it

- **One fixed layer** behind the dashboard content, covering the main area, using `height: 100lvh` so it doesn't jump or leave a gap when a phone's address bar hides and shows. Rubber-band overscroll shows sky at the top and ground at the bottom, never a bare edge.
- **Where the scene sits:** at the top of the page, the backdrop must line up with the layout exactly as on the board. The greeting sits in the sky, the first card starts just below the hill, and the plant stands on the hill. On phones the greeting area keeps a fixed minimum height, so the scene sits in the same place every load. If a long name wraps to two lines, it extends into the plain sky above the scene, so check its contrast there too.
- **Softening on scroll:** stack a second, **static** copy of the backdrop with `filter: blur(8px)`, plus a dim overlay: page background at 22%, dark or light. Their opacity goes from 0 at the top to 1 once the first card reaches the top of the hills, which is about 240px of scrolling on a phone (measure it per breakpoint).
  - Where `animation-timeline: scroll()` is supported, use it for this, behind `@supports`.
  - Elsewhere, an IntersectionObserver on a marker toggles a class with a 250ms opacity transition. No per-frame scroll handlers.
  - It must follow whichever element actually scrolls (the window or the app's main container). Report which it is.
- **Reduced motion:** no softening. The scene stays sharp and still.
- **Taps:** the backdrop has `pointer-events: none`, except for the visitor. Any empty space in the content above the first card must not block taps on the visitor.
- **New users:** the dashboard with accounts but no transactions gets the backdrop. The onboarding steps stay plain, as decided in the scenes branch.

## Speed

Frosted glass over a full-screen layer costs phone power. Matt checks it on his Samsung (Android Chrome) and an iPhone if one's available.

- **The test:** scroll the whole dashboard top to bottom and back, quickly, in each theme. It must feel as smooth as today.
- **In DevTools:** with 4× CPU throttling, record a scroll and report any frames over 16ms, and what caused them.
- **If it stutters,** report first, then try these in order:
  1. reduce the card blur to 8px;
  2. turn off `backdrop-filter` on phones and use the card token at 90% there.

  Don't pick one on your own without showing the numbers.

## Also

- **Report first:**
  - which element scrolls on the dashboard;
  - how the scene is mounted now and how it would move into a fixed layer;
  - whether the phone has a sticky top bar;
  - every element that sits on top of the dashboard (rule 4 list) and confirmation that each stays solid;
  - whether `feat/scenes` is on `origin/main`. **If not, STOP.**
- **Storage:** none.
- **Tester note:** Sent: not yet, not before-deploy.
- **What's new:** "The scene now fills your whole dashboard. Scroll down and it softens behind your numbers." It replaces the scenes line, so there's one line about the landscape, not two.

## Rulings, 2026-11-25

These replace anything above they disagree with.

### Glass = tinted cards over the softened scene, no backdrop-filter

The cards are the card token mixed with transparency (95% dark, 92% light) and nothing else: **no `backdrop-filter`, at any width.** The frosted look comes from the scene behind them, which softens (static blurred copy + 22% dim) as the cards scroll over it. The softening stays.

Why, measured on dev at 390px (desktop Chrome, no CPU throttle, an iframe at the width; a fast scroll top to bottom and back, about 95 frames each; counts are frames over 20ms per run):

| | Runs |
|---|---|
| main | 0, 0, 0, 0, 0, 0 |
| cards with `blur(16px) saturate(140%)` | 4, 3, 2 |
| ... with the softening switched off | 6, 3, 4 |
| ... with the card blur at `8px` | 6, 4, 6 |
| ... with the card blur switched off | 0, 0, 0 |
| **as shipped: no card blur, softening on** | 0, 0, 1 · 0, 0, 0 · 0, 1, 2 · 2, 0, 0 · 0, 0, 0 |
| as shipped, softening switched off | 3, 0, 1 · 0, 0, 0 |

The card blur caused the dropped frames, and 8px was no better. Without it, a run is usually clean; the occasional single 33ms frame is the same with the softening off, so it isn't the softening. The DevTools recording with 4x CPU throttle could not be run from the agent; it is Matt's phone check.

### Card opacity, measured without the card blur

Every pixel a card can cover over the rasterised backdrop (sharp scene and plant, plus the softened copy at the scroll's progress), top and scrolled, all 8 scenes, at 390, 768, 1024 and 1440. Text needs 4.5:1 (muted is the worst), chart lines, bars, icons and control edges 3:1.

| Cards | Worst text | Worst graphic |
|---|---|---|
| dark 78% (this doc's first value, with card blur) | 3.17 | 2.15 (green series) |
| dark 95% | **4.54** | **3.09** (green series) |
| light 82% | 3.97 | 2.64 (control border) |
| light 92% | **4.64** | **3.08** (control border) |

Without blur, the scene's sharp details (the birds, the trees, the roselle's dark stems and calyces) show through, so light needed raising too; 91% passes by 0.07 and 0.03, so 92%. At scroll 0 every scene passes at both values. Approved by Matt.

### Scrim behind the words, 1024px and up

On a strict per-pixel check (secondary ink against every pixel inside the date's and greeting's glyph boxes, and the pill text against its 70% page backing), the shipped scrims already pass with the real greeting in all 8 scenes at 1024, 1440 and 1920 (worst 5.49:1). A longer name moves the greeting's end right, over brighter sky: with the shipped scrims the greeting passes to about 280px into the banner. Raising **morning dark and afternoon dark from 0.5 to 0.6** carries that to 320px (about 40 characters) in every scene; the others pass there unchanged. Past about 360px a greeting meets the night stars and the sun, which no scrim short of opaque fixes: a very long name there is a known limit, not tuned for.

### Also

- Light cards 92% and dark 95%: approved.
- The desktop quick-add bar stays solid over the backdrop.
- The fallback softening (no scroll timelines) was checked by forcing it locally: the class turns on half way along the softening distance and the opacity takes 250ms each way.

---

## The prompt (Opus)

This one goes to Opus. It has fixed layers, the right scroll container, fallbacks and phone speed to get right, and those are easy to get subtly wrong.

```
Read docs/Backdrop.md in full, and docs/design/backdrop-reference.html
(the design canvas board). Re-read docs/Scenes.md, docs/Roselle.md and
docs/Visitors.md. New branch off main. Display only: if anything needs
a migration, write path, dependency, image file, cookie or localStorage
key, STOP and tell me.

REPORT FIRST, then build:
  - Is feat/scenes on origin/main? If not, STOP.
  - Which element scrolls on the dashboard (window or a container).
  - How the scene and plant/visitor are mounted now, and how you'll
    move them into one fixed backdrop layer.
  - Does the phone layout have a sticky top bar?
  - Everything that renders on top of the dashboard (menus, popovers,
    dialogs, toasts, logging form, drag lift): confirm each stays
    solid.

BUILD per the doc:
  - Fixed backdrop behind the dashboard main area only (sidebar stays
    solid), height 100lvh: sky extension, the shipped scene, ground
    gradient from the doc's table for all 8 scenes, two soft ellipses.
    No seam at the top or bottom, including on overscroll.
  - Lines up at scroll 0 as on the board: greeting in the sky, first
    card just below the hill, plant on the hill, visitor tappable.
  - Glass tiles: card token at 78% dark / 82% light via color-mix,
    border/shadow/blur per the doc. Solid when backdrop-filter is
    unsupported, prefers-reduced-transparency, forced colours, print.
    Existing sticky phone bar (if any) gets the glass; don't add one.
  - Softening: static blurred copy + 22% dim overlay, opacity 0 -> 1
    over the scroll to the hills. animation-timeline: scroll() behind
    @supports; else IntersectionObserver class toggle, 250ms opacity.
    Never animate filter/backdrop-filter. Reduced motion: no softening.
  - Dashboard only. New users with accounts but no transactions get it;
    onboarding steps stay plain.
  - Roselle rule 1 now applies at scroll 0 only; update docs/Roselle.md
    and docs/Scenes.md with the doc's "Changed from earlier docs" lines.
  - whatsNew line replaces the scenes line.

VERIFY (I'll sign you in on dev; if screenshots time out, tell me and
I'll check visually):
  - Contrast table: card text (normal and muted) >= 4.5, chart lines,
    bars and icons >= 3, at the worst spot behind each card. All 8
    scenes x top and scrolled x 390/768/1024/1440. Fix only by raising
    card opacity.
  - Browser: alignment at scroll 0 at all four widths; softening tied
    to scroll and stops when scrolling stops; reduced motion shows no
    softening; reduced transparency shows solid cards; the visitor is
    tappable at the top; menus, dialogs and toasts are solid; drag and
    drop still works.
  - Speed: DevTools performance recording of a fast scroll with 4x
    CPU throttle at 390. Report frames over 16ms and their cause. If it
    stutters, STOP with the numbers before choosing a fallback.
  tsc, eslint, full npm test. Tester note (Sent: not yet, not
  before-deploy). List storage (none). Commit on the branch, merge to
  main locally, then stop and tell me. Don't push.
```

After Claude Code merges, test it on your phone **before** pushing, on dev (localhost on your network, or a Vercel preview). Scroll the whole dashboard quickly in both themes. If it feels slower than today, don't push. Send me the speed numbers first.
