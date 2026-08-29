// Shared between the create-category Server Action (validation) and the
// create-category form (rendering) -- no "server-only" import so the client
// form can pull the same source of truth.

// The eight validated categorical slots (CLAUDE.md "Categorical slots, in
// this fixed order, never cycled"). categories.color is read straight into
// charts, so the picker offers only these swatches rather than a free hex
// input -- an arbitrary hex here becomes an unreadable chart later.
export const CATEGORY_COLOR_SWATCHES = [
  { value: "#3987e5", label: "Blue" },
  { value: "#d95926", label: "Orange" },
  { value: "#199e70", label: "Aqua" },
  { value: "#c98500", label: "Yellow" },
  { value: "#d55181", label: "Magenta" },
  { value: "#008300", label: "Green" },
  { value: "#9085e9", label: "Violet" },
  { value: "#e66767", label: "Red" },
] as const;

export type CategoryColorValue = (typeof CATEGORY_COLOR_SWATCHES)[number]["value"];

// The stored hex is a SLOT IDENTITY, not a colour to paint.
//
// categories.color holds one of the eight hexes above -- the dark-mode
// values, since those were the only ones when the column was first
// written. Painting them literally would leave every category dot on the
// dark palette in light mode, where those values run 1.7-2.5:1 against a
// white card and effectively vanish.
//
// So every render site resolves the hex to its --cat-N token instead, and
// the token carries the per-theme value. That keeps the database as the
// record of *which* slot a category owns while the stylesheet stays the
// only place that decides what a slot looks like -- which is what lets
// both palettes come through with no migration and no backfill.
//
// An unrecognised value (hand-edited row, or a palette revision that
// changed a hex) falls back to painting itself: wrong-for-the-theme beats
// invisible.
export function categoryColorVar(color: string | null | undefined): string {
  if (!color) {
    return "var(--ink-muted)";
  }

  const slot = CATEGORY_COLOR_SWATCHES.findIndex(
    (swatch) => swatch.value === color.trim().toLowerCase(),
  );

  return slot === -1 ? color : `var(--cat-${slot + 1})`;
}
