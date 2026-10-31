import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { JSDOM } from "jsdom";
import type { TransactionAccountOption } from "../transactions/AddTransactionForm";
import type { GoalOption } from "@/lib/db/goals";
import type { EditableRecurring } from "./RecurringForm";

// Amount and "What day does this card's statement close?" share one slot.
// The dangerous stale value isn't an out-of-range day; it's a $15 payment
// becoming statement day 15 -- valid, plausible, and chosen by nobody. So
// every swap clears both, in both directions, whatever caused it.

let dom: JSDOM;
let React: typeof import("react");
let act: typeof import("react").act;
let createRoot: typeof import("react-dom/client").createRoot;
let RecurringForm: typeof import("./RecurringForm").RecurringForm;
let TodayProvider: typeof import("@/components/TodayProvider").TodayProvider;

// The form imports Server Actions, whose data layer imports "server-only" --
// a marker only Next's bundler resolves. Same stub as SafeToSpendHero.test.
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

const ACCOUNTS: TransactionAccountOption[] = [
  { id: "checking", account_name: "Checking", is_active: true, opening_date: "2026-01-01", account_type: "Checking" },
  { id: "card", account_name: "Visa", is_active: true, opening_date: "2026-01-01", account_type: "Credit Card" },
  { id: "savings", account_name: "Savings", is_active: true, opening_date: "2026-01-01", account_type: "Savings" },
  { id: "cash", account_name: "Wallet", is_active: true, opening_date: "2026-01-01", account_type: "Cash" },
];

const JAPAN: GoalOption = { id: "japan", name: "Japan", monthlyContribution: 200, fundingRecurringId: null };
const CAR: GoalOption = { id: "car", name: "Car", monthlyContribution: null, fundingRecurringId: null };

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
  ({ RecurringForm } = await import("./RecurringForm"));
  ({ TodayProvider } = await import("@/components/TodayProvider"));
});

const roots: { unmount(): void }[] = [];

after(async () => {
  await act(async () => roots.forEach((r) => r.unmount()));
  dom.window.close();
});

async function render(
  props: { goals?: GoalOption[]; recurring?: EditableRecurring } = {},
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await act(async () =>
    root.render(
      <TodayProvider today="2026-10-31" timeZone={zone}>
        <RecurringForm
          incomeCategories={[]}
          expenseCategories={[]}
          accounts={ACCOUNTS}
          goals={props.goals ?? []}
          recurring={props.recurring}
          onSuccess={() => {}}
          onCancel={() => {}}
        />
      </TodayProvider>,
    ),
  );
  return container;
}

// React tracks a controlled field's value through the native setter, so
// set it there and dispatch the event React listens for.
async function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement : dom.window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!.call(el, value);
  await act(async () => {
    el.dispatchEvent(new dom.window.Event(el instanceof dom.window.HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
}

const q = <T extends Element>(c: HTMLElement, sel: string) => c.querySelector(sel) as T | null;

async function cardPaymentForm(): Promise<HTMLElement> {
  const c = await render();
  await click(q<HTMLInputElement>(c, 'input[name="kind"][value="Transfer"]')!);
  await setValue(q<HTMLSelectElement>(c, 'select[name="accountid"]')!, "checking");
  await setValue(q<HTMLSelectElement>(c, 'select[name="to_accountid"]')!, "card");
  return c;
}

test("a $15 amount doesn't become statement day 15 when the amount turns variable", async () => {
  const c = await cardPaymentForm();
  await setValue(q<HTMLInputElement>(c, 'input[name="amount"]')!, "15");

  await click(q<HTMLInputElement>(c, 'input[name="amount_is_variable"]')!);

  const day = q<HTMLSelectElement>(c, 'select[name="statement_day"]');
  assert.ok(day, "the statement day list replaces Amount");
  assert.equal(day.value, "");
  assert.equal(q(c, 'input[name="amount"]'), null);
});

test("a chosen statement day doesn't come back as an amount when the amount turns fixed", async () => {
  const c = await cardPaymentForm();
  await click(q<HTMLInputElement>(c, 'input[name="amount_is_variable"]')!);
  await setValue(q<HTMLSelectElement>(c, 'select[name="statement_day"]')!, "15");

  await click(q<HTMLInputElement>(c, 'input[name="amount_is_variable"]')!);

  assert.equal(q<HTMLInputElement>(c, 'input[name="amount"]')!.value, "");
  // And back again: the day is gone too, not remembered.
  await click(q<HTMLInputElement>(c, 'input[name="amount_is_variable"]')!);
  assert.equal(q<HTMLSelectElement>(c, 'select[name="statement_day"]')!.value, "");
});

test("changing the destination away from the card clears the statement day too", async () => {
  const c = await cardPaymentForm();
  await click(q<HTMLInputElement>(c, 'input[name="amount_is_variable"]')!);
  await setValue(q<HTMLSelectElement>(c, 'select[name="statement_day"]')!, "15");

  await setValue(q<HTMLSelectElement>(c, 'select[name="to_accountid"]')!, "savings");

  assert.equal(q<HTMLInputElement>(c, 'input[name="amount"]')!.value, "");
});

test("the statement day list runs 1st to 31st, the last three marked as not every month", async () => {
  const c = await cardPaymentForm();
  await click(q<HTMLInputElement>(c, 'input[name="amount_is_variable"]')!);
  const options = [...q<HTMLSelectElement>(c, 'select[name="statement_day"]')!.options].filter((o) => o.value !== "");

  assert.equal(options.length, 31);
  assert.equal(options[0].textContent, "1st");
  assert.equal(options[27].textContent, "28th");
  assert.deepEqual(
    options.slice(28).map((o) => o.textContent),
    ["29th (not every month)", "30th (not every month)", "31st (not every month)"],
  );
  assert.ok(c.textContent?.includes("What day does this card's statement close?"));
});

// "Is this for a goal?" -- the recurring side of goals.funding_recurringid.
// Without it, a goal set first and automated later is never linked, and
// both its target and the transfer come off safe to spend.
async function transfer(c: HTMLElement, from: string, to: string) {
  await click(q<HTMLInputElement>(c, 'input[name="kind"][value="Transfer"]')!);
  await setValue(q<HTMLSelectElement>(c, 'select[name="accountid"]')!, from);
  await setValue(q<HTMLSelectElement>(c, 'select[name="to_accountid"]')!, to);
}

const goalPicker = (c: HTMLElement) => q<HTMLSelectElement>(c, 'select[name="funding_goalid"]');
const asked = (c: HTMLElement) => q<HTMLInputElement>(c, 'input[name="funding_goal_asked"]');

test("a counted transfer asks whether it's for a goal, at create", async () => {
  const c = await render({ goals: [CAR, JAPAN] });
  await transfer(c, "checking", "savings");

  const select = goalPicker(c);
  assert.ok(select, "the question appears");
  assert.equal(asked(c)?.value, "1");
  assert.deepEqual(
    [...select.options].map((o) => [o.value, o.textContent]),
    [
      ["", "No"],
      ["car", "Car"],
      ["japan", "Japan · $200.00 a month"],
    ],
  );
  assert.equal(select.value, "");
});

test("a transfer safe to spend doesn't count (Checking -> Cash) isn't asked", async () => {
  const c = await render({ goals: [JAPAN] });
  await transfer(c, "checking", "cash");
  assert.equal(goalPicker(c), null);
  assert.equal(asked(c), null);
});

test("no goals, no question", async () => {
  const c = await render({ goals: [] });
  await transfer(c, "checking", "savings");
  assert.equal(goalPicker(c), null);
});

const EDITING: EditableRecurring = {
  id: "to-savings",
  description: "To savings",
  amount: 200,
  kind: "Transfer",
  categoryid: null,
  accountid: "checking",
  to_accountid: "savings",
  frequency: "Monthly",
  interval_count: 1,
  next_run_date: "2026-11-01",
  occurrence_limit: null,
  end_date: null,
  amount_is_variable: false,
  statement_day: null,
  date_tolerance_days: 0,
  business_day_offset: 0,
  non_business_day_rule: "none",
};

test("at edit, the goal this transfer funds is already chosen", async () => {
  const c = await render({ recurring: EDITING, goals: [CAR, { ...JAPAN, fundingRecurringId: "to-savings" }] });
  assert.equal(goalPicker(c)?.value, "japan");
  assert.equal(asked(c)?.value, "1");
});

test("funding two goals: no picker -- one answer would unlink the other -- and nothing is posted", async () => {
  const c = await render({
    recurring: EDITING,
    goals: [
      { ...CAR, fundingRecurringId: "to-savings" },
      { ...JAPAN, fundingRecurringId: "to-savings" },
    ],
  });
  assert.equal(goalPicker(c), null);
  assert.equal(asked(c), null);
  assert.ok((c.textContent ?? "").includes("This transfer funds Car, Japan. Change that from each goal."));
});
