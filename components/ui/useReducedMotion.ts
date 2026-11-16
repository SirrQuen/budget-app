"use client";

import { useSyncExternalStore } from "react";

// The one JavaScript-side read of prefers-reduced-motion. CSS effects are
// collapsed by the global block in app/globals.css; this is for effects
// JavaScript drives (rolling digits, leaves, a ripple), which skip
// rendering their extra elements altogether so the end state shows at once.
const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(notify: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(QUERY).matches;
}

// The server render assumes no preference; a reduced-motion browser
// corrects it on hydration, before any effect has anything to show (every
// effect starts from a change, never from the first render).
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
