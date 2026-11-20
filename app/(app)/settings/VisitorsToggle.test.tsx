import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// The Settings switch for visitors: on by default, kept on this device only.

let dom: JSDOM;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let React: any, act: any, createRoot: any, VisitorsToggle: any;

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
  ({ VisitorsToggle } = await import("./VisitorsToggle"));
});
beforeEach(() => dom.window.localStorage.clear());
after(() => dom.window.close());

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<VisitorsToggle />));
  return container;
}
const sw = (c: HTMLElement) => c.querySelector('[role="switch"]') as HTMLButtonElement;

test("on by default, and named for what it does", async () => {
  const c = await mount();
  assert.equal(sw(c).getAttribute("aria-checked"), "true");
  assert.match(c.textContent ?? "", /Visitors on the dashboard/);
});

test("turning it off stores visitors-off; turning it on clears it", async () => {
  const c = await mount();
  await act(async () => sw(c).click());
  assert.equal(sw(c).getAttribute("aria-checked"), "false");
  assert.equal(dom.window.localStorage.getItem("visitors-off"), "1");
  await act(async () => sw(c).click());
  assert.equal(sw(c).getAttribute("aria-checked"), "true");
  assert.equal(dom.window.localStorage.getItem("visitors-off"), null);
});

test("an earlier off choice is read on load", async () => {
  dom.window.localStorage.setItem("visitors-off", "1");
  const c = await mount();
  assert.equal(sw(c).getAttribute("aria-checked"), "false");
});

test("blocked storage: reads as on and doesn't throw when pressed", async () => {
  const real = dom.window.localStorage;
  Object.defineProperty(dom.window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
  try {
    const c = await mount();
    assert.equal(sw(c).getAttribute("aria-checked"), "true");
    await act(async () => sw(c).click());
  } finally {
    Object.defineProperty(dom.window, "localStorage", { configurable: true, value: real });
  }
});
