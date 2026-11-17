import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// GoalStem (docs/Motion-and-Delight.md, step 5): nothing moves on first
// render, a rise past a leaf unfurls it once, a fall past one returns it to
// outline with no animation and no colour, and a screen reader reads the
// progress text and never the leaves.

let dom: JSDOM;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let React: any, act: any, createRoot: any, GoalStem: any;

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
  ({ GoalStem } = await import("./GoalStem"));
});

const roots: { unmount(): void }[] = [];
after(async () => {
  await act(async () => roots.forEach((r) => r.unmount()));
  dom.window.close();
});

const stem = (value: number, toGo: number | null = 560, complete = false) => (
  <GoalStem goalName="Japan" value={value} toGo={toGo} complete={complete} />
);

async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return { container, rerender: (next: React.ReactNode) => act(async () => root.render(next)) };
}

const unfurling = (c: HTMLElement) => c.querySelectorAll(".goal-leaf--unfurl").length;
const solid = (c: HTMLElement) =>
  [...c.querySelectorAll("svg path")].filter((p) => p.getAttribute("fill") === "var(--action)").length;

test("first render: fill at its final scale, nothing unfurls", async () => {
  const { container } = await mount(stem(60));
  assert.equal(unfurling(container), 0);
  assert.equal(solid(container), 2, "25 and 50 are passed");
  const fill = container.querySelector(".goal-stem__fill") as HTMLElement;
  assert.equal(fill.style.transform, "scaleX(0.6)");
  assert.equal(fill.style.width, "", "drawn by scale, never width");
});

test("a rise past a leaf unfurls that leaf only", async () => {
  const { container, rerender } = await mount(stem(40));
  await rerender(stem(55));
  assert.equal(unfurling(container), 1);
  assert.equal(solid(container), 2);
});

test("a rise that passes no leaf unfurls nothing", async () => {
  const { container, rerender } = await mount(stem(30));
  await rerender(stem(40));
  assert.equal(unfurling(container), 0);
});

test("a fall below a leaf returns it to outline: no animation, no red", async () => {
  const { container, rerender } = await mount(stem(60));
  await rerender(stem(40));
  assert.equal(unfurling(container), 0);
  assert.equal(solid(container), 1);
  assert.equal(container.innerHTML.includes("critical"), false);
  assert.equal(container.innerHTML.includes("red"), false);
  const fill = container.querySelector(".goal-stem__fill") as HTMLElement;
  assert.equal(fill.style.transform, "scaleX(0.4)");
});

test("the progress text is the bar's; the leaves are hidden from a screen reader", async () => {
  const { container } = await mount(stem(72, 560));
  const bar = container.querySelector('[role="progressbar"]') as HTMLElement;
  assert.equal(bar.getAttribute("aria-valuenow"), "72");
  assert.equal(bar.getAttribute("aria-valuemin"), "0");
  assert.equal(bar.getAttribute("aria-valuemax"), "100");
  assert.equal(bar.getAttribute("aria-valuetext"), "72 percent, $560.00 to go");
  const leaves = container.querySelector("svg")?.parentElement as HTMLElement;
  assert.equal(leaves.getAttribute("aria-hidden"), "true");
  assert.equal(bar.querySelector("svg"), null);
});

test("a complete goal reads as complete, not as a figure to go", async () => {
  const { container } = await mount(stem(100, 0, true));
  const bar = container.querySelector('[role="progressbar"]') as HTMLElement;
  assert.equal(bar.getAttribute("aria-valuetext"), "100 percent, complete");
});
