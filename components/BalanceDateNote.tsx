import Link from "next/link";
import { formatDate } from "@/lib/format";
import { InfoIcon } from "@/components/ui/icons";

// "Your Checking balance is set as of ... and already includes this" --
// shown when SQL's anchor rule (counts_toward_balance_preview, migration
// 48) says a transaction on this account and date won't move the balance.
// Callers ask SQL and render this only on a `false` answer; this component
// never decides. Used by the transaction form and the recurring
// confirmation sheet, so both say it the same way. The fix is the
// account's edit form, where a new balance and its date are set together.
export function BalanceDateNote({
  accountId,
  accountName,
  openingDate,
}: {
  accountId: string;
  accountName: string;
  openingDate: string;
}) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink-secondary">
      <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
      <span className="flex-1">
        Your {accountName} balance is set as of {formatDate(openingDate)} and already includes this,
        so it won&apos;t change that balance.{" "}
        <Link
          href={`/accounts?edit=${accountId}#account-${accountId}`}
          className="font-medium text-action underline-offset-2 hover:text-action-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
        >
          Update the {accountName} balance
        </Link>
      </span>
    </p>
  );
}
