import { SorrelMark } from "@/components/SorrelMark";

/**
 * Full-panel loading indicator: the Sorrel mark folding and reopening on a
 * loop. Only for loads with no content shape to stand in for -- anywhere a
 * skeleton exists or could, use the skeleton (components/ui/LoadingSkeleton),
 * which holds the layout still in a way no spinner can.
 *
 * Invisible for its first 300ms (.sorrel-loader in app/globals.css), so a
 * fast load shows nothing rather than a flash. Under reduced motion there is
 * no loop: the mark sits open and the "Loading…" label becomes visible.
 */
export function SorrelLoader({ className = "" }: { className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`sorrel-loader flex flex-col items-center justify-center gap-3 ${className}`}
    >
      {/* The label is the announcement; the mark is decoration on top. */}
      <span aria-hidden="true" className="block">
        <SorrelMark size={48} state="looping" />
      </span>
      <span className="sr-only text-sm text-ink-secondary motion-reduce:not-sr-only">
        Loading…
      </span>
    </div>
  );
}
