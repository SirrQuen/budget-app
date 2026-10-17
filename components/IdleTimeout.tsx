"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { idleSignOut } from "@/lib/auth/actions";
import { Button } from "@/components/ui/Button";
import {
  ACTIVITY_EVENTS,
  ACTIVITY_STORAGE_KEY,
  ACTIVITY_WRITE_THROTTLE_MS,
  IDLE_CONFIG,
  countdownAnnouncement,
  formatCountdown,
  idlePhase,
  mergeActivity,
  parseActivityRecord,
  signedOutElsewhere,
  signedOutHref,
  type ActivityRecord,
  type IdlePhase,
  type SignOutReason,
} from "@/lib/idleTimeout";

// Idle sign-out for authenticated pages -- mounted by AppShell, which only
// the (app) layout renders, so /, /login, /privacy and /terms never run it.
// The rules live in lib/idleTimeout.ts; this wires them to the browser.
//
// Every check compares timestamps with Date.now(): on an interval, on
// returning to the tab (visibilitychange, window focus), on another tab's
// activity (storage), and before any activity is recorded -- so the first
// mouse move after a laptop wakes signs out rather than counting as
// activity. Writes go to localStorage only, never the database.
//
// The warning is a modal. While it's open, ordinary activity in this tab
// doesn't dismiss it -- it's answered on purpose ("I'm still here", or
// Escape, which is the same answer). Activity in another tab of the
// session does close it.

const EVALUATE_EVERY_MS = 1_000;

function readRecord(): ActivityRecord | null {
  try {
    return parseActivityRecord(window.localStorage.getItem(ACTIVITY_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeRecord(record: ActivityRecord) {
  try {
    window.localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage blocked: this tab still times out on its own clock.
  }
}

export function IdleTimeout({ sessionId }: { sessionId: string }) {
  const lastActivityAt = useRef(0);
  const lastWriteAt = useRef(0);
  const warningOpen = useRef(false);
  const leaving = useRef(false);
  const lastAnnounced = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stillHereRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const leave = useCallback(
    async (reason: SignOutReason, tellOtherTabs: boolean) => {
      if (leaving.current) return;
      leaving.current = true;
      if (tellOtherTabs) {
        writeRecord({ sessionId, at: lastActivityAt.current, signedOut: reason });
      }
      try {
        await idleSignOut();
      } catch {
        // Unreachable server: Supabase's own inactivity timeout still ends
        // the session. Leave the page regardless.
      }
      // A full navigation, replacing this entry: no client state, router
      // cache or rendered figures survive it.
      window.location.replace(signedOutHref(reason));
    },
    [sessionId],
  );

  const evaluate = useCallback((): IdlePhase["kind"] => {
    if (leaving.current) return "expired";

    const record = readRecord();
    const elsewhere = signedOutElsewhere(record, sessionId);
    if (elsewhere) {
      void leave(elsewhere, false);
      return "expired";
    }

    lastActivityAt.current = mergeActivity(lastActivityAt.current, record, sessionId);
    const phase = idlePhase(Date.now(), lastActivityAt.current, IDLE_CONFIG);

    if (phase.kind === "expired") {
      void leave("timeout", true);
    } else if (phase.kind === "warning") {
      warningOpen.current = true;
      setRemainingMs(phase.remainingMs);
      const seconds = Math.ceil(phase.remainingMs / 1000);
      const text = countdownAnnouncement(seconds);
      if (text && lastAnnounced.current !== seconds) {
        lastAnnounced.current = seconds;
        setAnnouncement(text);
      }
    } else if (warningOpen.current) {
      // Another tab's activity reset the shared clock.
      warningOpen.current = false;
      lastAnnounced.current = null;
      setRemainingMs(null);
      setAnnouncement("");
    }
    return phase.kind;
  }, [leave, sessionId]);

  const stamp = useCallback(
    (now: number, force: boolean) => {
      lastActivityAt.current = now;
      if (force || now - lastWriteAt.current >= ACTIVITY_WRITE_THROTTLE_MS) {
        lastWriteAt.current = now;
        writeRecord({ sessionId, at: now });
      }
    },
    [sessionId],
  );

  const recordActivity = useCallback(() => {
    if (warningOpen.current || leaving.current) return;
    const now = Date.now();
    // Past the warning mark by this tab's own clock: check the real state
    // first. Another tab may have kept the session alive -- or it may have
    // expired while the machine slept, and this event must not revive it.
    if (now - lastActivityAt.current >= IDLE_CONFIG.warningMs && evaluate() !== "active") return;
    stamp(now, false);
  }, [evaluate, stamp]);

  const stillHere = useCallback(() => {
    if (leaving.current) return;
    const now = Date.now();
    if (idlePhase(now, lastActivityAt.current, IDLE_CONFIG).kind === "expired") {
      void leave("timeout", true);
      return;
    }
    stamp(now, true);
    warningOpen.current = false;
    lastAnnounced.current = null;
    setRemainingMs(null);
    setAnnouncement("");
  }, [leave, stamp]);

  useEffect(() => {
    // Start from the session's shared timestamp if there is one; a first
    // tab of a new session starts now.
    const record = readRecord();
    if (record && record.sessionId === sessionId) {
      lastActivityAt.current = record.at;
      lastWriteAt.current = record.at;
    } else {
      stamp(Date.now(), true);
    }
    evaluate();

    const onActivity = () => recordActivity();
    const onWindowFocus = () => {
      // Returning to the window: elapsed time first, then the activity.
      if (evaluate() === "active") recordActivity();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") evaluate();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACTIVITY_STORAGE_KEY) evaluate();
    };
    // Back/forward cache restores a frozen page, figures and all. Never show
    // it: reload, and let the server decide whether the session still exists.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };

    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, onActivity, { capture: true, passive: true });
    }
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", onPageShow);
    const interval = window.setInterval(evaluate, EVALUATE_EVERY_MS);

    return () => {
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity, { capture: true });
      }
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onPageShow);
      window.clearInterval(interval);
    };
  }, [evaluate, recordActivity, sessionId, stamp]);

  const open = remainingMs !== null;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Explicitly, after showModal: React's autoFocus fires at mount, while
      // the dialog is still closed, and the dialog would then land on its
      // first button -- "Sign out now".
      stillHereRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // Native modal dialog: the rest of the page is inert while it's open,
    // so Tab cycles between its two buttons. Neutral surface and ink only --
    // housekeeping, not an alarm: no status colour, no warning icon.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(e) => {
        // Escape is a person answering -- the same as "I'm still here".
        e.preventDefault();
        stillHere();
      }}
      className="mx-auto my-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-hairline bg-surface p-0 text-ink backdrop:bg-scrim"
    >
      {open ? (
        <div className="p-5">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            Still there?
          </h2>
          <p id={descId} className="mt-2 text-sm text-ink-secondary">
            We&apos;ll sign you out in {formatCountdown(remainingMs)} to keep your account safe.
          </p>
          {/* The visible countdown ticks; this only changes at intervals. */}
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => void leave("manual", true)}
              className="min-h-11 rounded-full px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Sign out now
            </button>
            <Button ref={stillHereRef} type="button" onClick={stillHere}>
              I&apos;m still here
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
