"use client";

import { DayNightMark } from "@/components/DayNightMark";
import { SceneBanner } from "@/components/SceneBanner";
import { useToday } from "@/components/TodayProvider";
import { Visitor } from "@/components/Visitor";
import type { MarkState, Season, TimeBand } from "@/lib/timeOfDay";
import { YourSorrelLink } from "./YourSorrelLink";

// The dashboard's own banner: the scene, the greeting, "Your Sorrel", and the
// roselle on the near hill with the visitor perched on it. useToday() so a tab
// left open past midnight moves its date (and the visitor's stamp) on.
export function DashboardBanner({
  timeZone,
  band,
  greetings,
  season,
  plantState,
}: {
  timeZone: string | null;
  band: TimeBand;
  greetings: Record<TimeBand, string>;
  season: Season;
  plantState: MarkState;
}) {
  const today = useToday();
  return (
    <SceneBanner
      timeZone={timeZone}
      initialBand={band}
      greetings={greetings}
      today={today}
      pill={<YourSorrelLink season={season} />}
      perch={(live) => (
        <>
          <DayNightMark timeZone={timeZone} initialState={plantState} />
          {/* A new band is a new visitor. */}
          <Visitor key={live} band={live} today={today} />
        </>
      )}
    />
  );
}
