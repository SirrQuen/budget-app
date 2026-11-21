import { buttonClass } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { listImports } from "@/lib/db/imports";
import { getTimeZone } from "@/lib/db/settings";
import { todayInZone } from "@/lib/date";
import { formatDayMonth } from "@/lib/format";
import Link from "next/link";
import { AccountLink } from "@/components/AccountLink";
import { UndoImportButton } from "../import/UndoImportButton";

// Settings > Import: where an import starts, and where an old one can be
// undone (docs/Import-CSV.md, steps 1 and 11). A batch is labelled by its
// date and count -- never a filename, which can carry an account number.
export async function ImportsSection() {
  const [imports, timeZone] = await Promise.all([listImports(), getTimeZone()]);

  return (
    <section aria-labelledby="import-heading" className="rounded-2xl border border-hairline bg-surface p-5">
      <h2 id="import-heading" className="text-base font-semibold text-ink">
        Import
      </h2>
      <p className="mt-1 max-w-prose text-sm text-ink-secondary">
        Bring in a CSV file from your bank. It&apos;s read on your device: descriptions and amounts stay there until you
        confirm, and before that Sorrel only checks the file&apos;s dates against your balance dates. You see what it does
        to your balances before anything is saved. Every import can be undone.
      </p>
      <Link href="/import" className={buttonClass("primary", "mt-4")}>
        Import transactions
      </Link>

      <h3 className="mt-6 text-sm font-semibold text-ink">Past imports</h3>
      {imports.error !== null ? (
        <div className="mt-2">
          <ErrorMessage message={imports.error} />
        </div>
      ) : imports.data.length === 0 ? (
        <p className="mt-1 text-sm text-ink-secondary">Nothing imported yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-hairline">
          {imports.data.map((i) => (
            <li key={i.importId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
              <p className="text-sm text-ink">
                Imported {formatDayMonth(todayInZone(timeZone, new Date(i.createdAt)))} ·{" "}
                <AccountLink accountId={i.accountId} nameClassName="">
                  {i.accountName}
                </AccountLink>{" "}
                ·{" "}
                {i.rowCount.toLocaleString("en-US")} {i.rowCount === 1 ? "transaction" : "transactions"}
                {i.remainingCount < i.rowCount ? (
                  <span className="text-ink-secondary"> ({i.remainingCount.toLocaleString("en-US")} left)</span>
                ) : null}
              </p>
              <UndoImportButton importId={i.importId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
