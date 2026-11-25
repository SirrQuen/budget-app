// The summary above a flow drill-down: total, count and each category's
// share, added in integer cents. Pure -- the rows come from listFlowRows(),
// read through the list's own filter query.

export type FlowRow = { amount: number; categoryid: string | null; categoryName: string | null };

export type FlowCategory = { categoryid: string | null; name: string; cents: number };

export type FlowSummary = {
  cents: number;
  count: number;
  /** Largest first. Their cents add up to `cents`, archived categories included. */
  categories: FlowCategory[];
};

export function summarizeFlow(rows: readonly FlowRow[]): FlowSummary {
  const byId = new Map<string | null, FlowCategory>();
  let cents = 0;
  for (const row of rows) {
    const amount = Math.round(row.amount * 100);
    cents += amount;
    let category = byId.get(row.categoryid);
    if (!category) {
      category = { categoryid: row.categoryid, name: row.categoryName ?? "No category", cents: 0 };
      byId.set(row.categoryid, category);
    }
    category.cents += amount;
  }
  const categories = [...byId.values()].sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
  return { cents, count: rows.length, categories };
}

/** The first `limit` categories, and the rest added together (null when none). */
export function topCategories(
  categories: readonly FlowCategory[],
  limit: number,
): { top: FlowCategory[]; otherCents: number | null } {
  const rest = categories.slice(limit);
  return {
    top: categories.slice(0, limit),
    otherCents: rest.length > 0 ? rest.reduce((sum, c) => sum + c.cents, 0) : null,
  };
}

export const FLOW_TOP_PHONE = 5;
export const FLOW_TOP_DESKTOP = 8;
