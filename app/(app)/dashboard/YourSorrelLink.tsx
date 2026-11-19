"use client";

import { SeasonalLeaf } from "@/components/SeasonalLeaf";
import type { Season } from "@/lib/timeOfDay";
import { requestYourSorrel, YOUR_SORREL_LINK_ID } from "@/lib/yourSorrel";

// "Your Sorrel", beside the greeting, with the season's leaf: opens the
// panel (components/YourSorrelPanel.tsx). A button -- it opens a dialog, it
// goes nowhere. The leaf is decoration; the words name the control.
export function YourSorrelLink({ season }: { season: Season }) {
  return (
    <button
      type="button"
      id={YOUR_SORREL_LINK_ID}
      onClick={(e) => requestYourSorrel(e.currentTarget)}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page"
    >
      <SeasonalLeaf season={season} size={22} />
      Your Sorrel
    </button>
  );
}
