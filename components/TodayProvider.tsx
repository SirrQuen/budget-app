"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { syncTimeZoneAction } from "@/lib/actions/settings";
import { todayInZone } from "@/lib/date";

// The user's calendar day for Client Components. It has to come from the
// server: a Client Component also renders on the server, where `new Date()`
// is the host's clock in the host's zone (UTC in production), so reading the
// clock during render gave the date field tomorrow's date after 8pm EDT.
// Render-time code uses useToday(). Never call new Date() for a calendar day.
const TodayContext = createContext<string | null>(null);

export function useToday(): string {
  const today = useContext(TodayContext);

  if (today === null) {
    throw new Error("useToday must be used inside TodayProvider.");
  }

  return today;
}

const TICK_MS = 60_000;

export function TodayProvider({
  today,
  timeZone,
  children,
}: {
  /** getToday() -- the user's day, from the server. */
  today: string;
  /** settings.timezone, or null when it hasn't been reported yet (UTC). */
  timeZone: string | null;
  children: React.ReactNode;
}) {
  // null until the first tick, so hydration renders exactly the server's
  // value. After that the day is recomputed in the same stored zone, so a
  // tab left open past midnight moves on to the new day.
  const [now, setNow] = useState<Date | null>(null);
  const reported = useRef<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    const timer = setInterval(tick, TICK_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Keeps settings.timezone equal to the browser's zone: set on the first
  // load after signup, updated when the user travels. Once per zone per
  // mount, so a zone the server can't store never turns into a loop. The
  // action revalidates the layout, which re-renders with the new zone.
  useEffect(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    if (browserZone === timeZone || reported.current === browserZone) {
      return;
    }
    reported.current = browserZone;
    // A failed report (offline, deploy mid-flight) just waits for the next load.
    syncTimeZoneAction(browserZone).catch(() => {});
  }, [timeZone]);

  const value = now === null ? today : todayInZone(timeZone, now);

  return <TodayContext.Provider value={value}>{children}</TodayContext.Provider>;
}
