"use client";

import { useEffect, useState } from "react";
import { FlameIcon } from "@/components/ui/icons";

// "Mid-afternoon" as a plain wall-clock hour, checked against the viewer's
// own device -- a nudge about *their* day, not the server's.
const NUDGE_START_HOUR = 15;

// A streak this short reads as "just started," not "worth protecting" --
// nudging under that would feel like pressure over nothing.
const NUDGE_MIN_DAYS = 3;

function isPastNudgeHour(d: Date): boolean {
  return d.getHours() >= NUDGE_START_HOUR;
}

export function StreakBadge({
  days,
  best,
  loggedToday,
}: {
  days: number;
  best: number;
  loggedToday: boolean;
}) {
  // Starts false to match server-rendered markup, then corrects itself on
  // the client -- the current hour is only ever meaningful in the viewer's
  // own browser, never during SSR.
  const [isAfternoon, setIsAfternoon] = useState(false);

  useEffect(() => {
    const tick = () => setIsAfternoon(isPastNudgeHour(new Date()));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const nudge = !loggedToday && days >= NUDGE_MIN_DAYS && isAfternoon;

  return (
    <div
      className="inline-flex flex-col items-center gap-0.5 rounded-2xl border border-hairline bg-surface px-4 py-3"
      title={nudge ? `Keep your ${days}-day streak going` : undefined}
    >
      <div className="relative flex items-center gap-1.5">
        {nudge ? (
          <span
            className="absolute -inset-2 rounded-full motion-safe:animate-[streak-nudge_2.6s_ease-in-out_infinite]"
            aria-hidden="true"
          />
        ) : null}
        <FlameIcon className="h-5 w-5 text-warning" aria-hidden="true" />
        <span className="text-xl font-semibold text-ink">{days}</span>
        <span className="text-sm text-ink-secondary">day{days === 1 ? "" : "s"}</span>
      </div>
      <p className="text-xs text-ink-muted">best: {best}</p>
      {nudge ? <span className="sr-only">Keep your {days}-day streak going</span> : null}
    </div>
  );
}
