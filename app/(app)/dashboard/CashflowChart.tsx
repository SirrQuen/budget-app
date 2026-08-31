"use client";

import { useId, useRef, useState } from "react";
import type { CashflowPoint } from "@/lib/db/dashboard";
import { formatCurrency } from "@/lib/format";

// Slots 1 and 2 of the categorical ramp, read from the theme so the chart
// re-colours itself in light and dark with no branch here. Never a literal.
const SERIES = [
  { key: "income", name: "Income", color: "var(--color-cat-1)" },
  { key: "expenses", name: "Spending", color: "var(--color-cat-2)" },
] as const;

// Plotted in viewBox units; the <svg> scales to its container width. Stroked
// marks use non-scaling-stroke so 2px stays 2px at any render width.
const VB_W = 840;
const VB_H = 300;
const PAD = { top: 16, right: 72, bottom: 28, left: 56 };
const PLOT_L = PAD.left;
const PLOT_R = VB_W - PAD.right;
const PLOT_T = PAD.top;
const PLOT_B = VB_H - PAD.bottom;
const PLOT_W = PLOT_R - PLOT_L;
const PLOT_H = PLOT_B - PLOT_T;

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const fullDate = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
// Compact currency for axis ticks: "$0" / "$125" / "$1.3K", never ".00".
const axisMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

// Round a positive value up to the next "nice" number on a 1-2-2.5-3-4-5-6-8
// ladder, so a derived axis step lands on something readable.
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const norm = v / mag;
  const step = [1, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => norm <= s) ?? 10;
  return step * mag;
}

// Four equal intervals from 0, each a nice number, topping out at or just
// above the data max -- clean tick labels, minimal dead headroom.
function yAxis(dataMax: number): { max: number; ticks: number[] } {
  const step = niceCeil(Math.max(dataMax, 1) / 4);
  return { max: step * 4, ticks: [0, 1, 2, 3, 4].map((k) => k * step) };
}

// Which slice of the 90-day series the dashboard filter currently has
// selected -- drawn as a recessive raised band so the trend keeps its full
// history while the chosen window stays legible. Chrome, not a data mark.
function shadeIndices(
  points: CashflowPoint[],
  shadeFrom?: string,
  shadeTo?: string,
): { start: number; end: number } | null {
  if (!shadeFrom || !shadeTo) return null;
  const start = points.findIndex((p) => p.day >= shadeFrom);
  if (start === -1) return null;
  let end = start;
  for (let i = points.length - 1; i >= start; i--) {
    if (points[i].day <= shadeTo) {
      end = i;
      break;
    }
  }
  // A band that spans the whole chart tells the reader nothing.
  if (start === 0 && end === points.length - 1) return null;
  return { start, end };
}

export function CashflowChart({
  points,
  shadeFrom,
  shadeTo,
}: {
  points: CashflowPoint[];
  shadeFrom?: string;
  shadeTo?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();

  const n = points.length;
  const shade = shadeIndices(points, shadeFrom, shadeTo);
  const shadeLabel =
    shadeFrom && shadeTo
      ? `${shortDate.format(new Date(shadeFrom))} – ${shortDate.format(new Date(shadeTo))} highlighted`
      : null;
  const { max: yMax, ticks: yTicks } = yAxis(
    Math.max(...points.flatMap((p) => [p.income, p.expenses]), 0),
  );

  const x = (i: number) => PLOT_L + (n <= 1 ? 0 : (i / (n - 1)) * PLOT_W);
  const y = (v: number) => PLOT_B - (v / yMax) * PLOT_H;

  const linePath = (key: "income" | "expenses") =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const areaPath = (key: "income" | "expenses") =>
    `M${x(0).toFixed(1)},${PLOT_B} ` +
    points.map((p, i) => `L${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ") +
    ` L${x(n - 1).toFixed(1)},${PLOT_B} Z`;

  const xTickIdx = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (n - 1)));

  // Endpoint labels: nudge apart only if they'd otherwise collide.
  const lastY = { income: y(points[n - 1].income), expenses: y(points[n - 1].expenses) };
  const collide = Math.abs(lastY.income - lastY.expenses) < 13;
  const labelY = {
    income: collide ? Math.min(lastY.income, lastY.expenses) - 7 : lastY.income,
    expenses: collide ? Math.max(lastY.income, lastY.expenses) + 7 : lastY.expenses,
  };

  function pointerToIndex(clientX: number): number {
    const rect = svgRef.current!.getBoundingClientRect();
    const vbX = ((clientX - rect.left) / rect.width) * VB_W;
    const i = Math.round(((vbX - PLOT_L) / PLOT_W) * (n - 1));
    return Math.max(0, Math.min(n - 1, i));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const cur = active ?? n - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(n - 1, cur + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape") next = null;
    else return;
    e.preventDefault();
    setActive(next);
  }

  const activePoint = active === null ? null : points[active];
  const activeX = active === null ? 0 : x(active);
  const tooltipLeftPct = (activeX / VB_W) * 100;
  const tooltipSide = tooltipLeftPct > 62 ? "right" : tooltipLeftPct < 12 ? "left" : "center";

  return (
    <figure className="m-0 rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
      <figcaption className="mb-3 flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-ink-secondary">Cash flow</h2>
          <p className="text-xs text-ink-muted">
            Last 90 days{shadeLabel ? ` · ${shadeLabel}` : ""}
          </p>
        </div>
        <ul className="flex items-center gap-4">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.name}
            </li>
          ))}
        </ul>
      </figcaption>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          width="100%"
          className="block h-auto touch-none"
          role="img"
          tabIndex={0}
          aria-label={`Cash flow, last 90 days${
            shadeLabel ? `, with ${shadeLabel}` : ""
          }. Arrow keys read each day; the full table follows.`}
          aria-describedby={tableId}
          onPointerMove={(e) => setActive(pointerToIndex(e.clientX))}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
        >
          {/* selected-range band -- raised surface, behind everything */}
          {shade ? (
            <g aria-hidden="true">
              <rect
                x={x(shade.start)}
                y={PLOT_T}
                width={Math.max(x(shade.end) - x(shade.start), 1)}
                height={PLOT_H}
                fill="var(--color-surface-raised)"
              />
              {[shade.start, shade.end].map((i) => (
                <line
                  key={i}
                  x1={x(i)}
                  x2={x(i)}
                  y1={PLOT_T}
                  y2={PLOT_B}
                  stroke="var(--color-hairline)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          ) : null}

          {/* gridlines + axis ticks -- recessive, under the data */}
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={PLOT_L}
                x2={PLOT_R}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? "var(--color-baseline)" : "var(--color-gridline)"}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={PLOT_L - 8}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-ink-muted [font-variant-numeric:tabular-nums]"
                fontSize={11}
              >
                {axisMoney.format(t)}
              </text>
            </g>
          ))}
          {xTickIdx.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={PLOT_B + 18}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              className="fill-ink-muted"
              fontSize={11}
            >
              {shortDate.format(new Date(points[i].day))}
            </text>
          ))}

          {/* areas first, then lines on top */}
          {SERIES.map((s) => (
            <path key={s.key} d={areaPath(s.key)} fill={s.color} fillOpacity={0.1} />
          ))}
          {SERIES.map((s) => (
            <path
              key={s.key}
              d={linePath(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* crosshair */}
          {active !== null && (
            <g>
              <line
                x1={activeX}
                x2={activeX}
                y1={PLOT_T}
                y2={PLOT_B}
                stroke="var(--color-ink-muted)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              {SERIES.map((s) => (
                <circle
                  key={s.key}
                  cx={activeX}
                  cy={y(points[active][s.key])}
                  r={4}
                  fill={s.color}
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                />
              ))}
            </g>
          )}

          {/* endpoint marks + direct labels */}
          {SERIES.map((s) => (
            <g key={s.key}>
              <circle
                cx={x(n - 1)}
                cy={lastY[s.key]}
                r={4}
                fill={s.color}
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
              <text
                x={x(n - 1) + 8}
                y={labelY[s.key]}
                dominantBaseline="middle"
                className="fill-ink-secondary"
                fontSize={11}
              >
                {s.name}
              </text>
            </g>
          ))}
        </svg>

        {activePoint && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-xs shadow-md"
            style={{
              left: `${tooltipLeftPct}%`,
              transform:
                tooltipSide === "right"
                  ? "translateX(-100%)"
                  : tooltipSide === "left"
                    ? "translateX(0)"
                    : "translateX(-50%)",
            }}
          >
            <p className="mb-1 text-ink-secondary">{fullDate.format(new Date(activePoint.day))}</p>
            <dl className="flex flex-col gap-0.5">
              {SERIES.map((s) => (
                <div key={s.key} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block h-0.5 w-3 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <dd className="m-0 font-medium text-ink [font-variant-numeric:tabular-nums]">
                    {formatCurrency(activePoint[s.key])}
                  </dd>
                  <dt className="text-ink-muted">{s.name}</dt>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      <span className="sr-only" aria-live="polite">
        {activePoint
          ? `${fullDate.format(new Date(activePoint.day))}: income ${formatCurrency(
              activePoint.income,
            )}, spending ${formatCurrency(activePoint.expenses)}`
          : ""}
      </span>

      <table id={tableId} className="sr-only">
        <caption>Daily income and spending, last 90 days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Income</th>
            <th scope="col">Spending</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}>
              <th scope="row">{fullDate.format(new Date(p.day))}</th>
              <td>{formatCurrency(p.income)}</td>
              <td>{formatCurrency(p.expenses)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
