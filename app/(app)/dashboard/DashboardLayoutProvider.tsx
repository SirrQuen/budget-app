"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { saveDashboardLayoutAction } from "@/lib/actions/settings";
import { callAction } from "@/components/useActionForm";
import { InfoIcon } from "@/components/ui/icons";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  labelOf,
  layoutsEqual,
  moveAmong,
  regionOf,
  reorderVisible,
  setHidden,
  type DashboardLayout,
  type DashboardSectionId,
} from "@/lib/dashboardLayout";

// The dashboard's layout as the person has it right now. A move is applied
// on screen at once and saved in the background -- on drop, or on a menu
// choice, never during render -- through the same action Settings-style
// writes use. If the save fails the screen goes back to the last saved
// layout and says so. Undo is just another save of the layout before.

type Toast = { key: number; message: string; undo: (() => void) | null; failed: boolean };

type Value = {
  layout: DashboardLayout;
  /** Put a region's on-screen sections in a new sequence (a drop). */
  reorder: (sequence: DashboardSectionId[], moved: DashboardSectionId) => void;
  /** One step through the card menu. */
  step: (visible: DashboardSectionId[], id: DashboardSectionId, step: -1 | 1) => void;
  hide: (id: DashboardSectionId) => void;
  show: (id: DashboardSectionId) => void;
  reset: () => void;
};

const Ctx = createContext<Value | null>(null);

export function useDashboardLayout(): Value {
  const value = useContext(Ctx);
  if (!value) {
    throw new Error("useDashboardLayout must be used inside DashboardLayoutProvider");
  }
  return value;
}

const TOAST_MS = 10_000;

export function DashboardLayoutProvider({
  saved,
  children,
}: {
  saved: DashboardLayout;
  children: React.ReactNode;
}) {
  const [layout, setLayout] = useState(saved);
  const [toast, setToast] = useState<Toast | null>(null);

  const current = useRef(saved);
  const lastSaved = useRef(saved);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const toastKey = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const startTimer = useCallback(() => {
    stopTimer();
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, [stopTimer]);
  useEffect(() => stopTimer, [stopTimer]);

  const announce = useCallback(
    (message: string, undo: (() => void) | null, failed = false) => {
      toastKey.current += 1;
      setToast({ key: toastKey.current, message, undo, failed });
      startTimer();
    },
    [startTimer],
  );

  // Saves run one at a time and in order, so a quick second move can't
  // overtake the first. A failed save puts the screen back on the last
  // layout the server confirmed.
  const persist = useCallback(
    (next: DashboardLayout) => {
      queue.current = queue.current.then(async () => {
        const result = await callAction(() =>
          saveDashboardLayoutAction(
            layoutsEqual(next, DEFAULT_DASHBOARD_LAYOUT)
              ? null
              : { order: next.order, hidden: next.hidden },
          ),
        );
        if (result?.error) {
          current.current = lastSaved.current;
          setLayout(lastSaved.current);
          announce(`That didn’t save. ${result.error}`, null, true);
          return;
        }
        lastSaved.current = next;
      });
    },
    [announce],
  );

  const apply = useCallback(
    (next: DashboardLayout, message: string) => {
      const before = current.current;
      if (layoutsEqual(before, next)) {
        return;
      }
      current.current = next;
      setLayout(next);
      persist(next);
      announce(message, () => {
        current.current = before;
        setLayout(before);
        persist(before);
        setToast(null);
      });
    },
    [announce, persist],
  );

  const value = useMemo<Value>(
    () => ({
      layout,
      reorder: (sequence, moved) =>
        apply(
          { ...current.current, order: reorderVisible(current.current.order, sequence) },
          `Moved ${labelOf(moved)}`,
        ),
      step: (visible, id, stepBy) =>
        apply(
          { ...current.current, order: moveAmong(current.current.order, visible, id, stepBy) },
          `Moved ${labelOf(id)}`,
        ),
      hide: (id) =>
        apply(
          { ...current.current, hidden: setHidden(current.current.hidden, id, true) },
          `Hid ${labelOf(id)}`,
        ),
      show: (id) =>
        apply(
          { ...current.current, hidden: setHidden(current.current.hidden, id, false) },
          `Showing ${labelOf(id)}`,
        ),
      reset: () => apply(DEFAULT_DASHBOARD_LAYOUT, "Layout reset"),
    }),
    [layout, apply],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
      >
        {toast ? (
          <div
            key={toast.key}
            onMouseEnter={stopTimer}
            onMouseLeave={startTimer}
            onFocus={stopTimer}
            onBlur={startTimer}
            className="pointer-events-auto flex items-center gap-3 rounded-full border border-hairline bg-surface-raised py-1 pl-4 pr-1 text-sm text-ink shadow-lg"
          >
            {toast.failed ? (
              <InfoIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            ) : null}
            <span>{toast.message}</span>
            {toast.undo ? (
              <button
                type="button"
                onClick={toast.undo}
                className="min-h-11 rounded-full px-4 font-semibold text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
              >
                Undo
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setToast(null)}
                className="min-h-11 rounded-full px-4 text-ink-secondary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
              >
                Dismiss
              </button>
            )}
          </div>
        ) : null}
      </div>
    </Ctx.Provider>
  );
}

/**
 * Renders its children only while at least one of `ids` is on screen --
 * the "Over time" region (its heading and date filter) has no business
 * showing when every section in it is hidden.
 */
export function RegionGate({
  ids,
  children,
}: {
  ids: DashboardSectionId[];
  children: React.ReactNode;
}) {
  const { layout } = useDashboardLayout();
  const hidden = new Set(layout.hidden);
  return ids.some((id) => !hidden.has(id)) ? <>{children}</> : null;
}

/** Hidden sections and the way back: shown only once something's changed. */
export function DashboardLayoutFooter({ available }: { available: DashboardSectionId[] }) {
  const { layout, show, reset } = useDashboardLayout();
  const hiddenNow = layout.order.filter(
    (id) => layout.hidden.includes(id) && available.includes(id),
  );
  const customised = !layoutsEqual(layout, DEFAULT_DASHBOARD_LAYOUT);
  const regionHint = (id: DashboardSectionId) => (regionOf(id) === "over-time" ? " (Over time)" : "");

  if (!customised) {
    return null;
  }

  return (
    <section
      aria-label="Your dashboard layout"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline pt-4 text-sm text-ink-secondary"
    >
      {hiddenNow.length > 0 ? (
        <>
          <span>Hidden:</span>
          {hiddenNow.map((id) => (
            <button
              key={id}
              type="button"
              id={`dash-show-${id}`}
              onClick={() => show(id)}
              aria-label={`Show ${labelOf(id)}${regionHint(id)}`}
              className="min-h-11 rounded-full border border-field-border px-3 font-medium text-ink hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              Show {labelOf(id)}
            </button>
          ))}
        </>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="min-h-11 rounded-full px-3 font-medium text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action sm:ml-auto"
      >
        Reset layout
      </button>
    </section>
  );
}
