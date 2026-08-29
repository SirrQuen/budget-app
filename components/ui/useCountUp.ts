import { useEffect, useRef, useState } from "react";

const STORAGE_PREFIX = "stat-tile-";
const DURATION_MS = 600;

function readStoredValue(id: string): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    // Private window or storage disabled -- count up from zero instead.
    return null;
  }
}

function writeStoredValue(id: string, value: number) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, String(value));
  } catch {
    // Same as above -- the figure still renders correctly, it just won't
    // remember this value for the next visit.
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Counts a figure up on mount -- from the value last seen on this device
 * (localStorage, keyed by `id`) toward `value`, over ~600ms ease-out. The
 * returned `animating` flag is true for that window so the caller can pin
 * `tabular-nums` while digits are moving and drop back to proportional
 * figures at rest.
 *
 * prefers-reduced-motion: no tween. `value` is returned immediately and
 * `animating` stays false -- the figure still lands on its real number, it
 * just doesn't travel there. The last-seen value is still recorded, so the
 * reduced-motion end state genuinely reflects "this changed", it arrives
 * without the 600ms.
 *
 * The tween runs once per real mount. A later `value` change (a revalidated
 * page, an optimistic update) reaches the screen directly -- it is not a
 * "return visit" and does not replay the animation.
 */
export function useCountUp(value: number, id: string): { display: number; animating: boolean } {
  // SSR-safe start: the server can't read localStorage or matchMedia, so the
  // first client render must match it at a neutral 0 / not-animating. The
  // effect below is the earliest either API is read.
  const [display, setDisplay] = useState(0);
  const [animating, setAnimating] = useState(false);
  const mountTweenDone = useRef(false);

  // The localStorage read, the write back, and every setState all happen
  // inside `begin`, deferred by one rAF -- never synchronously in the effect
  // body. That is what makes StrictMode's dev-only double-invoke harmless:
  // cleanup cancels the first pass's rAF before `begin` runs, so only the
  // second pass reads the real last-seen value rather than one the first
  // pass already overwrote.
  useEffect(() => {
    let raf = 0;

    const begin = () => {
      const reducedMotion = prefersReducedMotion();
      const start = reducedMotion ? value : (readStoredValue(id) ?? 0);
      writeStoredValue(id, value);

      if (reducedMotion) {
        setDisplay(value);
        mountTweenDone.current = true;
        return;
      }

      setAnimating(true);
      // Nothing changed since last visit -> collapse the duration to one
      // frame rather than holding a redundant 600ms.
      const duration = start === value ? 0 : DURATION_MS;
      let startTime: number | null = null;

      const tick = (now: number) => {
        if (startTime === null) startTime = now;
        const t = duration <= 0 ? 1 : Math.min(1, (now - startTime) / duration);
        setDisplay(start + (value - start) * easeOutCubic(t));
        if (t < 1) {
          raf = requestAnimationFrame(tick);
        } else {
          setAnimating(false);
          mountTweenDone.current = true;
        }
      };

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(begin);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mountTweenDone.current) return;
    setDisplay(value);
  }, [value]);

  return { display, animating };
}
