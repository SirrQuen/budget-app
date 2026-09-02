import { LoadingSkeleton, PageHeaderSkeleton } from "@/components/ui/LoadingSkeleton";

export default function SettingsLoading() {
  return (
    <div role="status" aria-label="Loading settings" className="flex flex-col gap-6">
      <PageHeaderSkeleton />

      {/* Appearance */}
      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <LoadingSkeleton className="h-5 w-32 bg-surface-raised" />
        <LoadingSkeleton className="mt-2 h-4 w-full max-w-md bg-surface-raised" />
        <LoadingSkeleton className="mt-4 h-11 w-64 rounded-full bg-surface-raised" />
      </section>

      {/* Delete account */}
      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <LoadingSkeleton className="h-5 w-36 bg-surface-raised" />
        <LoadingSkeleton className="mt-2 h-4 w-full max-w-md bg-surface-raised" />
        <LoadingSkeleton className="mt-2 h-4 w-64 bg-surface-raised" />
        <LoadingSkeleton className="mt-4 h-4 w-40 bg-surface-raised" />
        <LoadingSkeleton className="mt-2 h-10 w-full max-w-xs bg-surface-raised" />
        <LoadingSkeleton className="mt-3 h-10 w-40 rounded-full bg-surface-raised" />
      </section>
    </div>
  );
}
