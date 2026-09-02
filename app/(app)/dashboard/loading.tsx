import { LoadingSkeleton, PageHeaderSkeleton } from "@/components/ui/LoadingSkeleton";

function TileSkeleton() {
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-4">
      <LoadingSkeleton className="h-4 w-24 bg-surface-raised" />
      <LoadingSkeleton className="mt-2 h-7 w-28 bg-surface-raised" />
      <LoadingSkeleton className="mt-2 h-4 w-32 bg-surface-raised" />
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="min-w-0 lg:flex-1 lg:basis-0">
      <div className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
        <LoadingSkeleton className="h-4 w-20 bg-surface-raised" />
        <div className="mt-4 flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <LoadingSkeleton className="h-3 w-full bg-surface-raised" />
              <LoadingSkeleton className="h-2 w-full rounded-full bg-surface-raised" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Shaped for the full dashboard -- the common case. A brand-new user
// (progressive empty state) briefly sees more skeleton than content;
// that's a one-time cost, and matching the returning-user layout keeps
// every later load jump-free.
export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading the dashboard" className="flex flex-col gap-10">
      <section className="flex flex-col gap-6">
        <PageHeaderSkeleton />
        <LoadingSkeleton className="h-4 w-20 bg-surface-raised" />

        {/* safe-to-spend hero */}
        <div className="rounded-2xl border border-hairline bg-surface p-5">
          <LoadingSkeleton className="h-4 w-28 bg-surface-raised" />
          <LoadingSkeleton className="mt-2 h-11 w-56 bg-surface-raised" />
          <LoadingSkeleton className="mt-3 h-4 w-64 bg-surface-raised" />
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <TileSkeleton />
          <TileSkeleton />
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          <PanelSkeleton />
          <PanelSkeleton />
          <PanelSkeleton />
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <LoadingSkeleton className="h-4 w-20 bg-surface-raised" />
        <LoadingSkeleton className="h-[52px] w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <TileSkeleton />
          <TileSkeleton />
        </div>
        <LoadingSkeleton className="h-[360px] w-full rounded-2xl" />
      </section>
    </div>
  );
}
