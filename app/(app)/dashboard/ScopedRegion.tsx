"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DashboardRange } from "@/lib/dashboardRange";
import { DateRangeFilter } from "./DateRangeFilter";

// The dashboard's "Over time" region: the date-range filter, then the
// panels it scopes (passed in as server-rendered children). The filter
// navigates by pushing a new ?range=/?from=&to= URL inside a transition,
// so while the new server render streams in React keeps the previous
// children mounted -- this dims them rather than dropping a skeleton.
export function ScopedRegion({
  range,
  children,
}: {
  range: DashboardRange;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function apply(query: string) {
    startTransition(() => {
      router.push(query ? `/dashboard?${query}` : "/dashboard", { scroll: false });
    });
  }

  return (
    <section className="flex flex-col gap-6" aria-labelledby="dash-over-time">
      <h2 id="dash-over-time" className="text-sm font-medium text-ink-secondary">
        Over time
      </h2>

      <DateRangeFilter range={range} onApply={apply} pending={isPending} />

      <div
        aria-busy={isPending}
        className={`flex flex-col gap-6 motion-safe:transition-opacity motion-safe:duration-300 ${
          isPending ? "pointer-events-none opacity-50" : ""
        }`}
      >
        {children}
      </div>
    </section>
  );
}
