import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { JSDOM } from "jsdom";
import { addDaysISO } from "@/lib/date";
import { projectSafeToSpend, type ProjectionSchedule } from "@/lib/safeToSpendProjection";
import type { SafeToSpend } from "@/lib/db/dashboard";

// A cushion of zero is a legitimate setting (Settings allows editing it down
// to 0) and zero is the value most likely to trip a falsy check or a
// divide-by-cushion. These render the real hero with its breakdown open.

const TODAY = "2026-10-01";
const day = (n: number) => addDaysISO(TODAY, n);

function once(kind: "Income" | "Expense", name: string, amount: number, n: number): ProjectionSchedule {
  return {
    recurringId: name,
    name,
    kind,
    accountId: "checking",
    fromAccountType: "Checking",
    toAccountId: null,
    toAccountType: null,
    statementDay: null,
    cardPayment: null,
    amount,
    amountLow: null,
    isEstimate: false,
    nextRunDate: day(n),
    nextDueDate: day(n),
    anchorDate: day(n),
    frequency: "Monthly",
    intervalCount: 1,
    businessDayOffset: 0,
    nonBusinessDayRule: "none",
    dateToleranceDays: 0,
    endDate: null,
    occurrencesRemaining: 1,
  };
}

function safeToSpend(schedules: ProjectionSchedule[], cash: number, cushion: number): SafeToSpend {
  const projection = projectSafeToSpend({
    today: TODAY,
    cash,
    cushion,
    schedules,
    holidays: new Set(),
    fallbackWindowEnd: "2026-10-31",
  });
  return {
    ...projection,
    windowReason: projection.mode === "projection" ? null : "end_of_month",
    cushionIsDefault: false,
    overdueBills: [],
    nextIncome: null,
  };
}

let dom: JSDOM;
let React: typeof import("react");
let act: typeof import("react").act;
let createRoot: typeof import("react-dom/client").createRoot;
let SafeToSpendHero: typeof import("./SafeToSpendHero").SafeToSpendHero;

// The hero imports a Server Action, whose data layer imports "server-only" --
// a marker only Next's bundler resolves. Outside Next it's an empty module.
// registerHooks is Node >= 22.15; @types/node is pinned at 20, so it's typed
// here rather than bumping the types app-wide.
type Next<A, R> = (arg: A, context: unknown) => R;
type HookResult = { url?: string; format?: string; source?: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve(specifier: string, context: unknown, nextResolve: Next<string, HookResult>): HookResult;
    load(url: string, context: unknown, nextLoad: Next<string, HookResult>): HookResult;
  }): void;
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "stub:server-only", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "stub:server-only") return { format: "commonjs", source: "", shortCircuit: true };
    return nextLoad(url, context);
  },
});

before(async () => {
  dom =new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "self", "document", "navigator", "HTMLElement", "Node", "Element", "IntersectionObserver"]) {
    Object.defineProperty(g, key, {
      value: key === "window" || key === "self" ? dom.window : (dom.window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
  }
  // useCountUp tweens via rAF; a no-op keeps the figure at its first render.
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
  g.IS_REACT_ACT_ENVIRONMENT = true;

  React = await import("react");
  act = React.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ SafeToSpendHero } = await import("./SafeToSpendHero"));
});

after(() => dom.window.close());

async function renderOpen(data: SafeToSpend): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<SafeToSpendHero data={data} />));
  const toggle = container.querySelector("button[aria-expanded]") as HTMLButtonElement;
  await act(async () => toggle.click());
  return container;
}

// A falsy-zero `{n && <X/>}` renders the number 0 as its own text node.
function looseZeros(container: HTMLElement): number {
  const walker = document.createTreeWalker(container, dom.window.NodeFilter.SHOW_TEXT);
  let count = 0;
  while (walker.nextNode()) if (walker.currentNode.textContent === "0") count++;
  return count;
}

function cushionValue(container: HTMLElement): string | null {
  const row = [...container.querySelectorAll("dt")].find((dt) => dt.textContent?.startsWith("Cushion"));
  return row?.nextElementSibling?.textContent ?? null;
}

test("cushion = 0, never below it: breakdown renders a $0 cushion line", async () => {
  const data = safeToSpend(
    [once("Expense", "Rent", 800, 2), once("Income", "Paycheck", 1000, 9), once("Income", "Paycheck 2", 1000, 23)],
    1500,
    0,
  );
  assert.equal(data.cushion, 0);
  const container = await renderOpen(data);
  assert.equal(looseZeros(container), 0);
  assert.equal(cushionValue(container), "$0.00");
});

test("breakdown values are unsigned: cushion and obligation rows read like Cash on hand", async () => {
  const data = safeToSpend(
    [once("Expense", "Rent", 800, 2), once("Income", "Paycheck", 1000, 9), once("Income", "Paycheck 2", 1000, 23)],
    2400,
    300,
  );
  const container = await renderOpen(data);
  assert.equal(cushionValue(container), "$300.00");
  const values = [...container.querySelectorAll("dl dd")].map((dd) => dd.textContent ?? "");
  assert.ok(values.includes("$800.00"), `Rent row missing: ${values.join(" | ")}`);
  assert.ok(values.every((v) => !v.startsWith("−")), `signed value in breakdown: ${values.join(" | ")}`);
});

test("cushion = 0 with a dip below zero: breakdown renders a $0 cushion line", async () => {
  const data = safeToSpend(
    [once("Expense", "Rent", 800, 2), once("Income", "Paycheck", 1000, 9), once("Income", "Paycheck 2", 1000, 23)],
    500,
    0,
  );
  assert.ok(data.episodes.length > 0);
  const container = await renderOpen(data);
  assert.equal(looseZeros(container), 0);
  assert.equal(cushionValue(container), "$0.00");
});
