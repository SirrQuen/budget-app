"use client";

import { useState } from "react";
import { advanceChange, initialChange, type ValueChange } from "@/lib/valueChange";

/**
 * Reports a figure's change while it is on screen -- never on first render
 * (the "value changed" hook of docs/Motion-and-Delight.md, step 0). The
 * state is set during render, React's documented pattern for deriving state
 * from a prop, so no effect and no ref read is involved and the change is
 * visible in the very render that carries the new value.
 */
export function useValueChange(value: number): ValueChange {
  const [state, setState] = useState(() => initialChange(value));
  const next = advanceChange(state, value);
  if (next !== state) setState(next);
  return next;
}
