import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { getAccountDeletionSummary, getProfile } from "@/lib/db/profile";
import { requireUser } from "@/lib/auth/dal";
import { getSafeToSpendWindowPref, getSafeToSpendCushion } from "@/lib/db/settings";
import { getIncomeSchedules } from "@/lib/db/dashboard";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { SafeToSpendWindowToggle } from "./SafeToSpendWindowToggle";
import { SafeToSpendCushionForm } from "./SafeToSpendCushionForm";
import { ProfileForm } from "./ProfileForm";
import { Wordmark } from "@/components/Wordmark";
import pkg from "@/package.json";

const INLINE_LINK =
  "rounded font-medium text-action transition-colors duration-150 hover:text-action-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

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
  // that resolution has to happen -- getIncomeSchedules() is cache()'d,
  // so this doesn't cost a second query if getSafeToSpend() already ran
  // this request.
  const [windowPref, income, cushion, user, profile] = await Promise.all([
    getSafeToSpendWindowPref(),
    getIncomeSchedules(),
    getSafeToSpendCushion(),
    // cache()d -- the layout already resolved it for this request.
    requireUser(),
    getProfile(),
  ]);
  const resolvedWindowPref = windowPref ?? (income.data?.soonest ? "next_payday" : "end_of_month");
  // Why the fallback is or isn't in use. A failed read (already logged by
  // describeReadError) is none of these -- the toggle stays live with no
  // line, making no claim either way.
  const paycheck = !income.data
    ? null
    : income.data.soonest
      ? "tracked"
      : income.data.anyIncome
        ? "untracked"
        : "none";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="How Sorrel looks and behaves for you." />

      <section
        aria-labelledby="profile-heading"
        className="rounded-2xl border border-hairline bg-surface p-5"
      >
        <h2 id="profile-heading" className="text-base font-semibold text-ink">
          Profile
        </h2>
        {/* The one place the full address is shown -- the sidebar uses the
            name instead (see identityName in lib/displayName.ts). */}
        <dl className="mt-3 text-sm">
          <dt className="font-medium text-ink-secondary">Email</dt>
          <dd className="mt-1 break-all text-ink">{user.email ?? "No email on file"}</dd>
        </dl>

        {profile.data ? (
          <ProfileForm
            firstName={profile.data.first_name}
            lastName={profile.data.last_name}
            preferredName={profile.data.preferred_name}
          />
        ) : (
          <p className="mt-4 text-sm text-ink-muted">
            We couldn&apos;t load your name right now. Refresh to try again.
          </p>
        )}
      </section>

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
        {paycheck === "none" ? (
          <p className="mt-2 max-w-prose text-sm text-ink-secondary">
            Sorrel can&apos;t project forward without a paycheck. Add one in{" "}
            <Link href="/recurring" className={INLINE_LINK}>
              Recurring
            </Link>{" "}
            to get your true lowest point.
          </p>
        ) : paycheck === "untracked" ? (
          // Not "add a paycheck" -- they have one; it just lands somewhere
          // getSoonestIncomeOccurrence() doesn't count.
          <p className="mt-2 max-w-prose text-sm text-ink-secondary">
            Your income goes to an account safe to spend doesn&apos;t track, so Sorrel can&apos;t
            project forward from it. Point a paycheck at a checking or savings account in{" "}
            <Link href="/recurring" className={INLINE_LINK}>
              Recurring
            </Link>{" "}
            to get your true lowest point.
          </p>
        ) : null}

        {/* Never hidden: with a paycheck scheduled it sits idle and says why,
            rather than vanishing and reappearing as schedules come and go. */}
        <SafeToSpendWindowToggle
          initialPref={resolvedWindowPref}
          held={paycheck === "tracked"}
          className="mt-4"
        />
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
