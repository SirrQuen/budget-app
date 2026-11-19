import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { LeafIcon } from "@/components/ui/LeafIcon";
import { getEarnedMilestones } from "@/lib/db/milestones";
import { formatDate } from "@/lib/format";

// Settings > Your Sorrel (docs/Decide-and-Grow.md, J): the milestones
// earned so far, each with its date. Earned ones only -- there is no locked
// list to fill, and nothing here is an amount or a comparison. Derived on
// every load from rows that already exist; nothing is stored.
export async function YourSorrelSection() {
  const result = await getEarnedMilestones();

  return (
    <section aria-labelledby="your-sorrel-heading" className="rounded-2xl border border-hairline bg-surface p-5">
      <h2 id="your-sorrel-heading" className="text-base font-semibold text-ink">
        Your Sorrel
      </h2>
      {result.error !== null ? (
        <div className="mt-2">
          <ErrorMessage message={result.error} />
        </div>
      ) : result.data.length === 0 ? (
        <p className="mt-1 text-sm text-ink-secondary">Moments from your time with Sorrel collect here as they happen.</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-hairline">
          {result.data.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-4 py-2 text-sm">
              <span className="flex items-center gap-2 text-ink">
                <LeafIcon className="h-3.5 w-3.5 shrink-0 text-gold" />
                {m.label}
              </span>
              <span className="shrink-0 text-ink-secondary">{formatDate(m.date)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
