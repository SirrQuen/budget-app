import { LoadingSkeleton, PageHeaderSkeleton } from "@/components/ui/LoadingSkeleton";

export default function RecurringLoading() {
  return (
    <div role="status" aria-label="Loading recurring schedules" className="flex flex-col gap-6">
      <PageHeaderSkeleton />

      <LoadingSkeleton className="h-11 w-32 rounded-full bg-surface-raised" />

      <div className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 px-4 py-4">
            <div className="flex items-center gap-3">
              <LoadingSkeleton className="h-4 w-4 shrink-0 bg-surface-raised" />
              <LoadingSkeleton className="h-4 w-full max-w-[180px] flex-1 bg-surface-raised" />
              <LoadingSkeleton className="h-4 w-14 shrink-0 bg-surface-raised" />
            </div>
            <div className="flex items-center justify-between">
              <LoadingSkeleton className="h-3 w-40 bg-surface-raised" />
              <LoadingSkeleton className="h-3 w-28 bg-surface-raised" />
            </div>
            <LoadingSkeleton className="h-3 w-32 bg-surface-raised" />
          </div>
        ))}
      </div>
    </div>
  );
}
