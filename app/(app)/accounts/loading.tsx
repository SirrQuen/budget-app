import { LoadingSkeleton, PageHeaderSkeleton } from "@/components/ui/LoadingSkeleton";

export default function AccountsLoading() {
  return (
    <div role="status" aria-label="Loading accounts" className="flex flex-col gap-6">
      <PageHeaderSkeleton />

      {/* total-across-accounts hero tile */}
      <div className="rounded-2xl border border-hairline bg-surface p-4">
        <LoadingSkeleton className="h-4 w-40 bg-surface-raised" />
        <LoadingSkeleton className="mt-2 h-11 w-52 bg-surface-raised" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <LoadingSkeleton className="h-9 w-32 rounded-full bg-surface-raised" />
        <LoadingSkeleton className="h-8 w-32 rounded-full bg-surface-raised" />
      </div>

      <div className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <LoadingSkeleton className="h-4 w-40 bg-surface-raised" />
              <LoadingSkeleton className="mt-1.5 h-3 w-24 bg-surface-raised" />
            </div>
            <LoadingSkeleton className="h-4 w-24 shrink-0 bg-surface-raised" />
          </div>
        ))}
      </div>
    </div>
  );
}
