// The hero's figure, as two halves (docs/Decide-and-Grow.md, rulings on
// Phase 1 for F):
//
//   getSafeToSpendInputs()  (lib/db/dashboard.ts) -- every read, nothing else
//   assembleSafeToSpend()   (here, pure)          -- the one projection call
//
// getSafeToSpend() is exactly the two in sequence, so the hero behaves as it
// did. "Can I afford it?" (lib/whatIf.ts) loads the same inputs once and runs
// the same projection with a pretend expense added -- never a second
// calculation.

import type { SafeToSpend, SafeToSpendWindowReason } from "@/lib/db/dashboard";
import {
  projectSafeToSpend,
  type SafeToSpendProjection,
  type SafeToSpendProjectionInput,
} from "@/lib/safeToSpendProjection";

/** What the breakdown shows beside the projection, read alongside its inputs. */
export type SafeToSpendContext = Omit<SafeToSpend, keyof SafeToSpendProjection | "windowReason"> & {
  /** Which fallback window applied -- surfaced only in window mode. */
  fallbackReason: SafeToSpendWindowReason;
};

export type SafeToSpendInputs = {
  projection: SafeToSpendProjectionInput;
  context: SafeToSpendContext;
};

/** The hero's figure from its inputs: one projection, plus the labels read with it. */
export function assembleSafeToSpend(inputs: SafeToSpendInputs): SafeToSpend {
  const projection = projectSafeToSpend(inputs.projection);
  const { fallbackReason, ...context } = inputs.context;
  return {
    ...projection,
    windowReason: projection.mode === "window" ? fallbackReason : null,
    ...context,
  };
}
