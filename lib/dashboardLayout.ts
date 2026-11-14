// The dashboard's movable sections, and the pure rules for reordering and
// hiding them. Shared by the settings Server Action (validation), the
// dashboard page (what to render) and the editor -- no "server-only".
//
// The Safe to Spend hero is NOT here: it is pinned first and can't be
// moved or hidden, so it has no name to store.
//
// Stored as ordered lists of NAMES (settings.dashboard_order and
// dashboard_hidden, migration 67). Unknown names are ignored on read and
// sections the list lacks are appended, so shipping a new section can never
// break a saved layout.

export type DashboardRegion = "right-now" | "over-time";

/**
 * A card's footprint, fixed per section in code -- never user-resizable.
 * On the dashboard's four-column desktop grid: a small tile is one column,
 * wide is two, full is the whole row. Two columns on a tablet (wide and full
 * are both the whole row), one on a phone, where everything stacks.
 */
export type DashboardCardSize = "small" | "wide" | "full";

// The order here IS the default order. Chosen for a four-column desktop grid
// (small 1, wide 2, full 4) so that Budgets and Goals share a row and each
// region has at most one short row: Net worth sits alone after the pair, and
// Income and Spending sit side by side ahead of the full-width charts.
export const DASHBOARD_SECTIONS = [
  { id: "to-confirm", label: "To confirm", region: "right-now", size: "full" },
  { id: "budgets", label: "Budgets", region: "right-now", size: "wide" },
  { id: "goals", label: "Goals", region: "right-now", size: "wide" },
  { id: "net-worth", label: "Net worth", region: "right-now", size: "small" },
  { id: "upcoming", label: "Coming up", region: "right-now", size: "full" },
  { id: "accounts", label: "Accounts", region: "right-now", size: "full" },
  { id: "income", label: "Income", region: "over-time", size: "small" },
  { id: "spending", label: "Spending", region: "over-time", size: "small" },
  { id: "cash-flow", label: "Cash flow", region: "over-time", size: "full" },
  { id: "category-movement", label: "Category movement", region: "over-time", size: "full" },
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTIONS)[number]["id"];

export const DASHBOARD_REGION_LABELS: Record<DashboardRegion, string> = {
  "right-now": "Right now",
  "over-time": "Over time",
};

export const DEFAULT_DASHBOARD_ORDER: readonly DashboardSectionId[] = DASHBOARD_SECTIONS.map(
  (s) => s.id,
);

export type DashboardLayout = {
  order: DashboardSectionId[];
  hidden: DashboardSectionId[];
};

const KNOWN: ReadonlySet<string> = new Set(DEFAULT_DASHBOARD_ORDER);

export function isDashboardSectionId(value: unknown): value is DashboardSectionId {
  return typeof value === "string" && KNOWN.has(value);
}

export function regionOf(id: DashboardSectionId): DashboardRegion {
  return DASHBOARD_SECTIONS.find((s) => s.id === id)!.region;
}

export function sizeOf(id: DashboardSectionId): DashboardCardSize {
  return DASHBOARD_SECTIONS.find((s) => s.id === id)!.size;
}

export function labelOf(id: DashboardSectionId): string {
  return DASHBOARD_SECTIONS.find((s) => s.id === id)!.label;
}

function knownUnique(value: unknown): DashboardSectionId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<DashboardSectionId>();
  for (const v of value) {
    if (isDashboardSectionId(v)) {
      seen.add(v);
    }
  }
  return [...seen];
}

/**
 * Whatever is stored (anything at all, including null) to a complete layout:
 * known names in the stored order, then every section the list lacks in
 * default order. Never throws; a bad value is the default.
 */
export function resolveDashboardLayout(order: unknown, hidden: unknown): DashboardLayout {
  const kept = knownUnique(order);
  const have = new Set(kept);
  const appended = DEFAULT_DASHBOARD_ORDER.filter((id) => !have.has(id));
  return { order: [...kept, ...appended], hidden: knownUnique(hidden) };
}

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = resolveDashboardLayout(null, null);

/** Sections of one region, in layout order. */
export function sectionsInRegion(
  order: readonly DashboardSectionId[],
  region: DashboardRegion,
): DashboardSectionId[] {
  return order.filter((id) => regionOf(id) === region);
}

/**
 * Put a region's currently visible sections in a new sequence, leaving every
 * other entry (hidden ones, other region) exactly where it is: the visible
 * ids take over the slots the visible ids held. `sequence` must be a
 * permutation of the ids it replaces; anything else returns the order as-is.
 */
export function reorderVisible(
  order: readonly DashboardSectionId[],
  sequence: readonly DashboardSectionId[],
): DashboardSectionId[] {
  const wanted = new Set(sequence);
  const slots = order.flatMap((id, i) => (wanted.has(id) ? [i] : []));
  if (sequence.length !== wanted.size || slots.length !== sequence.length) {
    return [...order];
  }
  const next = [...order];
  slots.forEach((slot, i) => {
    next[slot] = sequence[i];
  });
  return next;
}

/**
 * Move one section a step up (-1) or down (+1) among `visible` -- the
 * sections actually on screen in its region, in order. Stepping over a
 * hidden or empty section would change nothing the person can see, so those
 * aren't counted. At an edge it returns the same order.
 */
export function moveAmong(
  order: readonly DashboardSectionId[],
  visible: readonly DashboardSectionId[],
  id: DashboardSectionId,
  step: -1 | 1,
): DashboardSectionId[] {
  const at = visible.indexOf(id);
  const to = at + step;
  if (at < 0 || to < 0 || to >= visible.length) {
    return [...order];
  }
  const sequence = [...visible];
  [sequence[at], sequence[to]] = [sequence[to], sequence[at]];
  return reorderVisible(order, sequence);
}

export function setHidden(
  hidden: readonly DashboardSectionId[],
  id: DashboardSectionId,
  isHidden: boolean,
): DashboardSectionId[] {
  const without = hidden.filter((h) => h !== id);
  return isHidden ? [...without, id] : without;
}

export function layoutsEqual(a: DashboardLayout, b: DashboardLayout): boolean {
  const sortedHidden = (l: DashboardLayout) => [...l.hidden].sort().join(",");
  return a.order.join(",") === b.order.join(",") && sortedHidden(a) === sortedHidden(b);
}

/** What the page renders: one region's sections, in order, hidden ones out. */
export function visibleSections(layout: DashboardLayout, region: DashboardRegion) {
  const hidden = new Set(layout.hidden);
  return sectionsInRegion(layout.order, region).filter((id) => !hidden.has(id));
}
