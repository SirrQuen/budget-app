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
