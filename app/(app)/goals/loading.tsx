import { LoadingSkeleton, PageHeaderSkeleton } from "@/components/ui/LoadingSkeleton";

export default function GoalsLoading() {
  return (
    <div role="status" aria-label="Loading goals" className="flex flex-col gap-6">
      <PageHeaderSkeleton />

      {/* saved-toward-goals hero tile */}
      <div className="rounded-2xl border border-hairline bg-surface p-4">
        <LoadingSkeleton className="h-4 w-44 bg-surface-raised" />
        <LoadingSkeleton className="mt-2 h-11 w-48 bg-surface-raised" />
      </div>

      <LoadingSkeleton className="h-9 w-24 rounded-full bg-surface-raised" />

      <div className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 px-4 py-4">
            <div className="flex items-center gap-3">
              <LoadingSkeleton className="h-4 w-4 shrink-0 bg-surface-raised" />
              <LoadingSkeleton className="h-4 w-full max-w-[160px] flex-1 bg-surface-raised" />
              <LoadingSkeleton className="h-5 w-16 shrink-0 rounded-full bg-surface-raised" />
            </div>
            <LoadingSkeleton className="h-2 w-full rounded-full bg-surface-raised" />
            <div className="flex items-center justify-between">
              <LoadingSkeleton className="h-3 w-32 bg-surface-raised" />
              <LoadingSkeleton className="h-3 w-20 bg-surface-raised" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
