"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LeafIcon } from "@/components/ui/LeafIcon";
import { formatDate } from "@/lib/format";
import { OPEN_YOUR_SORREL_EVENT, YOUR_SORREL_URL } from "@/lib/yourSorrel";
import type { EarnedMilestone } from "@/lib/milestones";

// Your Sorrel (docs/Decide-and-Grow.md, J): when you started and the
// milestones earned, each with its date. Earned ones only -- no locked list,
// nothing here is an amount or a comparison.
//
// ONE host, mounted by AppShell; the greeting link, the milestone toast and
// the account block ask for it with requestYourSorrel() (lib/yourSorrel.ts).
// The dates are read when it OPENS (GET /dashboard/your-sorrel, read-only),
// never on a page load. A native <dialog> opened with showModal() gives the
// backdrop and Escape; the Tab wrap is repeated here as the runway's is, and
// focus goes back to whatever asked.

type Loaded = { since: string | null; milestones: EarnedMilestone[] };
type State = { status: "loading" } | { status: "done"; data: Loaded } | { status: "error" };

export function YourSorrelPanel() {
  const [open, setOpen] = useState(false);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onOpen(e: Event) {
      const from = (e as CustomEvent<{ from: HTMLElement | null }>).detail?.from ?? null;
      returnTo.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setOpen(true);
    }
    window.addEventListener(OPEN_YOUR_SORREL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_YOUR_SORREL_EVENT, onOpen);
  }, []);

  // Mounted only while open: each opening is a fresh read.
  return open ? <PanelDialog returnTo={returnTo} onClose={() => setOpen(false)} /> : null;
}

const textButton =
  "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

const tile = "flex items-center justify-between gap-3 rounded-xl border border-hairline bg-surface-raised px-4 py-3 text-sm";

function PanelDialog({ returnTo, onClose }: { returnTo: React.RefObject<HTMLElement | null>; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const labelId = useId();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();

    const controller = new AbortController();
    fetch(YOUR_SORREL_URL, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Loaded;
        if (!controller.signal.aborted) setState({ status: "done", data });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setState({ status: "error" });
      });
    return () => controller.abort();
  }, []);

  function close() {
    ref.current?.close();
    onClose();
    // The native dialog returns focus to what had it; if that is gone (the
    // toast dismissed itself), the element that asked, or else the page title.
    const target = returnTo.current;
    requestAnimationFrame(() => {
      if (target && target.isConnected) target.focus();
      else document.getElementById("page-title")?.focus();
    });
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        // The backdrop is the dialog element itself.
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const focusable = [
          ...e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"),
        ].filter((el) => el.getClientRects().length > 0 || el instanceof SVGElement);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && (document.activeElement === first || !e.currentTarget.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
      className="your-sorrel-panel overflow-y-auto border border-hairline bg-surface p-0 text-ink backdrop:bg-scrim"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={labelId} className="text-base font-semibold text-ink">
              Your Sorrel
            </h2>
            <p className="mt-0.5 min-h-5 text-sm text-ink-secondary" aria-live="polite">
              {state.status === "done" && state.data.since ? `With Sorrel since ${formatDate(state.data.since)}` : null}
            </p>
          </div>
          <button type="button" onClick={close} className={textButton}>
            Close
          </button>
        </div>

        {state.status === "loading" ? (
          <p role="status" className="text-sm text-ink-secondary">
            Loading your moments…
          </p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-sm text-ink-secondary">
            Sorrel couldn&apos;t load this just now. Close it and try again in a moment.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.data.milestones.map((m) => (
              <li key={m.id} className={tile}>
                <span className="flex items-center gap-2 text-ink">
                  <LeafIcon className="h-3.5 w-3.5 shrink-0 text-gold" />
                  {m.label}
                </span>
                <span className="shrink-0 text-ink-secondary">{formatDate(m.date)}</span>
              </li>
            ))}
            {/* Never a list of what's locked: one tile that says there's more. */}
            <li className={`${tile} border-dashed text-ink-secondary`}>More to discover</li>
          </ul>
        )}
      </div>
    </dialog>
  );
}
