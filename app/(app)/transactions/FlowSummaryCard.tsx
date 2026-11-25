import Link from "next/link";
import { toneClassName } from "@/components/ui/Amount";
import { ChevronRightIcon } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/format";
import { FLOW_TOP_DESKTOP, FLOW_TOP_PHONE, topCategories, type FlowCategory, type FlowSummary } from "@/lib/flowSummary";
import { flowCategoryHref, type FlowScope } from "@/lib/transactionFilters";

// A dashboard tile's drill-down (docs/Income-Spending-Drilldown.md): the
// filter chips, the tile's own total and count, and what it's made of by
// category. The headline and the categories are always the whole scope; a
// narrower search or filter gets its own "Showing" line, so a partial total
// never reads as the tile's figure.

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
const ROW = "flex min-h-11 items-center justify-between gap-3 text-sm";

export function FlowSummaryCard({
  scope,
  period,
  labels,
  summary,
  narrowed,
  clearHref,
  category,
}: {
  scope: FlowScope;
  period: string;
  labels: { short: string; phrase: string };
  summary: FlowSummary;
  /** The summary with the other filters applied; null when there are none. */
  narrowed: FlowSummary | null;
  clearHref: string;
  /** Set when the list is narrowed to one category: its chip, and the same drill-down without it. */
  category: { name: string; clearHref: string } | null;
}) {
  const name = scope.flow === "income" ? "Income" : "Spending";
  // Income wears the income colour; spending is ordinary ink, as on the tile.
  const tone = toneClassName(scope.flow === "income" ? "good" : "neutral");
  const money = (cents: number) => formatCurrency(cents / 100);
  const phone = topCategories(summary.categories, FLOW_TOP_PHONE);
  const desktop = topCategories(summary.categories, FLOW_TOP_DESKTOP);

  const row = (c: FlowCategory, index: number) => {
    const content = (
      <>
        <span className="flex min-w-0 items-center gap-0.5">
          <span className="min-w-0 break-words text-ink underline-offset-2 group-hover:underline">{c.name}</span>
          {c.categoryid ? (
            <ChevronRightIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted group-hover:text-ink" />
          ) : null}
        </span>
        <span className="shrink-0 font-medium tabular-nums text-ink">{money(c.cents)}</span>
      </>
    );
    return (
      // Rows past the phone's five show from the desktop breakpoint up.
      <li key={c.categoryid ?? "none"} className={index < FLOW_TOP_PHONE ? "" : "hidden md:block"}>
        {c.categoryid ? (
          <Link href={flowCategoryHref(c.categoryid, scope.flow, period)} className={`group rounded ${ROW} ${FOCUS}`}>
            {content}
          </Link>
        ) : (
          <div className={ROW}>{content}</div>
        )}
      </li>
    );
  };

  const chip = (text: string, removes: string, href: string) => (
    <Link
      href={href}
      aria-label={`Remove filter: ${removes}`}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border border-field-border bg-surface-raised px-4 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface ${FOCUS}`}
    >
      <span>{text}</span>
      <span aria-hidden="true">×</span>
    </Link>
  );

  const other = (cents: number | null, visibility: string) =>
    cents === null ? null : (
      <li className={`${ROW} ${visibility}`}>
        <span className="text-ink-secondary">Other categories</span>
        <span className="font-medium tabular-nums text-ink">{money(cents)}</span>
      </li>
    );

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-wrap gap-2">
        {chip(`${name} · ${labels.short}`, `${name}, ${labels.short}`, clearHref)}
        {category ? chip(category.name, category.name, category.clearHref) : null}
      </div>

      {/* An empty period has the list's friendly empty state instead. */}
      {summary.count === 0 ? null : (
        <section
          aria-labelledby="flow-summary-heading"
          className="w-full rounded-2xl border border-hairline bg-surface p-4 sm:p-5"
        >
          <h2 id="flow-summary-heading" className="text-sm font-medium text-ink-secondary">
            {name} {labels.phrase}
          </h2>
          <p className={`mt-1 text-3xl font-semibold ${tone}`}>{money(summary.cents)}</p>
          <p className="mt-1 text-sm text-ink-secondary">
            {summary.count.toLocaleString("en-US")} transaction{summary.count === 1 ? "" : "s"}
          </p>
          {narrowed && narrowed.count < summary.count ? (
            <p role="status" className="mt-2 text-sm font-medium text-ink">
              Showing {narrowed.count.toLocaleString("en-US")} of {summary.count.toLocaleString("en-US")} ·{" "}
              {money(narrowed.cents)} of {money(summary.cents)}
            </p>
          ) : null}

          <h3 className="mt-4 text-sm font-medium text-ink-secondary">
            {scope.flow === "income" ? "Where it came from" : "Where it went"}
          </h3>
          <ul className="mt-1 flex max-w-xl flex-col">
            {desktop.top.map(row)}
            {other(phone.otherCents, "md:hidden")}
            {other(desktop.otherCents, "hidden md:flex")}
          </ul>
        </section>
      )}
    </div>
  );
}
