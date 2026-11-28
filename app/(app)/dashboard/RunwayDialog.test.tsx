import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { JSDOM } from "jsdom";
import { addDaysISO } from "@/lib/date";
import { projectSafeToSpend, type GoalHold, type ProjectionSchedule } from "@/lib/safeToSpendProjection";
import type { SafeToSpend } from "@/lib/db/dashboard";

// The runway (docs/Decide-and-Grow.md, F1), rendered: its figures are the
// hero's own, its marks open what they are, the list holds the same points,
// and it draws in once per session -- never with reduced motion.

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
    amountHigh: null,
    amountBasis: "fixed",
    forecastBasis: null,
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

function safeToSpend(goalHolds: GoalHold[] = []): SafeToSpend {
  const projection = projectSafeToSpend({
    today: TODAY,
    cash: 2400,
    cushion: 300,
    // Already-netted holds: as inputs, a target of that amount with nothing
    // in yet and no schedule feeding it.
    goalHolds: goalHolds.map((g) => ({ goalId: g.goalId, name: g.name, monthly: g.amount, contributedThisMonth: 0, remaining: g.amount })),
    schedules: [once("Expense", "Rent", 800, 2), once("Income", "Paycheck", 1000, 9), once("Income", "Paycheck 2", 1000, 23)],
    futureTransactions: [],
    holidays: new Set(),
    fallbackWindowEnd: "2026-10-31",
  });
  return {
    ...projection,
    windowReason: null,
    cushionIsDefault: false,
    nextIncome: null,
    paycheck: "none",
    drawnFrom: [],
    notCounted: [],
  };
}

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

let dom: JSDOM;
let React: typeof import("react");
let act: typeof import("react").act;
let createRoot: typeof import("react-dom/client").createRoot;
let SafeToSpendHero: typeof import("./SafeToSpendHero").SafeToSpendHero;
let TodayProvider: typeof import("@/components/TodayProvider").TodayProvider;
let AppRouterContext: typeof import("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;
let reducedMotion = false;
const pushed: string[] = [];

before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "self", "document", "navigator", "HTMLElement", "Node", "Element", "SVGElement", "IntersectionObserver", "CustomEvent", "Event"]) {
    Object.defineProperty(g, key, {
      value: key === "window" || key === "self" ? dom.window : (dom.window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
  }
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  // jsdom has no matchMedia, and its <dialog> can't showModal.
  dom.window.matchMedia = ((query: string) => ({
    matches: query.includes("reduce") ? reducedMotion : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof dom.window.matchMedia;
  const proto = dom.window.HTMLDialogElement.prototype as unknown as { showModal(): void; close(): void };
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };

  React = await import("react");
  act = React.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ SafeToSpendHero } = await import("./SafeToSpendHero"));
  ({ TodayProvider } = await import("@/components/TodayProvider"));
  ({ AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime"));
});

const roots: { unmount(): void }[] = [];

after(async () => {
  await act(async () => roots.forEach((r) => r.unmount()));
  dom.window.close();
});

beforeEach(() => {
  reducedMotion = false;
  dom.window.sessionStorage.clear();
  pushed.length = 0;
});

const router = {
  push: (href: string) => void pushed.push(href),
  replace() {},
  refresh() {},
  back() {},
  forward() {},
  prefetch() {},
};

async function renderHero(data: SafeToSpend): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await act(async () =>
    root.render(
      <AppRouterContext.Provider value={router as never}>
        <TodayProvider today={TODAY} timeZone={zone}>
          <SafeToSpendHero data={data} />
        </TodayProvider>
      </AppRouterContext.Provider>,
    ),
  );
  return container;
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const b = [...container.querySelectorAll("button")].find((el) => el.textContent?.trim() === name);
  assert.ok(b, `no "${name}" button`);
  return b as HTMLButtonElement;
}

async function openRunway(container: HTMLElement): Promise<HTMLDialogElement> {
  await act(async () => buttonNamed(container, "See your runway").click());
  const dialog = container.querySelector("dialog");
  assert.ok(dialog?.hasAttribute("open"), "runway didn't open");
  return dialog as HTMLDialogElement;
}

async function closeRunway(container: HTMLElement) {
  const dialog = container.querySelector("dialog") as HTMLDialogElement;
  await act(async () => buttonNamed(dialog, "Close").click());
  assert.equal(container.querySelector("dialog"), null);
}

test("the hero offers the runway and the question, beside the card -- never inside its button", async () => {
  const container = await renderHero(safeToSpend());
  const toggle = container.querySelector("button[aria-expanded]") as HTMLButtonElement;
  assert.equal(toggle.querySelector("button"), null);
  buttonNamed(container, "See your runway");
  buttonNamed(container, "What if I spend…");
  assert.equal(container.querySelector("dialog"), null, "mounted only when opened");
});

test("the runway's figures are the hero's: lowest point, cushion and goals in the one line", async () => {
  const data = safeToSpend([{ goalId: "g", name: "Japan", amount: 150 }]);
  // 2400 - 800 = 1600 lowest; - 300 - 150 = 1150.
  assert.equal(data.trough.amount, 1600);
  assert.equal(data.safeToSpend, 1150);
  const container = await renderHero(data);
  const dialog = await openRunway(container);
  const text = dialog.textContent ?? "";
  assert.match(text, /\$1,600 lowest point − \$300 cushion − \$150 for goals = \$1,150 safe to spend\./);
  assert.match(text, /Saturday 3 October · \$1,600 · your lowest point, after Rent/);
  await closeRunway(container);
});

test("every mark is a door: the dip opens the bill, a sun opens the paycheck", async () => {
  const container = await renderHero(safeToSpend());
  const dialog = await openRunway(container);
  const hrefs = [...dialog.querySelectorAll("svg a")].map((a) => a.getAttribute("href"));
  // Rent's day is the lowest point -- its leaf is the door.
  assert.ok(hrefs.includes("/recurring#schedule-Rent"), hrefs.join(" "));
  assert.ok(hrefs.includes("/recurring#schedule-Paycheck"), hrefs.join(" "));
  assert.ok(hrefs.includes("/recurring#schedule-Paycheck 2"), hrefs.join(" "));
  const sun = [...dialog.querySelectorAll("svg a")].find((a) => a.getAttribute("aria-label")?.startsWith("Payday"));
  assert.ok(sun);
  await act(async () => (sun as unknown as HTMLElement).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })));
  assert.deepEqual(pushed, ["/recurring#schedule-Paycheck"]);
  await closeRunway(container);
});

test("View as list: the same points as a table, every item a link", async () => {
  const container = await renderHero(safeToSpend());
  const dialog = await openRunway(container);
  await act(async () => buttonNamed(dialog, "View as list").click());
  const table = dialog.querySelector("table");
  assert.ok(table);
  const rows = [...table.querySelectorAll("tbody tr")];
  assert.equal(rows.length, 3); // Rent (the lowest point), Paycheck, Paycheck 2
  assert.match(rows[0].textContent ?? "", /your lowest point/);
  const links = [...table.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  assert.deepEqual(links, ["/recurring#schedule-Rent", "/recurring#schedule-Paycheck", "/recurring#schedule-Paycheck 2"]);
  buttonNamed(dialog, "View as chart");
  await closeRunway(container);
});

test("draws in once per session; reduced motion never draws in", async () => {
  const container = await renderHero(safeToSpend());
  let dialog = await openRunway(container);
  assert.ok(dialog.querySelector(".runway-reveal"), "first open draws in");
  await closeRunway(container);
  dialog = await openRunway(container);
  assert.equal(dialog.querySelector(".runway-reveal"), null, "second open is still");
  await closeRunway(container);

  dom.window.sessionStorage.clear();
  reducedMotion = true;
  dialog = await openRunway(container);
  assert.equal(dialog.querySelector(".runway-reveal"), null, "reduced motion: drawn already");
  await closeRunway(container);
});

test("What if I spend… on the hero opens the question with the amount focused; Just looking closes", async () => {
  const container = await renderHero(safeToSpend());
  await act(async () => buttonNamed(container, "What if I spend…").click());
  const dialog = container.querySelector("dialog") as HTMLDialogElement;
  assert.ok(dialog);
  const amount = dialog.querySelector("input[inputmode=decimal]");
  assert.ok(amount !== null && document.activeElement === amount, "amount field not focused");
  const live = document.getElementById(amount?.getAttribute("aria-describedby") ?? "");
  assert.equal(live?.getAttribute("aria-live"), "polite");
  assert.match(live?.textContent ?? "", /Asking doesn.t save anything/);
  await act(async () => buttonNamed(dialog, "Just looking").click());
  assert.equal(container.querySelector("dialog"), null);
});

test("asking: POST with the amount in the body only, stale requests aborted, Log it hands a prefill to the add form", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const g = globalThis as Record<string, unknown>;
  const realFetch = g.fetch;
  g.fetch = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Promise((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new dom.window.DOMException("aborted", "AbortError")));
      setTimeout(
        () =>
          resolve(
            new Response(
              JSON.stringify({
                kind: "answer",
                horizonEnd: day(35),
                before: { safeToSpend: 1300, troughDate: day(2) },
                after: { safeToSpend: 400, signedSafeToSpend: 400, troughDate: day(2), troughItems: ["Rent"] },
                fits: true,
                earliestFit: null,
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
        50,
      );
    });
  };
  const opened: unknown[] = [];
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ prefill: unknown; handled: boolean }>).detail;
    detail.handled = true;
    opened.push(detail.prefill);
  };
  dom.window.addEventListener("sorrel:open-add-form", listener);
  try {
    const container = await renderHero(safeToSpend());
    await act(async () => buttonNamed(container, "What if I spend…").click());
    const dialog = container.querySelector("dialog") as HTMLDialogElement;
    const amount = dialog.querySelector("input[inputmode=decimal]") as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    const type = async (text: string) =>
      act(async () => {
        setValue.call(amount, text);
        amount.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });

    await type("9");
    await act(async () => new Promise((r) => setTimeout(r, 300))); // sent, in flight
    await type("90");
    await type("900"); // debounced together
    await act(async () => new Promise((r) => setTimeout(r, 400)));

    assert.equal(calls.length, 2, "one request per pause, not per keystroke");
    for (const c of calls) {
      assert.equal(c.url, "/dashboard/what-if");
      assert.equal(c.init.method, "POST");
      assert.doesNotMatch(c.url, /\d/, "no amount in the URL");
    }
    assert.equal(calls[0].init.signal?.aborted, true, "the stale question is aborted");
    assert.deepEqual(JSON.parse(String(calls[1].init.body)), { cents: 90000, date: TODAY });
    assert.match(dialog.textContent ?? "", /If you spend \$900 today, you'd still have \$400 safe to spend\./);

    await act(async () => buttonNamed(dialog, "Log it").click());
    assert.deepEqual(opened, [{ transaction_type: "Expense", amount: "900.00", transaction_date: TODAY }]);
    assert.equal(container.querySelector("dialog"), null, "the question closes as the form opens");
  } finally {
    dom.window.removeEventListener("sorrel:open-add-form", listener);
    g.fetch = realFetch;
  }
});

test("Log it from inside the runway closes the runway too, so the add form isn't underneath it", async () => {
  const g = globalThis as Record<string, unknown>;
  const realFetch = g.fetch;
  g.fetch = async () =>
    new Response(
      JSON.stringify({
        kind: "answer",
        horizonEnd: day(35),
        before: { safeToSpend: 1300, troughDate: day(2) },
        after: { safeToSpend: 1275, signedSafeToSpend: 1275, troughDate: day(2), troughItems: ["Rent"] },
        fits: true,
        earliestFit: null,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const listener = (e: Event) => {
    (e as CustomEvent<{ handled: boolean }>).detail.handled = true;
  };
  dom.window.addEventListener("sorrel:open-add-form", listener);
  try {
    const container = await renderHero(safeToSpend());
    const dialog = await openRunway(container);
    await act(async () => buttonNamed(dialog, "What if I spend…").click());
    const amount = dialog.querySelector("input[inputmode=decimal]") as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(amount, "25");
      amount.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await act(async () => new Promise((r) => setTimeout(r, 400)));
    await act(async () => buttonNamed(dialog, "Log it").click());
    assert.equal(container.querySelector("dialog"), null);
  } finally {
    dom.window.removeEventListener("sorrel:open-add-form", listener);
    g.fetch = realFetch;
  }
});

test("the breakdown has its own See your runway, and the figure still opens the breakdown", async () => {
  const container = await renderHero(safeToSpend());
  const toggle = container.querySelector("button[aria-expanded]") as HTMLButtonElement;
  await act(async () => toggle.click());
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(container.querySelector("dialog"), null, "the figure opens the breakdown, not the runway");
  const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
  assert.ok(panel);
  const inside = [...panel.querySelectorAll("button")].find((b) => b.textContent?.trim() === "See your runway");
  assert.ok(inside, "no See your runway inside the breakdown");
  await act(async () => (inside as HTMLButtonElement).click());
  assert.ok(container.querySelector("dialog")?.hasAttribute("open"));
  await closeRunway(container);
});
