import { PageHeader } from "@/components/ui/PageHeader";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { getAccountDeletionSummary } from "@/lib/db/profile";
import { getSafeToSpendWindowPref, getSafeToSpendCushion } from "@/lib/db/settings";
import { getSoonestIncomeOccurrence } from "@/lib/db/dashboard";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { SafeToSpendWindowToggle } from "./SafeToSpendWindowToggle";
import { SafeToSpendCushionForm } from "./SafeToSpendCushionForm";
import { Wordmark } from "@/components/Wordmark";
import pkg from "@/package.json";

const LEGAL_LINK =
  "rounded transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

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
  const [windowPref, nextIncome, cushion] = await Promise.all([
    getSafeToSpendWindowPref(),
    getSoonestIncomeOccurrence(),
    getSafeToSpendCushion(),
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
          The dashboard looks ahead through your payday after next (at least five weeks) and finds
          the lowest your balance gets. Safe to spend is that low point, minus a cushion you keep
          in reserve.
        </p>

        {cushion.data ? (
          <SafeToSpendCushionForm
            amount={cushion.data.amount}
            isDefault={cushion.data.isDefault}
            suggested={cushion.data.suggested}
          />
        ) : (
          <p className="mt-4 text-sm text-ink-muted">
            We couldn&apos;t load your cushion right now. Refresh to try again.
          </p>
        )}

        <h3 className="mt-6 text-sm font-semibold text-ink">Without a paycheck</h3>
        <p className="mt-1 max-w-prose text-sm text-ink-secondary">
          With no income schedule to look ahead to, safe to spend counts down to this instead.
        </p>

        <SafeToSpendWindowToggle initialPref={resolvedWindowPref} className="mt-4" />
      </section>

      <section
        aria-labelledby="about-heading"
        className="rounded-2xl border border-hairline bg-surface p-5"
      >
        <h2 id="about-heading" className="text-base font-semibold text-ink">
          About
        </h2>
        {/* No ™ here: this is behind login, and the ™ goes on first public
            use only (the auth splash and OG image). */}
        <p className="mt-1 text-sm text-ink-secondary">
          <Wordmark className="font-semibold text-ink" /> · Version {pkg.version}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          © {new Date().getFullYear()} Sorrel. All rights reserved.
        </p>

        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-secondary">
          {/* TODO(launch blocker): point these at the real Privacy Policy and
              Terms of Service once they exist. "#" is a placeholder. */}
          <li>
            <a href="#" className={LEGAL_LINK}>
              Privacy Policy
            </a>
          </li>
          <li>
            <a href="#" className={LEGAL_LINK}>
              Terms of Service
            </a>
          </li>
        </ul>
      </section>

      {/* Last, below everything else. Always rendered -- summary is null if
          the count query failed, and the section handles that itself. */}
      <DeleteAccountSection summary={summary.data} />
    </div>
  );
}
