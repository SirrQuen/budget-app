import Link from "next/link";
import { listCategories, listCategoryGroups, type CategoryWithGroup } from "@/lib/db/categories";
import type { TransactionType } from "@/lib/db/transactions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { TagIcon } from "@/components/ui/icons";
import { CreateCategoryForm } from "./CreateCategoryForm";
import { CategoryRow } from "./CategoryRow";

const TYPE_FILTERS: { label: string; value: TransactionType | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Income", value: "Income" },
  { label: "Expense", value: "Expense" },
];

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

  const [categoriesResult, groupsResult] = await Promise.all([
    listCategories({
      ...(type !== "all" ? { category_type: type } : {}),
      ...(showArchived ? {} : { is_active: true }),
    }),
    listCategoryGroups(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Categories"
        description="Organize how your spending and income are grouped."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-hairline bg-surface p-1">
          {TYPE_FILTERS.map((filter) => {
            const active = filter.value === type;
            return (
              <Link
                key={filter.value}
                href={buildHref(filter.value, showArchived)}
                aria-current={active || undefined}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                  active ? "bg-surface-raised text-ink" : "text-ink-secondary hover:text-ink"
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
              ? "border-action/40 bg-action/10 text-action"
              : "border-hairline bg-surface text-ink-secondary hover:text-ink"
          }`}
        >
          {showArchived ? "Showing archived" : "Show archived"}
        </Link>
      </div>

      {categoriesResult.error !== null || groupsResult.error !== null ? (
        <ErrorMessage
          severity="critical"
          message={
            categoriesResult.error ??
            groupsResult.error ??
            "We couldn't load your categories. Refresh the page to try again."
          }
        />
      ) : (
        <>
          <CreateCategoryForm groups={groupsResult.data} />
          <CategoryGroups categories={categoriesResult.data} groups={groupsResult.data} />
        </>
      )}
    </div>
  );
}

function CategoryGroups({
  categories,
  groups,
}: {
  categories: CategoryWithGroup[];
  groups: { id: string; name: string }[];
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
      {visibleGroups.map((group) => (
        <section key={group.id} className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold text-ink-secondary">{group.name}</h2>
          <ul className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface">
            {(byGroup.get(group.id) ?? []).map((category) => (
              <CategoryRow key={category.id} category={category} groups={groups} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
