import { LoadingSkeleton, PageHeaderSkeleton } from "@/components/ui/LoadingSkeleton";

export default function AccountLoading() {
  return (
    <div role="status" aria-label="Loading account" className="flex flex-col gap-6">
      <PageHeaderSkeleton />

      {/* balance hero */}
      <div className="rounded-2xl border border-hairline bg-surface p-4">
        <LoadingSkeleton className="h-4 w-24 bg-surface-raised" />
        <LoadingSkeleton className="mt-2 h-11 w-52 bg-surface-raised" />
      </div>

      <LoadingSkeleton className="h-9 w-36 rounded-full bg-surface-raised" />
      <LoadingSkeleton className="h-24 w-full rounded-2xl bg-surface-raised" />
    </div>
  );
}
