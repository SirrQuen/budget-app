import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { UpcomingTimeline } from "./UpcomingTimeline";
import type { UpcomingOccurrence, UpcomingOccurrences } from "@/lib/upcomingOccurrences";

const TODAY = "2026-11-18";

const item = (name: string, date: string, direction: "bill" | "income", amount: number): UpcomingOccurrence => ({
  key: `${name}-${date}`,
  recurringId: name,
  transactionId: null,
  name,
  direction,
  amount,
  date,
  dueDate: date,
  status: "known",
  basis: "fixed",
});

const data: UpcomingOccurrences = {
  items: [
    item("Rent", "2026-11-20", "bill", 1200),
    item("Visa payment", "2026-11-20", "bill", 1320),
    item("Pay", "2026-11-25", "income", 900),
  ],
  windowEnd: "2026-12-01",
  horizonEnd: "2026-12-20",
};

const html = renderToStaticMarkup(
  <UpcomingTimeline data={data} today={TODAY} tightestDate="2026-11-20" accountNames={{}} />,
);

test("fourteen day buttons, each with a full label, today first", () => {
  const buttons = [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(buttons.length, 14);
  assert.match(buttons[0], /^Wednesday, Nov 18: nothing due$/);
  assert.equal(buttons[2], "Friday, Nov 20: Rent, $1,200.00; Visa payment, $1,320.00. Your tightest day");
  assert.match(buttons[7], /Pay, \$900\.00 coming in$/);
});

test("every day is a real button, pressed state exposed, nothing selected at first", () => {
  assert.equal((html.match(/<button/g) ?? []).length, 14);
  assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 14);
  assert.match(html, /Tap a day to see what(&#x27;|&apos;|')s on it\./);
});
