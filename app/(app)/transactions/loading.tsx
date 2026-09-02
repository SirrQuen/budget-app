import { LoadingSkeleton, PageHeaderSkeleton } from "@/components/ui/LoadingSkeleton";

export default function TransactionsLoading() {
  return (
    <div role="status" aria-label="Loading transactions" className="flex flex-col gap-6">
      <PageHeaderSkeleton />

      {/* add-transaction button */}
      <LoadingSkeleton className="h-9 w-36 rounded-full bg-surface-raised" />

      {/* filter bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-hairline bg-surface p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <LoadingSkeleton className="h-3 w-14 bg-surface-raised" />
            <LoadingSkeleton className="h-9 w-32 bg-surface-raised" />
          </div>
        ))}
        <LoadingSkeleton className="h-9 w-20 rounded-full bg-surface-raised" />
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        <div className="border-b border-hairline px-4 py-3">
          <LoadingSkeleton className="h-4 w-full max-w-[560px] bg-surface-raised" />
        </div>
        <div className="divide-y divide-hairline">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <LoadingSkeleton className="h-4 w-4 shrink-0 bg-surface-raised" />
              <LoadingSkeleton className="h-4 w-20 shrink-0 bg-surface-raised" />
              <LoadingSkeleton className="h-4 flex-1 bg-surface-raised" />
              <LoadingSkeleton className="h-4 w-24 shrink-0 bg-surface-raised" />
              <LoadingSkeleton className="h-4 w-20 shrink-0 bg-surface-raised" />
            </div>
          ))}
        </div>
      </div>

      {/* pagination footer */}
      <div className="flex items-center justify-between">
        <LoadingSkeleton className="h-4 w-40 bg-surface-raised" />
        <LoadingSkeleton className="h-4 w-32 bg-surface-raised" />
      </div>
    </div>
  );
}
