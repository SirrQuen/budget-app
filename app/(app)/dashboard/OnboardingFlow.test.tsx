import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { JSDOM } from "jsdom";

// Onboarding's screens, rendered (docs/Decide-and-Grow.md, G). The writes
// are server actions on the existing paths; this checks what each step
// asks, and that it asks it accessibly.

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

const TODAY = "2026-11-17";
let dom: JSDOM;
let React: typeof import("react");
let act: typeof import("react").act;
let createRoot: typeof import("react-dom/client").createRoot;
let OnboardingFlow: typeof import("./OnboardingFlow").OnboardingFlow;
let TodayProvider: typeof import("@/components/TodayProvider").TodayProvider;
let AppRouterContext: typeof import("next/dist/shared/lib/app-router-context.shared-runtime").AppRouterContext;

before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "self", "document", "navigator", "HTMLElement", "Node", "Element", "SVGElement", "IntersectionObserver"]) {
    Object.defineProperty(g, key, {
      value: key === "window" || key === "self" ? dom.window : (dom.window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
  }
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
  g.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import("react");
  act = React.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ OnboardingFlow } = await import("./OnboardingFlow"));
  ({ TodayProvider } = await import("@/components/TodayProvider"));
  ({ AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime"));
});

const roots: { unmount(): void }[] = [];
after(async () => {
  await act(async () => roots.forEach((r) => r.unmount()));
  dom.window.close();
});

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };

async function render(props: Partial<Parameters<typeof OnboardingFlow>[0]> & { step: 1 | 2 }): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await act(async () =>
    root.render(
      <AppRouterContext.Provider value={router as never}>
        <TodayProvider today={TODAY} timeZone={zone}>
          <OnboardingFlow
            welcome="Welcome"
            accounts={[{ id: "a1", name: "Everyday" }]}
            incomeCategories={[{ id: "c1", name: "Paychecks/Salary" }]}
            defaultCategoryId="c1"
            skipToken="0123456789abcdef"
            {...props}
          />
        </TodayProvider>
      </AppRouterContext.Provider>,
    ),
  );
  return container;
}

function radio(container: HTMLElement, name: string, value: string): HTMLInputElement {
  const el = container.querySelector(`input[type=radio][name=${name}][value=${value}]`);
  assert.ok(el, `no ${name}=${value}`);
  return el as HTMLInputElement;
}

test("step 1: progress says so; Checking or Cash only, Checking chosen; balance date is today", async () => {
  const c = await render({ step: 1 });
  assert.match(c.textContent ?? "", /Step 1 of 3/);
  assert.equal(c.querySelector("[aria-current=step]")?.textContent?.trim(), "Your account");
  const types = [...c.querySelectorAll("input[type=radio][name=account_type]")].map((r) => (r as HTMLInputElement).value);
  assert.deepEqual(types, ["Checking", "Cash"]);
  assert.equal(radio(c, "account_type", "Checking").checked, true);
  assert.equal((c.querySelector("input[name=opening_date]") as HTMLInputElement).value, TODAY);
  assert.ok(c.querySelector("input[name=account_name][required]"));
  for (const input of c.querySelectorAll("input:not([type=hidden]):not([type=radio])")) {
    assert.ok(c.querySelector(`label[for="${input.id}"]`), `unlabelled ${input.getAttribute("name")}`);
  }
});

test("step 2: frequencies; twice a month asks two paydays; last day only for monthly ones", async () => {
  const c = await render({ step: 2 });
  assert.match(c.textContent ?? "", /Step 2 of 3/);
  const freqs = [...c.querySelectorAll("input[type=radio][name=frequency]")].map((r) => (r as HTMLInputElement).value);
  assert.deepEqual(freqs, ["weekly", "every_2_weeks", "twice_a_month", "monthly"]);
  // Every 2 weeks by default: one payday, no "last day".
  assert.equal(c.querySelectorAll("input[type=date]").length, 1);
  assert.equal(c.querySelector("input[name=last_day_1]"), null);
  assert.equal((c.querySelector("input[name=payday_1]") as HTMLInputElement).min, TODAY);

  await act(async () => radio(c, "frequency", "twice_a_month").click());
  assert.ok(c.querySelector("input[name=payday_1]") && c.querySelector("input[name=payday_2]"));
  assert.ok(c.querySelector("input[name=last_day_1]") && c.querySelector("input[name=last_day_2]"));

  // "Last day of the month" fills in this month's last day and says so.
  await act(async () => (c.querySelector("input[name=last_day_2]") as HTMLInputElement).click());
  assert.equal((c.querySelector("input[type=hidden][name=payday_2]") as HTMLInputElement).value, "2026-11-30");
  assert.match(c.textContent ?? "", /Every month.s last day, starting Monday 30 November/);

  await act(async () => radio(c, "frequency", "weekly").click());
  assert.equal(c.querySelector("input[name=last_day_1]"), null);
  assert.equal(c.querySelector("input[name=payday_2]"), null);
});

test("step 2: Paychecks/Salary is used quietly; archived, it asks -- never creates one", async () => {
  const quiet = await render({ step: 2 });
  assert.equal((quiet.querySelector("input[type=hidden][name=categoryid]") as HTMLInputElement).value, "c1");
  assert.equal(quiet.querySelector("select[name=categoryid]"), null);

  const asks = await render({ step: 2, defaultCategoryId: null, incomeCategories: [{ id: "c2", name: "Side income" }] });
  const select = asks.querySelector("select[name=categoryid]") as HTMLSelectElement;
  assert.ok(select);
  assert.deepEqual([...select.options].map((o) => o.value), ["", "c2"]);
});

test("step 2: one checking account is used quietly; two are asked about", async () => {
  const one = await render({ step: 2 });
  assert.equal((one.querySelector("input[type=hidden][name=accountid]") as HTMLInputElement).value, "a1");
  const two = await render({ step: 2, accounts: [{ id: "a1", name: "Everyday" }, { id: "a2", name: "Wallet" }] });
  assert.ok(two.querySelector("select[name=accountid]"));
});

test("step 2: skip is offered, in words that don't judge", async () => {
  const c = await render({ step: 2 });
  const skip = [...c.querySelectorAll("button")].find((b) => b.textContent?.includes("skip this"));
  assert.match(skip?.textContent?.trim() ?? "", /^My pay isn.t regular, so skip this$/);
});
