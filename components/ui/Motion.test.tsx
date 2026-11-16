import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { formatCurrency } from "@/lib/format";
import type { SavedSummary } from "@/lib/savedSummary";

// The motion effects of docs/Motion-and-Delight.md, batch A, against the
// rules that bind them: nothing moves on first render, a rise rolls up with
// a glow, a fall rolls down with none, reduced motion shows the end state
// at once, and a screen reader is given the final figure in a polite
// region, not the rolling digits.

let dom: JSDOM;
let reducedMotion = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let React: any, act: any, createRoot: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RollingFigure: any, useValueChange: any, SaveToast: any, ValueSharpen: any, SaveLeaves: any, SavedLabel: any, StatTile: any;

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
  // jsdom has no matchMedia; this one reads the test's own switch.
  (dom.window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: reducedMotion && query.includes("reduce"),
    addEventListener() {},
    removeEventListener() {},
  });
  g.IS_REACT_ACT_ENVIRONMENT = true;

  React = await import("react");
  act = React.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ RollingFigure } = await import("./RollingFigure"));
  ({ useValueChange } = await import("./useValueChange"));
  ({ SaveToast, SaveLeaves, SavedLabel } = await import("./SaveToast"));
  ({ ValueSharpen } = await import("./ValueSharpen"));
  ({ StatTile } = await import("./StatTile"));
});

beforeEach(() => {
  reducedMotion = false;
});

const roots: { unmount(): void }[] = [];
after(async () => {
  await act(async () => roots.forEach((r) => r.unmount()));
  dom.window.close();
});

const text = (n: number) => (n > 0 ? `+${formatCurrency(n)}` : formatCurrency(0));

function Figure({ value }: { value: number }) {
  const change = useValueChange(value);
  const previous = change.previous === null ? null : text(change.previous);
  return <RollingFigure text={text(value)} previousText={previous} change={change} />;
}

async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return { container, rerender: (next: React.ReactNode) => act(async () => root.render(next)) };
}

const rolling = (c: HTMLElement) => c.querySelectorAll(".roll-digit").length;
const glow = (c: HTMLElement) => c.querySelectorAll(".figure-glow").length;
const live = (c: HTMLElement) => c.querySelector("[aria-live]");

test("first load shows the number still: no roll, no glow", async () => {
  const { container } = await mount(<Figure value={1200} />);
  assert.equal(rolling(container), 0);
  assert.equal(glow(container), 0);
  assert.match(container.textContent ?? "", /\+\$1,200\.00/);
});

test("a rise rolls up and glows", async () => {
  const { container, rerender } = await mount(<Figure value={1200} />);
  await rerender(<Figure value={1500} />);
  assert.ok(rolling(container) > 0, "digits roll");
  assert.equal(glow(container), 1, "a rise glows");
  assert.ok(container.querySelector(".roll-track--up"));
  assert.equal(container.querySelector(".roll-track--down"), null);
});

test("a fall rolls down with no glow, and no colour of its own", async () => {
  const { container, rerender } = await mount(<Figure value={1200} />);
  await rerender(<Figure value={900} />);
  assert.ok(rolling(container) > 0);
  assert.ok(container.querySelector(".roll-track--down"));
  assert.equal(glow(container), 0, "a fall never glows");
  assert.equal(container.innerHTML.includes("critical"), false);
  assert.equal(container.innerHTML.includes("text-red"), false);
});

test("the same value again moves nothing", async () => {
  const { container, rerender } = await mount(<Figure value={1200} />);
  await rerender(<Figure value={1200} />);
  assert.equal(rolling(container), 0);
  assert.equal(glow(container), 0);
});

test("the roll ends when its animation does, leaving plain text", async () => {
  const { container, rerender } = await mount(<Figure value={1200} />);
  await rerender(<Figure value={1500} />);
  assert.ok(rolling(container) > 0);
  // The backstop timer settles it even if the browser never reports the end.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 800));
  });
  assert.equal(rolling(container), 0);
  assert.match(container.textContent ?? "", /\+\$1,500\.00/);
});

test("reduced motion: the end state at once, no digits, no glow", async () => {
  reducedMotion = true;
  const { container, rerender } = await mount(<Figure value={1200} />);
  await rerender(<Figure value={1500} />);
  assert.equal(rolling(container), 0);
  assert.equal(glow(container), 0);
  assert.match(container.textContent ?? "", /\+\$1,500\.00/);
});

test("a screen reader gets the final figure in a polite region; the digits are hidden", async () => {
  const { container, rerender } = await mount(<Figure value={1200} />);
  await rerender(<Figure value={1500} />);
  const region = live(container) as HTMLElement;
  assert.equal(region.getAttribute("aria-live"), "polite");
  assert.equal(region.textContent, "+$1,500.00");
  for (const digit of container.querySelectorAll(".roll-digit")) {
    assert.ok(digit.closest("[aria-hidden='true']"), "rolling digits are aria-hidden");
  }
});

test("a balance sharpens only when it changes, never on first render, never differently by direction", async () => {
  const { container, rerender } = await mount(<ValueSharpen value={100}>$100.00</ValueSharpen>);
  assert.equal(container.querySelector("[class*='value-sharpen']"), null);
  await rerender(<ValueSharpen value={80}>$80.00</ValueSharpen>);
  const fell = container.firstElementChild?.className ?? "";
  assert.match(fell, /value-sharpen-/);
  await rerender(<ValueSharpen value={150}>$150.00</ValueSharpen>);
  const rose = container.firstElementChild?.className ?? "";
  assert.match(rose, /value-sharpen-/);
  assert.notEqual(fell.match(/value-sharpen-\w/)?.[0], rose.match(/value-sharpen-\w/)?.[0], "alternates so it restarts");
});

test("reduced motion: a balance just changes", async () => {
  reducedMotion = true;
  const { container, rerender } = await mount(<ValueSharpen value={100}>$100.00</ValueSharpen>);
  await rerender(<ValueSharpen value={80}>$80.00</ValueSharpen>);
  assert.equal(container.querySelector("[class*='value-sharpen']"), null);
});

const coffee: SavedSummary = {
  message: "Logged · Coffee $5.75",
  firstToday: false,
  source: {
    kind: "single",
    description: "Coffee",
    amount: 5.75,
    transaction_type: "Expense",
    categoryid: "c",
    accountid: "a",
  },
};

test("the toast reads the line, offers Log again, and shows no chip on a later save", async () => {
  let again: SavedSummary | null = null;
  const { container } = await mount(<SaveToast summary={coffee} onLogAgain={(s: SavedSummary) => (again = s)} />);
  assert.match(container.textContent ?? "", /Logged · Coffee \$5\.75/);
  assert.doesNotMatch(container.textContent ?? "", /First one today/);
  const link = [...container.querySelectorAll("button")].find((b) => b.textContent === "Log again") as HTMLButtonElement;
  await act(async () => link.click());
  assert.equal(again, coffee);
});

test("the first save of the day carries the chip", async () => {
  const { container } = await mount(<SaveToast summary={{ ...coffee, firstToday: true }} onLogAgain={() => {}} />);
  assert.match(container.textContent ?? "", /First one today/);
});

test("the toast says nothing about streaks, counts or yesterday", async () => {
  const { container } = await mount(<SaveToast summary={{ ...coffee, firstToday: true }} onLogAgain={() => {}} />);
  assert.doesNotMatch(container.textContent ?? "", /streak|day in a row|yesterday|!/i);
});

test("leaves fly on a save and not before; none under reduced motion", async () => {
  const first = await mount(<SaveLeaves seq={0} />);
  assert.equal(first.container.querySelectorAll(".save-leaf").length, 0);
  const saved = await mount(<SaveLeaves seq={1} />);
  assert.equal(saved.container.querySelectorAll(".save-leaf").length, 2);
  reducedMotion = true;
  const calm = await mount(<SaveLeaves seq={2} />);
  assert.equal(calm.container.querySelectorAll(".save-leaf").length, 0);
});

test("the Saved label is a check and a word", async () => {
  const { container } = await mount(<SavedLabel />);
  assert.equal(container.textContent, "Saved");
  assert.ok(container.querySelector("svg"));
});

test("a stat tile shows its figure still on load and rolls only on a change", async () => {
  const { container, rerender } = await mount(<StatTile label="Net worth" value={5000} format="currency" />);
  assert.equal(rolling(container), 0);
  assert.equal(glow(container), 0);
  assert.match(container.textContent ?? "", /5/);
  await rerender(<StatTile label="Net worth" value={4000} format="currency" />);
  assert.ok(rolling(container) > 0);
  assert.equal(glow(container), 0, "a fall never glows");
  await rerender(<StatTile label="Net worth" value={9000} format="currency" />);
  assert.equal(glow(container), 0, "a tile never glows, even on a rise");
});
