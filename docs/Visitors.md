# Visitors: a small arrival for every greeting

**The first time someone opens the dashboard in each part of the day, a small visitor flies in and perches beside the greeting. It's a songbird in the morning, a butterfly in the afternoon, a firefly in the evening and an owl at night. It arrives once, lands, and then sits still. The design canvas ("Round 3 · A visitor for every greeting") shows it. Claude Code can't open the canvas, so the drawings and timings are all in this doc.**

The motion rules in `docs/Motion-and-Delight.md` apply throughout.

---

## Rules

1. **Never over a number, never over a control.** The visitor's box must not overlap any figure, text that matters, or anything clickable, including the "Your Sorrel" button. If it can't find room at some width, it doesn't appear.
2. **Once per part of the day, per device.** The first dashboard visit in a band gets the arrival. Later visits in the same band show it already perched. A new band, or a new day, brings the next visitor.
3. **Arrives, then rests.** About 1.2 seconds of flight and a soft settle, then completely still. No looping, idle hopping, fluttering or pulsing afterwards.
4. **One celebration at a time.** It waits until the welcome bloom has finished and any dialog (the monthly recap, Your Sorrel) is closed. It never plays at the same time as another arrival animation.
5. **Out of the way.** It's decorative: `aria-hidden`, not in the tab order, no announcement. Only its own small area responds to a tap. Everything around it works as normal.
6. **Reduced motion:** the visitor is simply perched. A tap removes it with no animation.
7. **Nothing written by a render, nothing in the database.** "Seen" and "sent away" are kept per device in localStorage, inside try/catch. If storage is unavailable: no arrival animation, perched only.
8. **Transform and opacity only,** with CSS keyframes, no JavaScript animation loop, no images or files loaded, and no new dependency.

---

## Which visitor, and when

The band comes from **`lib/timeOfDay`, in the user's stored timezone**, the same source as the greeting and the glow, so the visitor always matches the words.

| Band | Greeting | Visitor | Arrives from |
|---|---|---|---|
| 5am–noon | Good morning | Songbird | top right, flapping |
| noon–5pm | Good afternoon | Butterfly | right, wandering up and down |
| 5pm–10pm | Good evening | Firefly | below left, flickering |
| 10pm–5am | Hi, night owl | Owl | top left, gliding, no flapping |

---

## Where it perches

**Next to the greeting**, on a small twig carrying the season's leaf (see the canvas), or on the existing seasonal leaf if that already sits beside the greeting. **Phase 1 of the build reports what is beside the greeting now** (the seasonal leaf and the Your Sorrel button), proposes the perch point, and shows it at 1440px, 1024px and 390px wide. At phone width, a smaller visitor (about 85% size) is fine. Not appearing is better than crowding.

---

## How it moves (one-shot in the app; the canvas loops them for viewing)

| Visitor | Flight | Landing | After landing |
|---|---|---|---|
| Songbird | ~1.1s on a gentle arc, wings flapping | a small squash and settle (scale 1.04 / 0.94 for ~100ms) | wings folded, still |
| Butterfly | ~1.2s, a wandering path, wings beating (scaleX 1 to 0.25) | settles | wings open and close **once**, slowly, then rest open |
| Firefly | ~1.2s drifting up, its glow flickering (opacity 0.3 to 0.9) | settles | glow **steady** at 0.55, no pulsing |
| Owl | ~1.2s silent glide, tilted −12° levelling to 0, no flapping | a small squash and settle | **one** blink about 0.6s after landing, then still |

**A tap** sends it off: a short flight up and away (~0.6s), fading out. It's then gone for the rest of that band on that device.

The canvas keyframes, shown looping for viewing, are the reference for positions and arcs. Convert them to single-play animations with these durations.

---

## The drawings (inline SVG, use as given)

The colours are illustration colours local to this component. They aren't data colours, so CLAUDE.md's rule about gold on data doesn't apply. Gradient ids must be unique per instance (use React's `useId`).

**Songbird** (42×38; the wing is the animated part)
```svg
<svg width="42" height="38" viewBox="0 0 42 38" aria-hidden="true">
  <path d="M30 18 L41 13 L39 23 Z" fill="#A97A22"/>
  <ellipse cx="21" cy="21" rx="13" ry="11" fill="#C99632"/>
  <ellipse cx="18" cy="24" rx="8" ry="6" fill="#F3CF7A"/>
  <circle cx="11" cy="13" r="7.5" fill="#C99632"/>
  <circle cx="8.6" cy="12" r="1.5" fill="#0B0B12"/>
  <path d="M3.6 13 L0 14.6 L3.6 16 Z" fill="#E8B44A"/>
  <path class="wing" d="M17 17 C23 10 31 12 33 19 C27 21 21 22 17 17 Z" fill="#A97A22"/>
  <path d="M18 31 V36 M23 31 V36" stroke="#A5A2B4" stroke-width="1.6" stroke-linecap="round"/>
</svg>
```
Wing: `transform-box: fill-box; transform-origin: 20% 60%`, rotating between −40° and 25° while flying, 0° at rest.

**Butterfly** (36×30; the wings group is the animated part)
```svg
<svg width="36" height="30" viewBox="0 0 36 30" aria-hidden="true">
  <g class="wings">
    <path d="M18 14 C10 2 2 4 4 12 C6 17 13 17 18 15 Z" fill="#E8B44A"/>
    <path d="M18 16 C11 18 6 26 11 27 C15 27 17 22 18 17 Z" fill="#F3CF7A"/>
    <path d="M18 14 C26 2 34 4 32 12 C30 17 23 17 18 15 Z" fill="#E8B44A"/>
    <path d="M18 16 C25 18 30 26 25 27 C21 27 19 22 18 17 Z" fill="#F3CF7A"/>
  </g>
  <ellipse cx="18" cy="16" rx="1.7" ry="8" fill="#F6F4F8"/>
  <path d="M17.4 8.5 C16 5 14 4 13 4 M18.6 8.5 C20 5 22 4 23 4" stroke="#F6F4F8" stroke-width="1" fill="none" stroke-linecap="round"/>
</svg>
```
Wings: `transform-box: fill-box; transform-origin: 50% 50%`, scaleX between 1 and 0.25. In the light theme, the body and antennae use the ink token so they stay visible.

**Firefly** (28×28, overflow visible; the halo is the animated part)
```svg
<svg width="28" height="28" viewBox="0 0 28 28" style="overflow:visible" aria-hidden="true">
  <defs><radialGradient id="{uniqueId}"><stop offset="0%" stop-color="#F3CF7A" stop-opacity=".9"/><stop offset="100%" stop-color="#F3CF7A" stop-opacity="0"/></radialGradient></defs>
  <circle class="halo" cx="14" cy="19" r="14" fill="url(#{uniqueId})"/>
  <ellipse cx="10" cy="10" rx="4" ry="2.4" fill="rgba(246,244,248,.45)" transform="rotate(-25 10 10)"/>
  <ellipse cx="18" cy="10" rx="4" ry="2.4" fill="rgba(246,244,248,.45)" transform="rotate(25 18 10)"/>
  <ellipse cx="14" cy="13" rx="2.6" ry="4.4" fill="#4A4A5E"/>
  <ellipse cx="14" cy="19" rx="2.8" ry="3.2" fill="#F3CF7A"/>
</svg>
```
In the light theme the glow is barely visible. That's acceptable, but the body must still read clearly. Check it.

**Owl** (44×48; the lid is the animated part)
```svg
<svg width="44" height="48" viewBox="0 0 44 48" aria-hidden="true">
  <path d="M9 12 L12 2 L17 9 Z M35 12 L32 2 L27 9 Z" fill="#3B4A73"/>
  <ellipse cx="22" cy="28" rx="15.5" ry="17" fill="#3B4A73"/>
  <ellipse cx="22" cy="33" rx="10" ry="11" fill="#5B6B95"/>
  <circle cx="15.5" cy="20" r="7" fill="#D9DCEB"/>
  <circle cx="28.5" cy="20" r="7" fill="#D9DCEB"/>
  <circle cx="15.5" cy="20" r="3.4" fill="#0B0B12"/>
  <circle cx="28.5" cy="20" r="3.4" fill="#0B0B12"/>
  <circle cx="16.6" cy="18.8" r="1" fill="#F6F4F8"/>
  <circle cx="29.6" cy="18.8" r="1" fill="#F6F4F8"/>
  <rect class="lid" x="8.5" y="13" width="27" height="14" rx="7" fill="#3B4A73"/>
  <path d="M20.5 25 L22 29 L23.5 25 Z" fill="#E8B44A"/>
  <path d="M17 45 L17 47.5 M20 45 L20 47.5 M24 45 L24 47.5 M27 45 L27 47.5" stroke="#E8B44A" stroke-width="1.6" stroke-linecap="round"/>
</svg>
```
Lid: `transform-box: fill-box; transform-origin: 50% 0`, scaleY 0 (open) to 1 (closed) to 0 for the single blink.

**The twig** (90×30), if a perch is needed beside the greeting:
```svg
<svg width="90" height="30" viewBox="0 0 90 30" aria-hidden="true">
  <path d="M2 12 C30 6 60 7 88 12" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M70 10 C74 2 82 0 88 2 C86 8 78 12 70 10 Z" fill="#D2912B"/>
  <path d="M14 11 C10 18 12 26 18 28 C20 22 18 15 14 11 Z" fill="#E8B44A"/>
</svg>
```
The stroke uses the muted-ink token. The leaves follow the current season (reuse batch D's seasonal art where it fits).

---

## A way to turn it off

**Settings → Display: "Visitors on the dashboard"**, on by default. It's stored as a display preference in localStorage, which the privacy policy already covers. Some people don't want any extra motion, even once a day, beyond what reduced motion handles.

## Storage (list these per the merge-gate rule)

- `visitor-seen` holds `<local date>:<band>`, the last band whose arrival played.
- `visitor-away` holds `<local date>:<band>`, sent away by a tap for that band.
- `visitors-off` holds the Settings choice.

The policy's existing wording ("what you last saw", "small choices you make in the app", "display preferences") covers all three. Confirm it, and don't edit the policy unless it doesn't.

---

## The prompt (Sonnet)

```
Read docs/Visitors.md in full, and the rules in
docs/Motion-and-Delight.md. New branch off main. Display only: if
anything needs a migration, a write path, a new dependency or a
third-party asset, STOP and tell me.

REPORT FIRST, then build:
  - What sits beside the dashboard greeting now (seasonal leaf, Your
    Sorrel button), and where a visitor can perch WITHOUT overlapping
    any number, text or control. Propose the perch point and show it at
    1440, 1024 and 390px.
  - How to wait for the welcome bloom to finish and for any open
    dialog (recap, Your Sorrel) to close.

BUILD per the doc:
  - One Visitor component: band from lib/timeOfDay (user's zone), the
    four SVGs exactly as given (unique gradient ids via useId), one-shot
    CSS keyframes with the doc's durations, settle on landing, the
    butterfly's single wing close, the firefly's steady glow, the owl's
    single blink. Transform/opacity only.
  - Plays once per band per device (visitor-seen); otherwise perched.
    Tap: fly off (~0.6s) and stay away for that band (visitor-away).
    Only the visitor's own box takes the tap; aria-hidden, not
    focusable.
  - Waits for the welcome bloom and any open dialog.
  - Never overlaps a number, text or control; if there's no room at a
    width, it doesn't render.
  - Reduced motion: perched, tap removes with no animation.
  - Settings > Display toggle "Visitors on the dashboard" (visitors-off),
    on by default.
  - localStorage in try/catch; unavailable means perched, no arrival.
  - List the three keys; confirm the privacy wording covers them.

VERIFY (I'll sign you in on dev):
  - Unit tests: band to visitor at every boundary in two timezones;
    seen/away/off logic; storage unavailable.
  - Browser: the arrival plays once, a reload shows it perched; a tap
    sends it away and it stays away on reload; the toggle hides it.
  - Force each band (unit-level or by stubbing the clock in a test, not
    by changing my timezone) and check all four render and land in
    place.
  - The bloom-then-visitor order on a first sign-in of the day.
  - No overlap with any number or control at 1440, 1024 and 390px,
    both themes.
  - Reduced motion forced in DevTools: perched, nothing moves.
  - If screenshots time out, tell me and I'll check visually.
  tsc, eslint, full npm test. Tester note (Sent: not yet, not
  before-deploy). Report, then stop. Don't merge.
```
