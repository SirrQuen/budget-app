"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { DrawnCheck } from "@/components/ui/DrawnCheck";
import { prefersReducedMotion } from "@/components/ui/useReducedMotion";
import { requestRunway } from "@/lib/runwayRequest";
import { WHATS_NEW_PHONE_LINES, type WhatsNewItem } from "@/lib/whatsNew";
import { requestYourSorrel } from "@/lib/yourSorrel";

// Neutral ink, no badge, no count, no status colour. Sits directly below
// the hero. "Got it" sets a cookie; the card is hidden at once.
//
// Each line is a link in the dashboard's action-link pill style (the hero's
// "See your runway"). On a phone only the first WHATS_NEW_PHONE_LINES show,
// with a real "Show all" button that expands in place; from md up every line
// shows and the button isn't there. The lines are all in the markup either
// way: nothing is fetched or written to expand.

const pill =
  "inline-flex min-h-11 items-center rounded-2xl px-2 py-1.5 -mx-2 text-left text-sm font-medium text-ink-secondary underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export function WhatsNewCard({
  items,
  runwayAvailable,
  dismiss,
}: {
  items: readonly WhatsNewItem[];
  /** The Safe to Spend card is on the page to answer "runway". */
  runwayAvailable: boolean;
  /** The "Got it" Server Function: sets a cookie, never writes the database. */
  dismiss: () => Promise<void>;
}) {
  const [hidden, setHidden] = useState(false);
  // The check draws for 250ms before the card goes; the cookie is set at
  // once. Under reduced motion the card goes at once.
  const [done, setDone] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const listId = useId();

  if (hidden) return null;

  const onGotIt = () => {
    if (prefersReducedMotion()) {
      setHidden(true);
    } else {
      setDone(true);
      setTimeout(() => setHidden(true), 250);
    }
    startTransition(async () => {
      await dismiss();
    });
  };

  const hiddenOnPhone = items.length > WHATS_NEW_PHONE_LINES;

  return (
    <section aria-labelledby="whats-new" className="rounded-xl border border-hairline bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 id="whats-new" className="text-sm font-medium text-ink">
          What&apos;s new
        </h2>
        <button
          type="button"
          onClick={onGotIt}
          disabled={pending || done}
          className="inline-flex min-h-9 items-center gap-1 rounded px-1 text-xs font-medium text-ink-secondary underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50"
        >
          {done ? <DrawnCheck className="h-3.5 w-3.5" /> : null}
          Got it
        </button>
      </div>
      <ul id={listId} className="mt-2 flex flex-col gap-0.5 text-sm text-ink-secondary">
        {items.map((item, index) => {
          // Past the phone's first lines: hidden below md until expanded.
          const extra = index >= WHATS_NEW_PHONE_LINES;
          const cls = extra ? (expanded ? "whats-new-reveal" : "hidden md:list-item") : "";
          return (
            <li key={item.id} className={cls} data-whats-new={item.id}>
              <Line item={item} runwayAvailable={runwayAvailable} />
            </li>
          );
        })}
      </ul>
      {hiddenOnPhone ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
          className={`${pill} mt-1 md:hidden`}
        >
          {expanded ? "Show fewer" : `Show all ${items.length}`}
        </button>
      ) : null}
    </section>
  );
}

function Line({ item, runwayAvailable }: { item: WhatsNewItem; runwayAvailable: boolean }) {
  const { action } = item;
  switch (action.kind) {
    case "none":
      // Nothing to open yet: plain text, the same size, no pill.
      return <span className="block py-1.5">{item.text}</span>;
    case "href":
      return (
        <Link href={action.href} className={pill}>
          {item.text}
        </Link>
      );
    case "card":
      // A hash link to the card's place on the dashboard. If the person has
      // hidden that card there is nothing to land on, and nothing happens.
      return (
        <a href={action.href} className={pill}>
          {item.text}
        </a>
      );
    case "runway":
      // Without a Safe to Spend card on the page there's no runway to open.
      return runwayAvailable ? (
        <button type="button" onClick={() => requestRunway()} className={pill}>
          {item.text}
        </button>
      ) : (
        <span className="block py-1.5">{item.text}</span>
      );
    case "yourSorrel":
      return (
        <button type="button" onClick={(e) => requestYourSorrel(e.currentTarget)} className={pill}>
          {item.text}
        </button>
      );
  }
}
