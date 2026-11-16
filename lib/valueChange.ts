// "Motion only means change" (docs/Motion-and-Delight.md, rule 6). A figure
// that is on screen and then moves is a change; a figure that arrives with
// the page is not. This is the pure half: given where a figure was and what
// it is now, what happened. components/ui/useValueChange.ts holds it in
// React state, so the first render never reports a change.
//
// Compared in whole cents, never as floats: 0.1 + 0.2 must not read as a
// rise over 0.3.

export type ValueChange = {
  /** The figure as of the last render. */
  value: number;
  /** What it was before the latest change; null until one happens. */
  previous: number | null;
  /** Which way the latest change went; null until one happens. */
  direction: "up" | "down" | null;
  /** Counts changes, so an effect can restart for each one. */
  seq: number;
};

export function initialChange(value: number): ValueChange {
  return { value, previous: null, direction: null, seq: 0 };
}

const cents = (n: number) => Math.round(n * 100);

/** The next state for `value`. Returns `state` itself when nothing changed. */
export function advanceChange(state: ValueChange, value: number): ValueChange {
  if (cents(value) === cents(state.value)) return state;
  return {
    value,
    previous: state.value,
    direction: cents(value) > cents(state.value) ? "up" : "down",
    seq: state.seq + 1,
  };
}

/**
 * The characters of a rolling figure, aligned from the right, so "$999.00"
 * rolling to "$1,000.00" lines digits up by place. Each position says
 * whether it changed (and so should roll) or is the same.
 */
export type RollCell = { from: string; to: string; changed: boolean };

export function rollCells(from: string, to: string): RollCell[] {
  const length = Math.max(from.length, to.length);
  const cells: RollCell[] = [];
  for (let i = 0; i < length; i += 1) {
    const f = from[i - (length - from.length)] ?? "";
    const t = to[i - (length - to.length)] ?? "";
    cells.push({ from: f, to: t, changed: f !== t });
  }
  return cells;
}
