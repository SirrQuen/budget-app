"use client";

import { createContext, useCallback, useContext, useMemo, useRef } from "react";

// The screen-edge acknowledgement that a log landed. One overlay for the
// whole app, mounted once by the shell -- not per page, and never inside a
// scrolling container, so it frames the viewport regardless of scroll
// position. Styling lives in the CONFIRM PULSE block in app/globals.css.
//
// It is decorative and says nothing on its own: the toast states what was
// logged. Hence aria-hidden, and hence a firing site that must be the SAME
// event as the toast, not a second one.

type ConfirmPulseValue = { pulse: () => void };

const ConfirmPulseContext = createContext<ConfirmPulseValue | null>(null);

const RUN_CLASS = "confirm-pulse--run";

export function ConfirmPulseProvider({ children }: { children: React.ReactNode }) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Rapid successive entries restart the pulse rather than stacking or
  // queueing: drop the class, force a synchronous reflow so the browser
  // commits the class-less state, then re-add. Without the reflow the two
  // mutations coalesce into no change at all and the animation carries on
  // from wherever the previous entry left it -- a second log a beat later
  // would land mid-fade-out and never reach full intensity.
  //
  // Driving this off a DOM ref rather than React state is deliberate: the
  // effect is purely visual, and routing it through a re-render would put a
  // state update in the submit path of every quick-add for no benefit.
  const pulse = useCallback(() => {
    const el = overlayRef.current;
    if (!el) return;
    el.classList.remove(RUN_CLASS);
    void el.offsetWidth;
    el.classList.add(RUN_CLASS);
  }, []);

  const value = useMemo(() => ({ pulse }), [pulse]);

  return (
    <ConfirmPulseContext.Provider value={value}>
      {children}
      {/* Last child of the provider, outside any page content -- nothing
          in the tree above it establishes a stacking context, so its
          z-index resolves against the root as intended. */}
      <div ref={overlayRef} className="confirm-pulse" aria-hidden="true" />
    </ConfirmPulseContext.Provider>
  );
}

const noop = () => {};

/**
 * Returns a function that fires the pulse once. Safe to call from anywhere;
 * outside the provider it is a no-op.
 *
 * Deliberately does NOT throw the way useOptimisticTransactions does. That
 * hook guards real data -- a missing provider there is a bug that silently
 * loses a row. This one guards a glow that by design carries no meaning, so
 * a missing provider should cost the glow, not the page.
 */
export function useConfirmPulse(): () => void {
  return useContext(ConfirmPulseContext)?.pulse ?? noop;
}
