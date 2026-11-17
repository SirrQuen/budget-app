"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SorrelMark } from "@/components/SorrelMark";
import { Button, buttonClass } from "@/components/ui/Button";
import { useReducedMotion } from "@/components/ui/useReducedMotion";
import { FIELD_EDGE } from "@/components/ui/Input";
import { afterWelcome } from "@/lib/welcomeSignals";
import type { RecapCard } from "@/lib/monthStory";
import { canShareFile, downloadFile, drawRecapImage } from "./recapShareImage";

// "Your month, as a story" (docs/Motion-and-Delight.md, step 9). A modal
// dialog of a few cards: focus moves in and stays in (showModal), Escape
// closes, Next/Back buttons as well as a tap (left third back, the rest
// forward), a swipe and the arrow keys. A screen reader hears each card
// through a polite live region. Reduced motion: cards swap without sliding.
//
// Done or close dismisses it for its month: a cookie named with the month,
// set here, by the client. Nothing is written by a render and nothing new
// is stored. The cards and their figures arrive decided (lib/monthStory.ts).
//
// Share draws an image on this device (recapShareImage.ts). Amounts are
// hidden until "Show amounts" is switched on, and the person sees the exact
// image before it goes anywhere: the Web Share API where it can share a
// file, a download otherwise. Nothing about the recap is logged or tracked.

const COOKIE_DAYS = 45;
const SWIPE_PX = 40;

function setDismissedCookie(name: string) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${name}=1; path=/; max-age=${COOKIE_DAYS * 86400}; samesite=lax${secure}`;
}

export function MonthRecap({
  cards,
  cookieName,
  shareTitle,
  shareLinesHidden,
  shareLinesShown,
  fileName,
  preview = false,
}: {
  cards: RecapCard[];
  cookieName: string;
  /** Opened by the development preview: shown even if dismissed. */
  preview?: boolean;
  shareTitle: string;
  shareLinesHidden: string[];
  shareLinesShown: string[];
  fileName: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const shareHeadingRef = useRef<HTMLHeadingElement>(null);
  const labelId = useId();
  const cardTextId = useId();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<"next" | "back" | null>(null);
  const [view, setView] = useState<"cards" | "share">("cards");
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  const last = cards.length - 1;
  const card = cards[index];

  // Opens after the daily welcome, never under it -- and not at all if this
  // month was dismissed since the page was rendered (a cached render coming
  // back on Back/Forward). A preview ignores the cookie, as the server does.
  useEffect(() => {
    if (!preview && document.cookie.split("; ").some((c) => c.startsWith(`${cookieName}=`))) {
      // Deferred a tick: never a setState in the effect body.
      const t = setTimeout(() => setOpen(false), 0);
      return () => clearTimeout(t);
    }
    return afterWelcome(() => {
      const dialog = ref.current;
      if (dialog && !dialog.open) {
        dialog.showModal();
        primaryRef.current?.focus();
      }
    });
  }, [cookieName, preview]);

  function dismiss() {
    setDismissedCookie(cookieName);
    ref.current?.close();
    setOpen(false);
  }

  function go(to: number) {
    if (to < 0 || to > last || to === index) return;
    setDirection(to > index ? "next" : "back");
    setIndex(to);
  }

  function openShare() {
    setView("share");
  }

  useEffect(() => {
    if (view === "share") shareHeadingRef.current?.focus();
    else primaryRef.current?.focus();
  }, [view]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelId}
      aria-describedby={view === "cards" ? cardTextId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      onKeyDown={(e) => {
        // Trapped: Tab wraps inside the dialog rather than leaving for the
        // browser's own controls, which a native modal would allow.
        if (e.key === "Tab") {
          const focusable = [
            ...e.currentTarget.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])"),
          ].filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
          const first = focusable[0];
          const lastEl = focusable[focusable.length - 1];
          if (first && lastEl) {
            if (e.shiftKey && (document.activeElement === first || !e.currentTarget.contains(document.activeElement))) {
              e.preventDefault();
              lastEl.focus();
            } else if (!e.shiftKey && document.activeElement === lastEl) {
              e.preventDefault();
              first.focus();
            }
          }
          return;
        }
        if (view !== "cards") return;
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(index + 1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(index - 1);
        }
      }}
      className="mx-auto my-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-hairline bg-surface p-0 text-ink backdrop:bg-scrim"
    >
      <h2 id={labelId} className="sr-only">
        {cards[0]?.before ?? "Your month"}, a look back
      </h2>

      {view === "cards" ? (
        <div className="flex min-h-[30rem] flex-col p-5">
          {/* Progress: one segment per card. The live region says which card. */}
          <div className="flex items-center gap-3">
            <div aria-hidden="true" className="flex flex-1 gap-1.5">
              {cards.map((c, i) => (
                <span
                  key={c.id}
                  className={`h-1 flex-1 rounded-full ${i <= index ? "bg-action" : "bg-hairline"}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Close"
              className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* The card. Tap: left third back, the rest forward. Swipe too. */}
          <div
            className="relative flex flex-1 cursor-pointer select-none touch-pan-y overflow-hidden"
            onPointerDown={(e) => {
              pointerStart.current = { x: e.clientX, y: e.clientY };
              swiped.current = false;
            }}
            onPointerUp={(e) => {
              const start = pointerStart.current;
              pointerStart.current = null;
              if (!start) return;
              const dx = e.clientX - start.x;
              const dy = e.clientY - start.y;
              if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
                swiped.current = true;
                go(dx < 0 ? index + 1 : index - 1);
              }
            }}
            onClick={(e) => {
              if (swiped.current) {
                swiped.current = false;
                return;
              }
              const box = e.currentTarget.getBoundingClientRect();
              go(e.clientX - box.left < box.width / 3 ? index - 1 : index + 1);
            }}
          >
            <div
              key={card.id}
              id={cardTextId}
              aria-live="polite"
              aria-atomic="true"
              className={`flex w-full flex-col justify-center py-8 ${
                !reduced && direction === "next" ? "recap-card--next" : ""
              } ${!reduced && direction === "back" ? "recap-card--back" : ""}`}
            >
              <span className="sr-only">
                Card {index + 1} of {cards.length}.{" "}
              </span>
              {card.id === "intro" ? (
                <>
                  <span className="sr-only">{card.sentence}</span>
                  <span aria-hidden="true">
                    <SorrelMark size={72} />
                  </span>
                  <p aria-hidden="true" className="mt-6 text-4xl font-semibold text-ink">
                    {card.before}
                  </p>
                  <p aria-hidden="true" className="mt-2 text-lg text-ink-secondary">
                    {card.after}
                  </p>
                </>
              ) : (
                <>
                  <span className="sr-only">{card.sentence}</span>
                  <p aria-hidden="true" className="text-xl text-ink-secondary">
                    {card.before}
                  </p>
                  <p aria-hidden="true" className="mt-1 text-5xl font-semibold text-ink">
                    {card.figure}
                  </p>
                  <p aria-hidden="true" className="mt-2 text-xl text-ink-secondary">
                    {card.after}
                  </p>
                  {card.meter ? <RecapMeter name={card.meter.name} pct={card.meter.pct} /> : null}
                </>
              )}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            {/* aria-disabled, not disabled: focus stays put on the first card. */}
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-disabled={index === 0 || undefined}
              className="min-h-11 rounded-full px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            >
              Back
            </button>
            <div className="flex items-center gap-2">
              {index === last ? (
                <button
                  type="button"
                  onClick={openShare}
                  className="min-h-11 rounded-full px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                >
                  Share
                </button>
              ) : null}
              {/* One button, so focus survives the last card's relabel. */}
              <Button ref={primaryRef} type="button" onClick={() => (index === last ? dismiss() : go(index + 1))}>
                {index === last ? "Done" : "Next"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <SharePanel
          headingRef={shareHeadingRef}
          title={shareTitle}
          linesHidden={shareLinesHidden}
          linesShown={shareLinesShown}
          fileName={fileName}
          onBack={() => setView("cards")}
          onClose={dismiss}
        />
      )}
    </dialog>
  );
}

/** The goal's meter at the month's end. Static: no memory, no milestone. */
function RecapMeter({ name, pct }: { name: string; pct: number }) {
  const rounded = Math.round(pct);
  return (
    <div className="mt-6" aria-hidden="true">
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-ink-secondary">{name}</span>
        <span className="font-semibold tabular-nums text-ink">{rounded}%</span>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: "color-mix(in srgb, var(--action) 22%, var(--page))" }}
      >
        <div
          className="h-full w-full origin-left rounded-full"
          style={{ transform: `scaleX(${pct / 100})`, backgroundColor: "var(--action)" }}
        />
      </div>
    </div>
  );
}

function SharePanel({
  headingRef,
  title,
  linesHidden,
  linesShown,
  fileName,
  onBack,
  onClose,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  title: string;
  linesHidden: string[];
  linesShown: string[];
  fileName: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const switchLabelId = useId();
  const [showAmounts, setShowAmounts] = useState(false);
  const [image, setImage] = useState<{ file: File; url: string; amounts: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const lines = showAmounts ? linesShown : linesHidden;

  // Drawn ahead of the tap, so Share runs straight from the click (Safari
  // only shares in direct response to one). Redrawn when the toggle moves;
  // what's previewed is exactly the file that's shared.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    drawRecapImage(title, lines, fileName)
      .then((file) => {
        if (cancelled) return;
        url = URL.createObjectURL(file);
        setImage({ file, url, amounts: showAmounts });
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAmounts]);

  const ready = image !== null && image.amounts === showAmounts;
  const canShare = ready && canShareFile(image.file);

  async function share() {
    if (!ready) return;
    setNote("");
    if (!canShare) {
      downloadFile(image.file);
      setNote("Saved to your downloads.");
      return;
    }
    try {
      await navigator.share({ files: [image.file], title });
    } catch (error) {
      // Cancelling the share sheet isn't a failure; anything else falls
      // back to saving the same file.
      if (error instanceof DOMException && error.name === "AbortError") return;
      downloadFile(image.file);
      setNote("Saved to your downloads.");
    }
  }

  return (
    <div className="flex flex-col p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink focus-visible:outline-none">
          Share your month
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
        >
          <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-secondary">This is the exact image you’ll share. It’s made on this device.</p>

      <div className="mt-4 overflow-hidden rounded-xl border border-hairline bg-page">
        {ready ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local object URL, never optimisable
          <img
            src={image.url}
            alt={`The image you'll share: ${[title, ...lines].join(". ")}.`}
            className="block aspect-[4/5] w-full"
          />
        ) : (
          <div className="aspect-[4/5] w-full" aria-hidden="true" />
        )}
      </div>
      {failed ? <p className="mt-2 text-sm text-ink-secondary">The image couldn’t be made on this device.</p> : null}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span id={switchLabelId} className="text-sm text-ink">
          Show amounts
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={showAmounts}
          aria-labelledby={switchLabelId}
          onClick={() => setShowAmounts((v) => !v)}
          className={`relative h-7 w-12 shrink-0 ${FIELD_EDGE} !rounded-full ${
            showAmounts ? "bg-action" : "bg-surface-raised"
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-0.5 h-5 w-5 rounded-full transition-transform duration-150 motion-reduce:transition-none ${
              showAmounts ? "translate-x-[22px] bg-action-ink" : "translate-x-[2px] bg-ink-secondary"
            }`}
          />
        </button>
      </div>

      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-ink-secondary">
        {note}
      </p>

      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 rounded-full px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
        >
          Back
        </button>
        <button
          type="button"
          onClick={share}
          aria-disabled={!ready || undefined}
          className={buttonClass("primary", "aria-disabled:cursor-not-allowed aria-disabled:opacity-50")}
        >
          {canShare || !ready ? "Share" : "Save image"}
        </button>
      </div>
    </div>
  );
}
