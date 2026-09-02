import { LoadingSkeleton, PageHeaderSkeleton } from "@/components/ui/LoadingSkeleton";

function GroupSkeleton({ rows }: { rows: number }) {
  return (
    <section className="flex flex-col gap-2">
      <LoadingSkeleton className="mx-1 h-4 w-28 bg-surface-raised" />
      <div className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <LoadingSkeleton className="h-2.5 w-2.5 shrink-0 rounded-full bg-surface-raised" />
            <LoadingSkeleton className="h-4 w-4 shrink-0 bg-surface-raised" />
            <LoadingSkeleton className="h-4 w-36 bg-surface-raised" />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function CategoriesLoading() {
  return (
    <div role="status" aria-label="Loading categories" className="flex flex-col gap-6">
      <PageHeaderSkeleton />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <LoadingSkeleton className="h-9 w-52 rounded-full bg-surface-raised" />
        <LoadingSkeleton className="h-8 w-32 rounded-full bg-surface-raised" />
      </div>

      <LoadingSkeleton className="h-9 w-36 rounded-full bg-surface-raised" />

      <div className="flex flex-col gap-6">
        <GroupSkeleton rows={4} />
        <GroupSkeleton rows={3} />
        <GroupSkeleton rows={5} />
      </div>
    </div>
  );
}
