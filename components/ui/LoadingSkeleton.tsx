// A single placeholder block. Decorative by default (aria-hidden) -- a
// loading.tsx wraps its skeleton in one `role="status"` region rather than
// announcing every block. The pulse is motion-safe: `prefers-reduced-motion`
// gets a static, slightly-dimmed placeholder instead.
export function LoadingSkeleton({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      {...props}
      className={`animate-pulse rounded-lg bg-surface motion-reduce:animate-none motion-reduce:opacity-60 ${className}`}
    />
  );
}

// Matches PageHeader's box model exactly (gap-3, border-b, pb-4; a 28px
// title line over a 16px description line) so the real header drops in
// without a shift.
export function PageHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-3 border-b border-hairline pb-4">
      <LoadingSkeleton className="h-7 w-44" />
      <LoadingSkeleton className="h-4 w-64 bg-surface-raised" />
    </div>
  );
}
