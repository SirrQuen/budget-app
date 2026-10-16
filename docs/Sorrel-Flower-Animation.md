# The Sorrel flower — folding, not shrinking

**The dashboard flower, made dimensional. No 3D library, no new dependency.**

---

## The idea the whole spec rests on

Wood sorrel is **nyctinastic**. Its leaflets fold downward at dusk and open again at dawn — a real, observable motion in the real plant the app is named after.

Your dashboard flower is already depicting this. It just isn't moving like it.

The current open/closed states almost certainly differ by scale: a big flower and a small flower. The plant doesn't do that. Each leaflet **hinges downward at its base**, so a closed sorrel is not a smaller flower — it's a narrower, taller one, with the leaflets hanging like a shut umbrella and the stem showing beneath.

Everything below follows from that one correction.

---

## Why this gets you depth without 3D

**Do not reach for WebGL, three.js or CSS `perspective`.** Three reasons, in order of weight:

1. A fold about a horizontal hinge, viewed from slightly above, projects to **exactly** a `scaleY` anchored at that hinge. The correct motion already looks dimensional. You don't need perspective; you need the right pivot.
2. It would be the only 3D element in Sorrel, which breaks the single motion signature you just established across eight navigation icons.
3. Bundle weight and battery, on the one element that renders on every dashboard load.

What you want is **dimensional**, not 3D. Those are different, and the second one is a trap.

### The four depth cues available to you

Ranked by how much read they give per unit of effort:

| Cue | How |
|---|---|
| **Differential timing** | Back petals lead, front petals trail by 80–120ms. This is the strongest cue by a distance. Objects at different depths don't move in lockstep. |
| **Hinge-anchored foreshortening** | `transform-origin` at the petal's base, `scaleY` toward 0. This *is* the projection of a rotation. |
| **Arc, not line** | A few degrees of `rotate` during the fold, so the tip traces a curve. A straight drop reads as flat. |
| **Static surface shading** | A fixed gradient per petal, lighter at the hinge, darker at the tip. Never animate the fill — the gradient does its work by being there while the shape moves. |

Note what's absent: no animated shadows, no changing z-order, no blur. All expensive, all unnecessary.

---

## The two states

### Open — day

What you have now: the brand mark's silhouette, unchanged. The stem is not visible.

### Closed — night

**The invariant, not a number.** Open is WIDER than it is tall. Closed is TALLER than it is wide. The silhouette inverts its aspect ratio; that is what reads as a fold rather than a shrink. Absolute height is not a constraint.

Acceptance, measured from rendered pixels in viewBox units:

1. Open bbox unchanged from the mark: 93.5 × 84.5, w/h > 1.
2. Closed h/w ≥ 1.4 — clearly tall, not square.
3. Closed width ≤ 55% of open width.
4. Stem invisible open, visible closed.
5. Both states recognisably the same three-leaflet plant.

As built (2026-10-16): closed 36.4 × 70.9, h/w 1.95, 38.9% of open width. Leaflets hinge at the junction (50,50) and hang from it: the back leaflet folds through the hinge (scaleY 1 → −0.8), the front pair swing down to 10° either side of vertical, all three creased along the midrib (scaleX 0.5), the group lifted 6 units to stay centred.

> **Why the original numbers were replaced — don't reinstate them.** This section first asked for petals folded to 12–18% of their height and a closed silhouette taller than open, with a 25–30% stem below the junction. That assumed a SIDE view. The mark is drawn TOP-DOWN, with the leaflets radiating from a junction in the middle of the shape, where folding away from the viewer projects as radial foreshortening: a smaller shape with the same proportions. Built to those numbers the closed flower measured 52 × 48 against 93.5 × 84.5 — exactly the "small flower" the callout below forbids. Nothing hinged at the centre can end up taller than open without a stem nearly the flower's full height. The spec forbade its own outcome; the aspect-ratio invariant above is what it was reaching for.

> **The closed flower must not read as a small flower.** If a user could mistake it for the same shape at a lower zoom, the fold hasn't worked. Different silhouette, same identity.

---

## The stem

It rises from the junction. In the open top-down view it is occluded by the leaflet spread and not visible — so **the open state is unchanged from today**. It is revealed as the leaflets fold down past it. A closed umbrella: pole up, leaflets hanging around it.

- **Width:** 2px at icon scale (8.33 viewBox units), scaling with the flower.
- **Shape:** one slight curve, not straight. A straight line reads as a stick; a curve reads as grown.
- **Open state:** not visible. It lies inside leaflet 1, and also rests at opacity 0, because the three leaflet tips meet at the junction in anti-aliased seams it would otherwise show through (up to 19 pixels at 56px, measured).
- **Closed state:** fully visible above the hanging leaflets.

(This replaced a "25–30% below the junction" rule — see the note under "Closed — night" for why.)

The stem is also the only element that should carry **idle motion** — see "Waiting" below.

---

## Timing, and the rule that does NOT carry over

The navigation icons are 360ms because **they sit in front of a navigation**. Every millisecond is a millisecond the user waits.

The flower blocks nothing. It's a state display. So the constraint is inverted: a slow, organic fold is *better* here, and copying the 360ms figure across would make the flower feel mechanical.

```css
:root {
  --flower-fold-duration: 820ms;
  --flower-petal-stagger: 100ms;
  --flower-ease:          cubic-bezier(.34, .02, .24, 1);
}
```

Same easing curve as the mark's fold and the navigation icons. **One motion signature for the whole app** — the flower is slower, not different.

Total elapsed including stagger: roughly 1.1s for a three-petal flower. That is fine for something nobody is waiting on.

---

## Waiting is a different verb from folding

This is the part most likely to go wrong, so it gets its own section.

If the flower is **also** your loading indicator, and loading plays the open/close animation, then a user who sees it animate cannot tell whether the app is working or the sun just went down. Two meanings, one motion, no way to distinguish.

**Separate them:**

| | Motion |
|---|---|
| **Day → night, or night → day** | The fold. Plays once, on the state change. |
| **Waiting for data** | A slow sway at the stem, 2–3° either side, looping. The flower stays in whatever state it's in. |

The sway is also the better loading indicator on its own merits: it looks correct at any duration. A fold that takes 820ms looks broken when the data arrives in 200ms, because the user sees a half-finished motion snap. A loop doesn't have that problem — you can cut a sway at any frame.

**And the fold must survive being cut short anyway.** Same rule as the navigation icons: if the component unmounts mid-animation, that's fine and no error should result.

---

## Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  /* No fold. No sway. The flower renders in its correct resting state —
     open or closed — and simply changes when the state changes. */
}
```

Not a faster animation. **No animation.** You've just completed an accessibility pass; don't open a new failure in it.

---

## The brand mark does not change

The login screen's mark, the favicon, the OG image and anything Satori renders stay **exactly as they are**. No stem, no fold.

The dashboard flower is a separate component that shares the petal geometry. A stem is an addition to one surface, not a change to the brand.

If you find yourself editing the file the login page imports, you've gone wrong.

---

## Implementation

**Inline SVG React component, CSS keyframes, no animation library.** Identical reasoning to the navigation icons, and you already have the pattern.

- `currentColor` only resolves on inlined SVG. Not `next/image`, not Satori. You learned this with the mark.
- **Transform and opacity only.** The gradients are static; only transforms (and the stem's opacity) animate.
- **Don't remount or change `key` to restart the animation.** That fights reconciliation and is how this project produced `removeChild` errors before.
- `transform-origin` per petal, at its hinge. Getting this wrong is the single most likely cause of the fold looking like a shrink — verify it visually before tuning anything else.
- Three petals is the likely geometry; if there are four, the stagger order runs back-to-front, not clockwise.

---

## The prompt

*Kept as originally given. Its CLOSED STATE and STEM lines are superseded by "The two states" and "The stem" above; build to those.*

```
Make the dashboard Sorrel flower fold rather than shrink, and show its stem.

READ Sorrel-Flower-Animation.md in full before writing anything.

THE CORE CHANGE: wood sorrel is nyctinastic — its leaflets fold DOWNWARD at
night, hinged at the base, and the closed plant is NARROWER AND TALLER than
the open one, with the stem visible beneath. The current closed state is
almost certainly a scaled-down flower. That is the thing to replace.

FIRST, REPORT BEFORE BUILDING:
  - Where the dashboard flower component lives, and whether it shares a file
    with the brand mark used on /login. If they share a file, say so and stop
    — the mark must not change.
  - How open vs closed is currently expressed (scale? opacity? two paths?).
  - Whether the flower is also used as a loading indicator, and what it does
    while loading.
  - How many petals the geometry has.

THEN BUILD:

DEPTH WITHOUT 3D. No WebGL, no three.js, no CSS perspective. A fold about a
hinge projects to scaleY anchored at that hinge — the correct motion already
reads as dimensional. Depth comes from:
  1. Differential timing — back petals lead, front trail by 80-120ms
  2. transform-origin at each petal's base (GET THIS RIGHT FIRST — if the
     pivot is wrong the fold looks like a shrink and nothing else will save it)
  3. A few degrees of rotate during the fold, so the tip traces an arc
  4. A STATIC gradient per petal, lighter at the hinge. Never animate fill.

CLOSED STATE: petals at 12-18% height, rotated inward 6-10°, stem visible.
The silhouette must be narrower and taller than open, not smaller.

STEM: 25-30% of flower height below the petal junction. 2px at icon scale.
One slight curve, not straight.

TOKENS:
    --flower-fold-duration: 820ms
    --flower-petal-stagger: 100ms
    --flower-ease:          cubic-bezier(.34, .02, .24, 1)

The easing is the app's existing curve. The flower is SLOWER than the nav
icons (360ms), not different — the nav timing is short because it precedes a
navigation; the flower blocks nothing.

TWO SEPARATE MOTIONS — do not conflate:
  - Day/night change  → the fold, plays once
  - Waiting for data  → a slow stem sway, 2-3° either side, looping, flower
                        stays in its current state
If one motion means both things the user cannot tell whether the app is
working or the time changed.

CONSTRAINTS:
  - Transform and opacity only. No width/height/top/left.
  - Inline SVG React component. currentColor does not resolve otherwise.
  - Do NOT remount or change keys to restart animation.
  - prefers-reduced-motion: NO animation at all. Correct resting state only.
  - The /login mark is untouched. No stem, no fold.
  - The fold must survive being cut short by an unmount without throwing.

VERIFY and report:
  - Screenshot both states, both themes, at dashboard size and at 24px.
  - Confirm the closed silhouette is taller and narrower than the open one —
    give me the bounding box of each.
  - Performance profile during the fold: compositor only, no layout, no paint.
  - Reduced motion on: no animation, correct state rendered.
  - The /login mark renders identically to before — diff the screenshot.
  - Bundle size added. More than ~2KB gzipped means something is wrong.
```

---

## One note on why this is worth doing

Every other animation in Sorrel describes an action the user took. This one describes the app's own character — the brand behaving rather than sitting still.

That's where the "video game appeal" intent actually belongs: on the thing that makes the product feel alive, not on a badge that rewards someone for spending money.
