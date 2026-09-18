import { PageHeader } from "@/components/ui/PageHeader";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { getAccountDeletionSummary } from "@/lib/db/profile";
import { getSafeToSpendWindowPref } from "@/lib/db/settings";
import { getSoonestIncomeOccurrence } from "@/lib/db/dashboard";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { SafeToSpendWindowToggle } from "./SafeToSpendWindowToggle";

export default async function SettingsPage() {
  // The breakdown of what deletion removes -- null when the count query
  // fails. The section renders either way (see DeleteAccountSection): a
  // failed SELECT must not block someone from erasing their own data.
  const summary = await getAccountDeletionSummary();

  // Resolves the same "unset -> dynamic default" rule getSafeToSpend()
  // applies (lib/db/dashboard.ts): next payday when an income schedule
  // exists, end of month otherwise. The toggle only ever shows one of the
  // three concrete options, never a 4th "auto" state, so this is where
  // that resolution has to happen -- getSoonestIncomeOccurrence() is
  // cache()'d, so this doesn't cost a second query if getSafeToSpend()
  // already ran this request.
  const [windowPref, nextIncome] = await Promise.all([
    getSafeToSpendWindowPref(),
    getSoonestIncomeOccurrence(),
  ]);
  const resolvedWindowPref = windowPref ?? (nextIncome.data ? "next_payday" : "end_of_month");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="How Sorrel looks and behaves for you." />

      <section
        aria-labelledby="appearance-heading"
        className="rounded-2xl border border-hairline bg-surface p-5"
      >
        <h2 id="appearance-heading" className="text-base font-semibold text-ink">
          Appearance
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-secondary">
          System follows your device. Pick Light or Dark to override it — your choice follows your
          account to every device you sign in on.
        </p>

        {/* The control reads and writes through ThemeProvider, mounted in
            app/(app)/layout.tsx, so this and the nav copy stay in step. */}
        <ThemeToggle className="mt-4" />
      </section>

      <section
        aria-labelledby="safe-to-spend-heading"
        className="rounded-2xl border border-hairline bg-surface p-5"
      >
        <h2 id="safe-to-spend-heading" className="text-base font-semibold text-ink">
          Safe to spend
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-secondary">
          What the dashboard hero counts down to. Next payday follows your soonest upcoming income
          schedule, falling back to end of month when you don&apos;t have one.
        </p>

        <SafeToSpendWindowToggle initialPref={resolvedWindowPref} className="mt-4" />
      </section>

      {/* Last, below everything else. Always rendered -- summary is null if
          the count query failed, and the section handles that itself. */}
      <DeleteAccountSection summary={summary.data} />
    </div>
  );
}
