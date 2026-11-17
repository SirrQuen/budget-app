"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectedDay, SafeToSpendProjection } from "@/lib/safeToSpendProjection";
import { formatCurrency, formatDateShort, formatDateWithWeekday } from "@/lib/format";
import { itemHref, lowPointFigure } from "@/lib/runway";

// The runway (docs/Decide-and-Grow.md, F1): the projection's own day-by-day
// walk, drawn. Hand-written SVG in CashflowChart's pattern -- no library.
//
// One series, so one colour (categorical slot 1) and no legend. The line is
// a step: on a day, bills take it down first (the dip, measured at the
// day's low, as the trough is), then income lifts it (the sun). Money only
// for the spendable set -- it is the projection's own walk, nothing else.
//
// Colours: tokens only. The line is a data colour; the sun is income's
// green (CLAUDE.md: green marks income), always an icon with a label in the
// tooltip and the list; never gold (rulings on Phase 1). The leaf and the
// dips are ink.

const PLOT_H_MOBILE = 170;
const PLOT_H_DESKTOP = 220;
const DESKTOP_MIN_WIDTH = 640;
const PAD = { top: 26, right: 16, bottom: 28, left: 52 };
const MIN_X_TICK_SPACING = 72;
const FALLBACK_WIDTH = 640;
const LINE = "var(--color-cat-1)";
const SUN = "var(--color-good)";

const axisMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

function niceStep(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const norm = v / mag;
  return ([1, 2, 2.5, 5, 10].find((s) => norm <= s) ?? 10) * mag;
}

/**
 * Ticks over the walk's range. $0 is on the axis when it's near the data
 * (within one range of the lowest point) -- then the area is filled down to
 * it. A balance far above $0 gets an axis fitted to its own range instead,
 * or a $300 dip in $109,000 would draw as a flat line; with no $0 floor
 * there is no area, since a fill would imply one.
 */
export function yAxis(min: number, max: number): { min: number; max: number; ticks: number[]; fromZero: boolean } {
  const span = Math.max(max - min, 0);
  const fromZero = min <= span || min <= 0;
  const pad = fromZero ? 0 : Math.max(span * 0.15, 1);
  const lo = fromZero ? Math.min(0, min) : min - pad;
  const hi = Math.max(max + (fromZero ? 0 : pad), lo + 1);
  const step = niceStep((hi - lo) / 4);
  const yMin = Math.floor(lo / step) * step;
  const yMax = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = yMin; t <= yMax + step / 2; t += step) ticks.push(Math.round(t * 100) / 100);
  return { min: yMin, max: yMax, ticks, fromZero };
}

/** What a day holds, in words: the tooltip and a mark's accessible name. */
export function dayItemsText(d: ProjectedDay): string {
  const out = d.out.map((o) => `${o.name} ${formatCurrency(o.amount)} out`);
  const ins = d.income.map((i) => `${i.name} ${formatCurrency(i.amount)} in`);
  return [...out, ...ins].join(", ");
}

export function RunwayChart({
  data,
  reveal,
}: {
  data: Pick<SafeToSpendProjection, "daily" | "trough" | "cushion" | "cashOnHand">;
  /** Draw in once (the first open this session). Never with reduced motion. */
  reveal: boolean;
}) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [active, setActive] = useState<number | null>(null);
  const maskId = `runway-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const days = data.daily;
  const n = days.length;
  const plotH = width >= DESKTOP_MIN_WIDTH ? PLOT_H_DESKTOP : PLOT_H_MOBILE;
  const svgH = PAD.top + plotH + PAD.bottom;
  const PLOT_L = PAD.left;
  const PLOT_R = width - PAD.right;
  const PLOT_T = PAD.top;
  const PLOT_B = PAD.top + plotH;
  const PLOT_W = Math.max(PLOT_R - PLOT_L, 1);

  const values = [data.cashOnHand, ...days.flatMap((d) => [d.low, d.end])];
  const axis = yAxis(Math.min(...values), Math.max(...values));
  const x = (i: number) => PLOT_L + (n <= 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const y = (v: number) => PLOT_B - ((v - axis.min) / (axis.max - axis.min)) * plotH;

  // The step: open on today's cash, down to each day's low, up to its end,
  // across to the next day.
  let line = `M${x(0).toFixed(1)},${y(data.cashOnHand).toFixed(1)}`;
  days.forEach((d, i) => {
    if (i > 0) line += ` H${x(i).toFixed(1)}`;
    line += ` V${y(d.low).toFixed(1)} V${y(d.end).toFixed(1)}`;
  });
  const floorY = y(Math.max(axis.min, 0));
  const area = `${line} H${x(n - 1).toFixed(1)} V${floorY.toFixed(1)} H${x(0).toFixed(1)} Z`;

  const troughIdx = days.findIndex((d) => d.date === data.trough.date);

  const xTickFractions =
    PLOT_W / 4 >= MIN_X_TICK_SPACING ? [0, 0.25, 0.5, 0.75, 1] : PLOT_W / 2 >= MIN_X_TICK_SPACING ? [0, 0.5, 1] : [0, 1];
  const xTickIdx = [...new Set(xTickFractions.map((f) => Math.round(f * (n - 1))))];

  function pointerToIndex(clientX: number): number {
    const rect = svgRef.current!.getBoundingClientRect();
    const localX = ((clientX - rect.left) / rect.width) * width;
    const i = Math.round(((localX - PLOT_L) / PLOT_W) * (n - 1));
    return Math.max(0, Math.min(n - 1, i));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const cur = active ?? 0;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(n - 1, cur + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape" && active !== null) next = null;
    else return;
    e.preventDefault();
    // Escape on an idle chart belongs to the dialog.
    if (e.key === "Escape") e.stopPropagation();
    setActive(next);
  }

  // A mark is a door: a plain <a> inside SVG, routed client-side.
  function door(href: string) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      router.push(href);
    };
  }

  const activeDay = active === null ? null : days[active];
  const activeX = active === null ? 0 : x(active);
  const tooltipLeftPct = (activeX / width) * 100;
  const tooltipSide = tooltipLeftPct > 62 ? "right" : tooltipLeftPct < 18 ? "left" : "center";

  return (
    <div className="relative" ref={wrapRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${svgH}`}
        width="100%"
        height={svgH}
        preserveAspectRatio="none"
        className="block touch-pan-y"
        role="group"
        tabIndex={0}
        aria-label="Your spendable balance, day by day. Arrow keys read each day; each payday and bill opens what it is. The list view has every point."
        onPointerMove={(e) => setActive(pointerToIndex(e.clientX))}
        onPointerLeave={() => setActive(null)}
        onFocus={(e) => {
          if (e.target === e.currentTarget) setActive((a) => a ?? 0);
        }}
        onBlur={(e) => {
          if (e.target === e.currentTarget) setActive(null);
        }}
        onKeyDown={onKeyDown}
      >
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <rect
              x={0}
              y={0}
              width={width}
              height={svgH}
              fill="white"
              className={reveal ? "runway-reveal" : undefined}
            />
          </mask>
        </defs>

        {/* gridlines + axis -- recessive, under the data */}
        <g aria-hidden="true">
          {axis.ticks.map((t) => (
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
              {i === 0 ? "Today" : formatDateShort(days[i].date)}
            </text>
          ))}
          {/* The cushion, as chrome: the line the figure keeps clear of. */}
          {data.cushion > 0 && data.cushion >= axis.min && data.cushion <= axis.max ? (
            <g>
              <line
                x1={PLOT_L}
                x2={PLOT_R}
                y1={y(data.cushion)}
                y2={y(data.cushion)}
                stroke="var(--color-ink-muted)"
                strokeWidth={1}
                strokeDasharray="3 4"
                vectorEffect="non-scaling-stroke"
              />
              <text x={PLOT_R} y={y(data.cushion) - 5} textAnchor="end" className="fill-ink-muted" fontSize={11}>
                Cushion
              </text>
            </g>
          ) : null}
        </g>

        <g mask={`url(#${maskId})`}>
          {axis.fromZero ? <path d={area} fill={LINE} fillOpacity={0.1} aria-hidden="true" /> : null}
          <path
            d={line}
            fill="none"
            stroke={LINE}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            aria-hidden="true"
          />

          {/* Dips: a bill's day, at its low. Each opens what comes out. */}
          {days.map((d, i) =>
            d.out.length > 0 && i !== troughIdx ? (
              <a
                key={`out-${d.date}`}
                href={itemHref(d.out[0])}
                onClick={door(itemHref(d.out[0]))}
                aria-label={`${formatDateWithWeekday(d.date)}: ${d.out.map((o) => `${o.name}, ${formatCurrency(o.amount)}`).join("; ")}. Opens ${d.out[0].name}.`}
                className="runway-mark outline-none"
              >
                <rect x={x(i) - 12} y={y(d.low) - 12} width={24} height={24} fill="transparent" />
                <circle cx={x(i)} cy={y(d.low)} r={4} fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth={2} />
              </a>
            ) : null,
          )}

          {/* Suns: a payday, above the day's end. Each opens its schedule. */}
          {days.map((d, i) =>
            d.income.length > 0 ? (
              <a
                key={`in-${d.date}`}
                href={itemHref(d.income[0])}
                onClick={door(itemHref(d.income[0]))}
                aria-label={`Payday, ${formatDateWithWeekday(d.date)}: ${d.income.map((p) => `${p.name}, ${formatCurrency(p.amount)}`).join("; ")}. Opens ${d.income[0].name}.`}
                className="runway-mark outline-none"
              >
                <rect x={x(i) - 14} y={y(d.end) - 30} width={28} height={30} fill="transparent" />
                <Sun cx={x(i)} cy={Math.max(PLOT_T - 12, y(d.end) - 14)} />
              </a>
            ) : null,
          )}

          {/* The lowest point: the leaf. Its day's bills are its door. */}
          {troughIdx >= 0 ? (
            data.trough.obligations[0] ? (
              <a
                href={itemHref(data.trough.obligations[0])}
                onClick={door(itemHref(data.trough.obligations[0]))}
                aria-label={`Your lowest point, ${formatDateWithWeekday(data.trough.date)}, ${lowPointFigure(data.trough.amount)}. Opens ${data.trough.obligations[0].name}.`}
                className="runway-mark outline-none"
              >
                <rect x={x(troughIdx) - 14} y={y(data.trough.amount) - 4} width={28} height={28} fill="transparent" />
                <Leaf cx={x(troughIdx)} cy={y(data.trough.amount) + 10} />
              </a>
            ) : (
              <Leaf cx={x(troughIdx)} cy={y(data.trough.amount) + 10} />
            )
          ) : null}
        </g>

        {/* crosshair -- never a hit target: it sits on the marks it reads. */}
        {active !== null ? (
          <g aria-hidden="true" pointerEvents="none">
            <line
              x1={activeX}
              x2={activeX}
              y1={PLOT_T}
              y2={PLOT_B}
              stroke="var(--color-ink-muted)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={activeX} cy={y(days[active].low)} r={4} fill={LINE} stroke="var(--color-surface)" strokeWidth={2} />
          </g>
        ) : null}
      </svg>

      {activeDay ? (
        <div
          className="pointer-events-none absolute top-2 z-10 max-w-[16rem] rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-xs shadow-md"
          style={{
            left: `${tooltipLeftPct}%`,
            transform: tooltipSide === "right" ? "translateX(-100%)" : tooltipSide === "left" ? "translateX(0)" : "translateX(-50%)",
          }}
        >
          <p className="mb-1 text-ink-secondary">{formatDateWithWeekday(activeDay.date)}</p>
          <p className="font-medium text-ink [font-variant-numeric:tabular-nums]">
            {activeDay.low === activeDay.end
              ? lowPointFigure(activeDay.end)
              : `${lowPointFigure(activeDay.low)} → ${lowPointFigure(activeDay.end)}`}
          </p>
          {dayItemsText(activeDay) ? <p className="mt-0.5 text-ink-muted">{dayItemsText(activeDay)}</p> : null}
        </div>
      ) : null}

      <span className="sr-only" aria-live="polite">
        {activeDay
          ? `${formatDateWithWeekday(activeDay.date)}: ${lowPointFigure(activeDay.end)}${
              dayItemsText(activeDay) ? `. ${dayItemsText(activeDay)}` : ""
            }`
          : ""}
      </span>
    </div>
  );
}

// A small sun: a disc and eight rays. Income's colour, never gold.
function Sun({ cx, cy }: { cx: number; cy: number }) {
  const rays = Array.from({ length: 8 }, (_, k) => {
    const a = (k * Math.PI) / 4;
    return (
      <line
        key={k}
        x1={cx + Math.cos(a) * 6.5}
        y1={cy + Math.sin(a) * 6.5}
        x2={cx + Math.cos(a) * 9}
        y2={cy + Math.sin(a) * 9}
        stroke={SUN}
        strokeWidth={1.5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    );
  });
  return (
    <g aria-hidden="true">
      <circle cx={cx} cy={cy} r={4.5} fill={SUN} />
      {rays}
    </g>
  );
}

// LeafIcon's shape, centred on (cx, cy), in ink.
function Leaf({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g aria-hidden="true" transform={`translate(${cx - 8} ${cy - 8})`}>
      <path
        d="M13.5 2.5C7.5 2.5 3 5.2 3 9.4c0 1.1.4 2 1 2.7L2.6 13.5l1 .6 1.4-1.4c.7.4 1.5.6 2.4.6 4 0 6.1-4 6.1-10.8Z"
        fill="var(--color-ink)"
        stroke="var(--color-surface)"
        strokeWidth={1}
      />
    </g>
  );
}
