import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { JSDOM } from "jsdom";
import type { FundingTransfer } from "@/lib/db/goals";

// The funding link is asked for in the same step as the monthly target:
// a link the user has to remember to make won't exist, and the failure is
// silent (the target and the transfer would both come off safe to spend).

let dom: JSDOM;
let React: typeof import("react");
let act: typeof import("react").act;
let createRoot: typeof import("react-dom/client").createRoot;
let GoalForm: typeof import("./GoalForm").GoalForm;

// Same "server-only" stub as SafeToSpendHero.test: the form imports Server
// Actions, and FundingTransfer's module is server-only (a type here).
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

const TO_SAVINGS: FundingTransfer = {
  id: "to-savings",
  description: "To savings",
  amount: 200,
  frequency: "Monthly",
  toAccountName: "Savings",
};

before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "self", "document", "navigator", "HTMLElement", "Node", "Element"]) {
    Object.defineProperty(g, key, {
      value: key === "window" || key === "self" ? dom.window : (dom.window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
  }
  g.IS_REACT_ACT_ENVIRONMENT = true;

  React = await import("react");
  act = React.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ GoalForm } = await import("./GoalForm"));
});

const roots: { unmount(): void }[] = [];

after(async () => {
  await act(async () => roots.forEach((r) => r.unmount()));
  dom.window.close();
});

async function render(props: Partial<Parameters<typeof GoalForm>[0]> = {}): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(<GoalForm fundingTransfers={[TO_SAVINGS]} onSuccess={() => {}} onCancel={() => {}} {...props} />),
  );
  return container;
}

async function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, value);
  await act(async () => {
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

const monthlyInput = (c: HTMLElement) => c.querySelector('input[name="monthly_contribution"]') as HTMLInputElement;
const picker = (c: HTMLElement) => c.querySelector('select[name="funding_recurringid"]') as HTMLSelectElement | null;

test("no monthly target, no funding question", async () => {
  const c = await render();
  assert.equal(picker(c), null);
  assert.ok(!(c.textContent ?? "").includes("Do you move this money automatically?"));
});

test("typing a monthly target asks the funding question in the same step", async () => {
  const c = await render();
  await type(monthlyInput(c), "200");

  const select = picker(c);
  assert.ok(select, "the picker appears");
  assert.ok((c.textContent ?? "").includes("Do you move this money automatically?"));
  assert.deepEqual(
    [...select.options].map((o) => [o.value, o.textContent]),
    [
      ["", "No, I add it myself"],
      ["to-savings", "To savings · $200.00 monthly to Savings"],
    ],
  );
  assert.equal(select.value, "");
});

test("a zero target is no target: the question goes away", async () => {
  const c = await render();
  await type(monthlyInput(c), "200");
  await type(monthlyInput(c), "0");
  assert.equal(picker(c), null);
});

test("with no recurring transfers the question is still asked, as a pointer", async () => {
  const c = await render({ fundingTransfers: [] });
  await type(monthlyInput(c), "200");
  assert.equal(picker(c), null);
  assert.ok((c.textContent ?? "").includes("Do you move this money automatically?"));
});

test("editing keeps the current link selected, even once it's no longer counted", async () => {
  const goal = {
    goal_id: "japan",
    goal_name: "Japan",
    goal_type: "Vacation",
    target_amount: 5000,
    target_date: null,
    monthly_contribution: 200,
  };
  const linked = await render({ goal: { ...goal, funding_recurringid: "to-savings" } });
  assert.equal(picker(linked)!.value, "to-savings");

  const stale = await render({ goal: { ...goal, funding_recurringid: "paused-one" } });
  const select = picker(stale)!;
  assert.equal(select.value, "paused-one");
  assert.equal(select.selectedOptions[0].textContent, "The linked transfer (not counted right now)");
});
