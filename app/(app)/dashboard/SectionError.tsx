import { InfoIcon } from "@/components/ui/icons";

// A dashboard section that failed to load says so, in place. It never just
// vanishes -- a silently missing panel is how the category-movement chart
// hid a broken RPC for a week. Calm, small, and the rest of the page renders
// around it.
export function SectionError({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-2xl border border-hairline bg-surface px-4 py-3 text-sm text-ink-secondary"
    >
      <InfoIcon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
      <span>
        {label} didn&rsquo;t load. Refresh the page to try again.
      </span>
    </div>
  );
}
