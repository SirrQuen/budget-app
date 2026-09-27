import { LoadError } from "@/components/ui/LoadError";

// A dashboard section that failed to load says so, in place. It never just
// vanishes -- a silently missing panel is how the category-movement chart
// hid a broken RPC for a week. Calm, small, and the rest of the page renders
// around it; "Try again" refetches without reloading the page that works.
//
// Only for a lone failure. With two or more, the dashboard page suppresses
// these and shows one page-level LoadError instead (see DashboardPage).
export function SectionError({ label }: { label: string }) {
  return <LoadError message={`${label} didn’t load.`} />;
}
