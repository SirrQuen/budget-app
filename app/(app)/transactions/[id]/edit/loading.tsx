import { LoadingSkeleton, PageHeaderSkeleton } from "@/components/ui/LoadingSkeleton";

export default function EditTransactionLoading() {
  return (
    <div role="status" aria-label="Loading transaction" className="flex flex-col gap-6">
      <PageHeaderSkeleton />

      <div className="rounded-2xl border border-hairline bg-surface p-5">
        <div className="flex items-center justify-between">
          <LoadingSkeleton className="h-5 w-36 bg-surface-raised" />
          <LoadingSkeleton className="h-4 w-14 bg-surface-raised" />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <LoadingSkeleton className="h-3 w-20 bg-surface-raised" />
              <LoadingSkeleton className="h-10 w-full bg-surface-raised" />
            </div>
          ))}
        </div>

        <LoadingSkeleton className="mt-5 h-10 w-full rounded-lg bg-surface-raised" />
        <LoadingSkeleton className="mt-5 h-10 w-32 rounded-full bg-surface-raised" />
      </div>

      <LoadingSkeleton className="h-4 w-36 bg-surface-raised" />
    </div>
  );
}
