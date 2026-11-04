# Navigation icon animations

> **Historical spec (sent 2026-10-12, added to the repo 2026-11-03).** Kept for
> the reasoning behind decisions. It describes work as planned, not as it
> stands: the code, CLAUDE.md and docs/phase-7-findings.md are the authority
> where they differ.

**Each menu icon performs its own verb when you click it.**

---

## Two rules that decide whether this works

### 1. The animation never delays the navigation

The obvious implementation — play the animation, then navigate — adds its duration to **every navigation for the life of the app.** Four hundred milliseconds is delightful once and infuriating by the fiftieth time, and it is exactly how an app earns a reputation for feeling sluggish.

So: **the click navigates immediately.** The icon animates during the transition that is already happening — the App Router round trip and the `loading.tsx` state. The animation fills time you are already spending.

If the destination renders in 80ms, the animation gets cut short. That's correct. The navigation is the product; the animation is decoration on top of it.

### 2. Every idea has to survive at 20 pixels

A dart flying into a bullseye is a great image at 200px. At sidebar icon size it is a brown smudge crossing four pixels. The same is true of anything involving a new element entering the frame, fine detail, or more than two moving parts.

**What reads at icon size:** rotation, scale, a stroke drawing itself, opacity, a short translate, a sequence of two or three elements appearing in order.

**What doesn't:** projectiles, particles, anything with perspective, anything needing more than three distinct shapes, text.

Every spec below is written for what survives the shrink.

---

## The shared vocabulary

Eight unrelated party tricks read as noise. Eight variations on one motion signature read as craft. So they share everything except the verb.

```css
:root {
  --icon-anim-duration: 360ms;
  --icon-anim-stagger:   60ms;
  --icon-anim-ease:      cubic-bezier(.34, .02, .24, 1);
}
```

That easing is the same curve as the Sorrel mark's fold. Reusing it means the app has **one motion signature** rather than two competing ones.

**Rules for every animation:**

- **Transform and opacity only.** Never width, height, top, left, or margin. Those trigger layout on every frame and will jank a sidebar with eight items in it.
- **360ms total**, including any stagger. Multi-part sequences get three steps at 60ms apart, not six.
- **Plays once.** No loops, no idle animation, no hover trigger. Hover-triggered motion on eight adjacent items makes a sidebar feel infested.
- **Returns to rest.** The icon ends exactly where it started. No permanent state change.
- **Clicking the page you're already on does nothing.** No navigation, no animation.

---

## Per-icon specs

Written as the verb each icon already implies. If your actual icon differs, keep the verb and adapt the mechanics.

| Screen | The verb | Mechanic |
|---|---|---|
| **Dashboard** | *comes into focus* | Panels scale from 0.85 to 1 with opacity 0→1, staggered 60ms in reading order |
| **Accounts** | *fans and settles* | Cards rotate from a −8° fan to 0°, back to front, 60ms apart |
| **Transactions** | *writes itself* | Each line draws left to right via `stroke-dashoffset`, 60ms apart, top to bottom |
| **Budgets** | *fills* | The meter's fill scales on X from 0 to its resting value, single motion, no stagger |
| **Categories** | *sorts itself* | Dots translate from slightly scattered positions into their grid, all at once with per-dot delay |
| **Recurring** | *comes round again* | The circular arrow rotates one full 360°, single motion |
| **Goals** | *locks on* | Rings scale inward from 1.4 → 1 with opacity, outermost first, then the centre dot pops 0 → 1.15 → 1 |
| **Settings** | *adjusts* | The gear rotates 60°, overshooting to 72° and settling back |

**On the dart.** I'd drop it. A dart needs an element that isn't in the icon, travelling across a 20px box in under 400ms — it reads as a flicker, and drawing a recognisable dart at that size isn't possible. The rings converging with a centre pop says "target acquired" unmistakably at any size, and it's three transforms rather than a new asset.

If you want the dart, it belongs somewhere with room: the goals page's empty state, or the moment a goal completes. Those are places where it would actually land.

---

## Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  /* No animation at all. Not a shorter one. */
}
```

The icon renders in its rest state and the navigation happens exactly as it does today. This is a WCAG requirement, not a preference, and you've just finished an accessibility pass — don't introduce a new failure into it.

---

## Repeat fatigue

This is the failure mode that kills features like this, and it's worth designing against rather than discovering.

Someone opens Transactions fifteen times a day. The animation they loved on day one is a tax by week two. Three defences:

1. **Non-blocking** (rule 1) — it never costs them time, so it can't become friction
2. **Short** — 360ms is below the threshold where a person consciously waits
3. **Silent** — no sound, no bounce overshoot beyond the one specified, nothing that demands attention

If after a week of real use any of them still irritates you, shorten it rather than removing it. The ones that survive are usually the subtlest.

---

## Implementation

**Inline SVG components with CSS keyframes.** No animation library.

Rationale: eight small icon animations don't justify Lottie or Framer Motion's bundle weight, and you already have the CSS pattern from the mark's fold. Adding a dependency for this is a bad trade on a page that loads on every navigation.

**`currentColor` only resolves when the SVG is inlined in the DOM.** You learned this with the Sorrel mark — `next/image` and Satori don't resolve it. These must be React components rendering inline `<svg>`, not image imports, or they'll render black in one theme.

**Triggering.** Click sets a state flag on the nav item that applies an `is-animating` class, and the flag clears on `animationend`. Navigation fires in the same handler, unconditionally and first. The two are independent — if the route resolves before the animation finishes, the component unmounts mid-animation and that's fine.

**Don't animate via `key` changes or remounting.** That fights React's reconciliation and is how you get the `removeChild` errors from earlier in this project.

---

## The prompt

```
Add a click animation to each left-nav menu icon. Each icon performs its own
verb once, during the navigation that's already happening.

READ Navigation-Icon-Animations.md in full before writing anything.

THE TWO HARD RULES:

1. THE ANIMATION NEVER DELAYS NAVIGATION. The click fires the navigation
   immediately and unconditionally, first. The animation plays during the
   transition that already exists. If the route resolves first, the animation
   is cut short — that is correct. Do not await it, do not setTimeout the
   navigation behind it.

2. EVERY ANIMATION USES TRANSFORM AND OPACITY ONLY. No width, height, top,
   left or margin. Those trigger layout per frame and will jank a sidebar of
   eight items.

SHARED TOKENS — define once, use everywhere:
    --icon-anim-duration: 360ms
    --icon-anim-stagger:   60ms
    --icon-anim-ease:      cubic-bezier(.34, .02, .24, 1)

That easing is the Sorrel mark's fold curve. One motion signature for the app.

PER-ICON VERBS: see the table in the spec. Keep the verb; adapt the mechanics
to whatever the actual icon geometry is. Tell me where an icon's shape doesn't
support its verb rather than forcing it.

IMPLEMENTATION:
  - Inline SVG React components with CSS keyframes. NO animation library.
  - currentColor only resolves inline — these cannot be next/image.
  - Trigger with a state flag and an is-animating class, cleared on
    animationend. Do NOT remount or change keys to restart the animation; that
    fights reconciliation and caused DOM errors in this project before.
  - Plays once. No loops, no idle motion, NO HOVER TRIGGER.
  - Each icon returns to its exact rest state.
  - Clicking the current page does nothing — no navigation, no animation.

ACCESSIBILITY:
  @media (prefers-reduced-motion: reduce) — NO animation at all, not a shorter
  one. The nav behaves exactly as it does today.

VERIFY and report:
  - Measure the time from click to the destination page's first paint, with and
    without the animation. It must be unchanged. This is the whole point.
  - Every animation runs on the compositor: no layout or paint in the
    performance profile during playback.
  - Both themes. The icons use currentColor, so confirm they are not black in
    either.
  - Reduced motion: animations absent, navigation normal.
  - Rapid clicking between items doesn't leave an icon stuck mid-animation or
    throw.
  - Total bundle size added. If it's more than a few KB, something is wrong.
```

---

## One note on sequencing

This is new code landing on top of a finished accessibility audit. The part of Phase 7 Section 11 that couldn't be completed — the live visual pass and the real keyboard tab-through — is still outstanding.

That's actually an argument for doing this **now rather than after**: the outstanding re-run will cover the animations too, instead of needing a third pass. Build it, then do that sweep once, with animations included and `prefers-reduced-motion` on the checklist.
