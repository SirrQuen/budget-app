"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Amount } from "@/components/ui/Amount";
import { AmountBasisTag } from "@/components/AmountBasisTag";
import { formatDateShort, formatWeekday } from "@/lib/format";
import { buildTimelineDays, dayLabel, type TimelineDay } from "@/lib/comingUpTimeline";
import type { UpcomingOccurrence, UpcomingOccurrences } from "@/lib/upcomingOccurrences";

const LINK =
  "rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

// Marks, drawn in ink and the income green -- never gold, never a status
// colour (gold is chrome; this is data). Each carries its meaning in its
// shape and in the day's aria-label, not in colour.

/** A bill: every one the same size. */
function Pebble() {
  return <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-ink-secondary" />;
}

/** Income into the spendable set: a half sun on a horizon line. */
function Sunrise() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-good">
      <path d="M2 12 H14" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      <path d="M4.5 12 A3.5 3.5 0 0 1 11.5 12 Z" fill="currentColor" />
      <path d="M8 4 V2.5 M3.6 5.6 L2.6 4.6 M12.4 5.6 L13.4 4.6" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
    </svg>
  );
}

/** The tightest day: a single leaf. */
function Leaf() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-ink-secondary">
      <path d="M8 14 V8" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" fill="none" />
      <path d="M8 9 C3 9 2 5 2.5 2.5 C7 2.5 9.5 4.5 8 9 Z" fill="currentColor" />
    </svg>
  );
}

function sourceHref(item: UpcomingOccurrence): string {
  return item.recurringId !== null ? `/recurring#schedule-${item.recurringId}` : `/transactions/${item.transactionId}/edit`;
}

// The Upcoming card's Timeline view: the same items as the list, laid on
// fourteen days. Each day is a button; the selected day's items open below.
// Sideways scroll on a phone, today first. No motion but the selection ring.
export function UpcomingTimeline({
  data,
  today,
  tightestDate,
  accountNames,
}: {
  data: UpcomingOccurrences;
  today: string;
  /** The hero's tightest day (trough.date) -- the same field its sentence reads. */
  tightestDate: string;
  /** Account label per item key (schedule or one-off); absent when unknown. */
  accountNames: Record<string, string>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const panelId = useId();
  const days = buildTimelineDays(data, today, tightestDate);
  const open = days.find((d) => d.date === selected) ?? null;

  return (
    <div>
      <ul
        aria-label="The next 14 days"
        className="-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-2 pt-1 [scrollbar-width:thin]"
      >
        {days.map((day) => (
          <li key={day.date} className="shrink-0 snap-start">
            <DayButton
              day={day}
              isToday={day.date === today}
              pressed={day.date === selected}
              controls={panelId}
              onPress={() => setSelected((s) => (s === day.date ? null : day.date))}
            />
          </li>
        ))}
      </ul>

      <div id={panelId} className="mt-2" aria-live="polite">
        {open ? (
          <DayDetail day={open} accountNames={accountNames} />
        ) : (
          <p className="text-xs text-ink-muted">Tap a day to see what&apos;s on it.</p>
        )}
      </div>
    </div>
  );
}

function DayButton({
  day,
  isToday,
  pressed,
  controls,
  onPress,
}: {
  day: TimelineDay;
  isToday: boolean;
  pressed: boolean;
  controls: string;
  onPress: () => void;
}) {
  const bills = day.items.filter((i) => i.direction === "bill");
  const income = day.items.filter((i) => i.direction === "income");
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-controls={controls}
      aria-label={dayLabel(day)}
      onClick={onPress}
      // The ring is the only thing that moves: 160ms, off under reduced motion.
      className={`flex min-h-[5.5rem] w-14 flex-col items-center gap-1 rounded-xl border border-hairline bg-surface-raised px-1 py-2 text-center ring-2 motion-safe:transition-shadow motion-safe:duration-[160ms] focus-visible:outline-none focus-visible:ring-action ${
        pressed ? "ring-ink" : "ring-transparent"
      }`}
    >
      <span className="text-[11px] leading-none text-ink-muted">{isToday ? "Today" : formatWeekday(day.date).slice(0, 3)}</span>
      <span className="text-sm font-medium leading-none text-ink">{Number(day.date.slice(8))}</span>
      <span aria-hidden="true" className="flex flex-wrap items-center justify-center gap-1">
        {income.map((i) => (
          <Sunrise key={i.key} />
        ))}
        {bills.map((i) => (
          <Pebble key={i.key} />
        ))}
        {day.tightest ? <Leaf /> : null}
      </span>
    </button>
  );
}

function DayDetail({ day, accountNames }: { day: TimelineDay; accountNames: Record<string, string> }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-secondary">
        {formatWeekday(day.date)}, {formatDateShort(day.date)}
        {day.tightest ? <span className="font-normal text-ink-muted"> · your tightest day</span> : null}
      </p>
      {day.items.length === 0 ? (
        <p className="mt-1 text-sm text-ink-secondary">Nothing due.</p>
      ) : (
        <ul className="mt-1 divide-y divide-hairline">
          {day.items.map((item) => {
            const account = accountNames[item.key];
            return (
              <li key={item.key} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 break-words text-ink">
                  <Link href={sourceHref(item)} className={LINK}>
                    {item.name}
                  </Link>
                  <AmountBasisTag basis={item.basis} className="ml-1.5" />
                  {account ? <span className="block text-xs text-ink-muted">{account}</span> : null}
                </span>
                <Amount
                  amount={item.amount}
                  type={item.direction === "income" ? "Income" : "Expense"}
                  column
                  className="shrink-0"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
