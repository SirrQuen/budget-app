// Editing the amount of a transaction confirmed from a schedule asks the
// calendar question: "Just this one" or "This and future occurrences"
// (docs/Recurring-Amounts-and-Transfer-Editing.md, 2d). Never propagated
// silently -- a one-off correction quietly moving the forecast is worse
// than not propagating at all.
//
// The default differs by schedule, and the choice is always shown:
//   fixed amount     -> this and future (a changed rent is a changed rent)
//   variable amount  -> just this one   (variation is the point)

export type EditScope = "one" | "future";

export function defaultEditScope(amountIsVariable: boolean): EditScope {
  return amountIsVariable ? "one" : "future";
}

/** A form value; anything but "future" means just this one -- never propagate on a guess. */
export function parseEditScope(value: FormDataEntryValue | null): EditScope {
  return value === "future" ? "future" : "one";
}

/** Whether an edit changed the amount -- compared in cents. The question only applies when it did. */
export function amountChanged(before: number, after: number): boolean {
  return Math.round(before * 100) !== Math.round(after * 100);
}

export const EDIT_SCOPE_LABELS: Record<EditScope, string> = {
  one: "Just this one",
  future: "This and future occurrences",
};
