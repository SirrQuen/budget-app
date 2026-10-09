import Link from "next/link";
import {
  listCategories,
  listCategoryActivity,
  listCategoryGroups,
  type CategoryActivity,
  type CategoryWithGroup,
} from "@/lib/db/categories";
import type { TransactionType } from "@/lib/db/transactions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/LoadError";
import { TagIcon } from "@/components/ui/icons";
import { CreateCategoryForm } from "./CreateCategoryForm";
import { CategoryRow } from "./CategoryRow";

const TYPE_FILTERS: { label: string; value: TransactionType | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Income", value: "Income" },
  { label: "Expense", value: "Expense" },
];

// Name, group, this month, actions -- identical on every group's list on
// this screen so the money column reads as a real column, same reasoning
// as ACCOUNT_ROW_GRID in the accounts screen. Each group here is its own
// separate card (no shared section wrapping several groups the way
// accounts nests type-groups inside "What you have"), so this template is
// applied independently per group rather than subgridded across all of
// them -- see CategoryRow's own grid-cols-subgrid for the row level.
const CATEGORY_ROW_GRID =
  "sm:grid sm:grid-cols-[minmax(0,min(28rem,1fr))_auto_max-content_max-content] sm:gap-x-4 sm:px-4";

function noActivity(categoryId: string): CategoryActivity {
  return { categoryId, currentMonthTotal: 0, lifetimeTransactionCount: 0, lastTransactionDate: null };
}

function buildHref(type: TransactionType | "all", archived: boolean) {
  const params = new URLSearchParams();
  if (type !== "all") params.set("type", type);
  if (archived) params.set("archived", "1");
  const qs = params.toString();
  return `/categories${qs ? `?${qs}` : ""}`;
}

export default async function CategoriesPage({ searchParams }: PageProps<"/categories">) {
  const params = await searchParams;
  const type: TransactionType | "all" =
    params.type === "Income" || params.type === "Expense" ? params.type : "all";
  const showArchived = params.archived === "1";

  const [categoriesResult, groupsResult, activityResult] = await Promise.all([
    listCategories({
      ...(type !== "all" ? { category_type: type } : {}),
      ...(showArchived ? {} : { is_active: true }),
    }),
    listCategoryGroups(),
    // "This month" only -- a failure here shouldn't take down the whole
    // categories list. But it must not read as zero either: the rows show
    // no figure and a notice says the totals didn't load
    // (docs/phase-7-findings.md, "a failed read renders as a plausible
    // zero"). null means the read failed; a category with no entry in a
    // successful read genuinely has no activity.
    listCategoryActivity(),
  ]);
  const activityByCategoryId =
    activityResult.error === null
      ? new Map(activityResult.data.map((a) => [a.categoryId, a]))
      : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Categories"
        description="Organize how your spending and income are grouped."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-field-border bg-surface p-1">
          {TYPE_FILTERS.map((filter) => {
            const active = filter.value === type;
            return (
              <Link
                key={filter.value}
                href={buildHref(filter.value, showArchived)}
                aria-current={active || undefined}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                  active ? "bg-action text-action-ink" : "text-ink-secondary hover:text-ink"
                }`}
              >
                {filter.label}
              </Link>
            );
          })}
        </div>

        <Link
          href={buildHref(type, !showArchived)}
          aria-pressed={showArchived}
          className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-all duration-150 ease-out hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page ${
            showArchived
              ? "border-action bg-action text-action-ink"
              : "border-field-border bg-surface text-ink-secondary hover:text-ink"
          }`}
        >
          {showArchived ? "Showing archived" : "Show archived"}
        </Link>
      </div>

      {categoriesResult.error !== null || groupsResult.error !== null ? (
        <LoadError
          message={
            categoriesResult.error ??
            groupsResult.error ??
            "We couldn't load your categories. Refresh the page to try again."
          }
        />
      ) : (
        <>
          <CreateCategoryForm groups={groupsResult.data} />
          {activityResult.error !== null ? (
            <LoadError message="This month’s totals didn’t load." />
          ) : null}
          <CategoryGroups
            categories={categoriesResult.data}
            groups={groupsResult.data}
            activityByCategoryId={activityByCategoryId}
          />
        </>
      )}
    </div>
  );
}

function CategoryGroups({
  categories,
  groups,
  activityByCategoryId,
}: {
  categories: CategoryWithGroup[];
  groups: { id: string; name: string }[];
  activityByCategoryId: Map<string, CategoryActivity> | null;
}) {
  const byGroup = new Map<string, CategoryWithGroup[]>();
  for (const category of categories) {
    const list = byGroup.get(category.groupid) ?? [];
    list.push(category);
    byGroup.set(category.groupid, list);
  }

  const visibleGroups = groups.filter((group) => (byGroup.get(group.id)?.length ?? 0) > 0);

  if (visibleGroups.length === 0) {
    return (
      <EmptyState
        icon={<TagIcon className="h-10 w-10" />}
        heading="Nothing matches this filter"
        message="Try a different type, or clear filters to see your full set of categories again."
        action={
          <Link
            href="/categories"
            className="rounded text-sm font-medium text-action transition-colors duration-150 hover:text-action-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Clear filters
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Roughly, not precisely, over the money column of each card below --
          each group's own grid sizes its columns off its own content, so a
          single page-level caption can't subgrid into all of them the way
          AccountRow's does within one section. Naming the "This month"
          column once here beats repeating the label inside every card. */}
      <div className="hidden items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted sm:flex">
        <span>Category</span>
        <span>This month</span>
      </div>

      {visibleGroups.map((group) => (
        <section key={group.id} className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold text-ink-secondary">{group.name}</h2>
          <ul
            className={`divide-y divide-gridline rounded-2xl border border-hairline bg-surface ${CATEGORY_ROW_GRID}`}
          >
            {(byGroup.get(group.id) ?? []).map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                groups={groups}
                activity={
                  activityByCategoryId === null
                    ? null
                    : (activityByCategoryId.get(category.id) ?? noActivity(category.id))
                }
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
