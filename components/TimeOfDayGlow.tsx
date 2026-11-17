import type { TimeBand } from "@/lib/timeOfDay";

// The dashboard's light (docs/Motion-and-Delight.md, step 8): a soft glow at
// the top of the page, chosen by the user's local time and rendered on the
// server, so there is no flash and nothing is stored. Static, always -- no
// pulse, no drift -- and behind everything: the parent is `relative isolate`
// and this sits at z-index -1, under every card and every word. Numbers and
// text never change colour for it. Strengths per theme are in globals.css
// (--tod-*); the dark values are the most saturated this may ever be.
export function TimeOfDayGlow({ band }: { band: TimeBand }) {
  return <div aria-hidden="true" data-band={band} className={`tod-glow tod-glow--${band}`} />;
}
