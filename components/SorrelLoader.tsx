import { SorrelFlower } from "@/components/SorrelFlower";

/**
 * Full-panel loading indicator: the Sorrel flower swaying on its stem. Only
 * for loads with no content shape to stand in for -- anywhere a skeleton
 * exists or could, use the skeleton (components/ui/LoadingSkeleton), which
 * holds the layout still in a way no spinner can.
 *
 * The sway, never the fold: the fold means the time of day changed, and a
 * loader that folded would make the two indistinguishable. The flower is
 * open because this renders as streamed server HTML, before anything can
 * know the viewer's local hour. Full-page, so the stemmed flower never sits
 * beside the stemless brand mark.
 *
 * Invisible for its first 300ms (.sorrel-loader in app/globals.css), so a
 * fast load shows nothing rather than a flash. Under reduced motion there is
 * no sway: the flower sits open and the "Loading…" label becomes visible.
 */
export function SorrelLoader({ className = "" }: { className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`sorrel-loader flex flex-col items-center justify-center gap-3 ${className}`}
    >
      {/* The label is the announcement; the flower is decoration on top. */}
      <span aria-hidden="true" className="block">
        <SorrelFlower size={48} state="open" swaying />
      </span>
      <span className="sr-only text-sm text-ink-secondary motion-reduce:not-sr-only">
        Loading…
      </span>
    </div>
  );
}
