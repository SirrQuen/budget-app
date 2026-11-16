"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { DrawnCheck } from "@/components/ui/DrawnCheck";
import { prefersReducedMotion } from "@/components/ui/useReducedMotion";
import { dismissWhatsNewAction } from "@/lib/actions/whatsNew";
import { WHATS_NEW_LINES, WHATS_NEW_PRIVACY_LINE } from "@/lib/whatsNew";

// Neutral ink, no badge, no count, no status colour. Sits directly below
// the hero. "Got it" sets a cookie; the card is hidden at once.
export function WhatsNewCard() {
  const [hidden, setHidden] = useState(false);
  // The check draws for 250ms before the card goes; the cookie is set at
  // once. Under reduced motion the card goes at once.
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (hidden) return null;

  const dismiss = () => {
    if (prefersReducedMotion()) {
      setHidden(true);
    } else {
      setDone(true);
      setTimeout(() => setHidden(true), 250);
    }
    startTransition(async () => {
      await dismissWhatsNewAction();
    });
  };

  return (
    <section aria-labelledby="whats-new" className="rounded-xl border border-hairline bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 id="whats-new" className="text-sm font-medium text-ink">
          What&apos;s new
        </h2>
        <button
          type="button"
          onClick={dismiss}
          disabled={pending || done}
          className="inline-flex min-h-9 items-center gap-1 rounded px-1 text-xs font-medium text-ink-secondary underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50"
        >
          {done ? <DrawnCheck className="h-3.5 w-3.5" /> : null}
          Got it
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink-secondary">
        {WHATS_NEW_LINES.map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>
          <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
            {WHATS_NEW_PRIVACY_LINE}
          </Link>
        </li>
      </ul>
    </section>
  );
}
