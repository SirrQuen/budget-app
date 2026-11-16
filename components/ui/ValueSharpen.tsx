"use client";

import { useReducedMotion } from "@/components/ui/useReducedMotion";
import { useValueChange } from "@/components/ui/useValueChange";

// A balance after a save: the new figure comes in over 300ms, the same in
// either direction -- a balance that fell is not treated differently from
// one that rose. It runs only when `value` changes while this is on
// screen, so a page load shows the figure still. Opacity and a hair of
// scale; nothing else animates (rule 8).
export function ValueSharpen({
  value,
  className = "",
  children,
}: {
  value: number;
  className?: string;
  children: React.ReactNode;
}) {
  const change = useValueChange(value);
  const reduced = useReducedMotion();
  const animation =
    !reduced && change.seq > 0 ? (change.seq % 2 === 0 ? "value-sharpen-a" : "value-sharpen-b") : "";
  return <span className={`${animation} ${className}`}>{children}</span>;
}
