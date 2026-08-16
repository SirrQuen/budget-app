export function LoadingSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`animate-pulse rounded-xl bg-surface motion-reduce:animate-none motion-reduce:opacity-60 ${className}`}
    />
  );
}
