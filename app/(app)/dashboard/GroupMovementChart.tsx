"use client";

import { useId, useState } from "react";
import type { GroupMovementResult, Movement } from "@/lib/db/dashboard";
import { formatCurrency } from "@/lib/format";
import { ChevronDownIcon } from "@/components/ui/icons";

function signedPct(m: Movement): string {
  const p = Math.round(Math.abs(m.pctChange) * 100);
  return `${m.pctChange >= 0 ? "+" : "−"}${p}%`;
}

function detail(m: Movement): string {
  return `${formatCurrency(m.current)} this month · ${formatCurrency(m.baseline)} three-month average`;
}

// Bar length is |movement| relative to the biggest in the set; a floor keeps
// tiny movers visible. Left edge is the baseline (square), data end rounded.
function Bar({ value, maxAbs, accent }: { value: number; maxAbs: number; accent: boolean }) {
  return (
    <span className="h-2 w-full">
      <span
        className="block h-full rounded-r-full"
        style={{
          width: `${Math.max((Math.abs(value) / maxAbs) * 100, 2)}%`,
          backgroundColor: accent ? "var(--color-cat-1)" : "var(--color-ink-muted)",
        }}
      />
    </span>
  );
}

// Emphasis form: the one bar the story is about carries the accent hue,
// every other bar is de-emphasis grey -- colouring them all would bury the
// mover. Used for the group list and, on expand, each group's categories.
function Bars({ items, emphasisId }: { items: Movement[]; emphasisId: string | null }) {
  const maxAbs = Math.max(...items.map((m) => Math.abs(m.pctChange)), 0.0001);
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((m) => (
        <li
          key={m.id}
          className="grid grid-cols-[9rem_1fr_3rem_1rem] items-center gap-3 text-sm"
        >
          <span className="truncate text-ink-secondary" title={m.name}>
            {m.name}
          </span>
          <Bar value={m.pctChange} maxAbs={maxAbs} accent={m.id === emphasisId} />
          <span className="text-right tabular-nums text-ink-secondary">{signedPct(m)}</span>
          <span aria-hidden="true" />
        </li>
      ))}
    </ul>
  );
}

export function GroupMovementChart({ data }: { data: GroupMovementResult }) {
  const { groups, topMover } = data;
  const [openId, setOpenId] = useState<string | null>(null);
  const panelId = useId();

  const headline = topMover
    ? `${topMover.name} is ${topMover.pctChange >= 0 ? "up" : "down"} ${Math.round(
        Math.abs(topMover.pctChange) * 100,
      )}% against your three-month average.`
    : "Your spending stayed close to its three-month average this month.";

  const groupMaxAbs = Math.max(...groups.map((g) => Math.abs(g.pctChange)), 0.0001);

  return (
    <figure className="m-0 flex flex-col gap-4 rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
      <figcaption className="text-base text-ink">{headline}</figcaption>

      {topMover ? (
        <ul className="flex flex-col gap-1">
          {groups.map((g) => {
            const open = openId === g.id;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : g.id)}
                  aria-expanded={open}
                  aria-controls={`${panelId}-${g.id}`}
                  className="w-full rounded-lg py-1.5 text-left transition-colors duration-150 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  <span className="grid grid-cols-[9rem_1fr_3rem_1rem] items-center gap-3 text-sm">
                    <span className="truncate text-ink-secondary" title={g.name}>
                      {g.name}
                    </span>
                    <Bar value={g.pctChange} maxAbs={groupMaxAbs} accent={g.id === topMover.id} />
                    <span className="text-right tabular-nums text-ink-secondary">{signedPct(g)}</span>
                    <ChevronDownIcon
                      aria-hidden="true"
                      className={`h-4 w-4 justify-self-end text-ink-muted motion-safe:transition-transform motion-safe:duration-150 ${
                        open ? "rotate-180" : ""
                      }`}
                    />
                  </span>
                </button>

                {open ? (
                  <div id={`${panelId}-${g.id}`} className="mb-1 mt-1 border-l-2 border-hairline pl-3">
                    <p className="mb-2 text-xs text-ink-muted">{detail(g)}</p>
                    {g.categories.length > 0 ? (
                      <Bars items={g.categories} emphasisId={g.categories[0]?.id ?? null} />
                    ) : (
                      <p className="text-xs text-ink-muted">
                        No category here has a three-month baseline to compare against.
                      </p>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </figure>
  );
}
