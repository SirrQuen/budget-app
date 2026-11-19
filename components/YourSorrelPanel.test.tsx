import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// The Your Sorrel panel: nothing is read until it opens, one GET when it
// does, earned milestones as tiles with dates and a "More to discover" tile
// (never a locked list), and Close / Escape hand focus back to what asked.

let dom: JSDOM;
let React: typeof import("react");
let act: typeof import("react").act;
let createRoot: typeof import("react-dom/client").createRoot;
let YourSorrelPanel: typeof import("./YourSorrelPanel").YourSorrelPanel;
let requestYourSorrel: typeof import("@/lib/yourSorrel").requestYourSorrel;
let YOUR_SORREL_URL: string;

const calls: { url: string; init: RequestInit }[] = [];
let respond: () => Response = () => new Response("{}", { status: 500 });

before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "self", "document", "navigator", "HTMLElement", "Node", "Element", "SVGElement", "CustomEvent", "Event"]) {
    Object.defineProperty(g, key, {
      value: key === "window" || key === "self" ? dom.window : (dom.window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
  }
  g.requestAnimationFrame = (cb: () => void) => {
    cb();
    return 0;
  };
  g.cancelAnimationFrame = () => {};
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.fetch = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(respond());
  };
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
  ({ YourSorrelPanel } = await import("./YourSorrelPanel"));
  ({ requestYourSorrel, YOUR_SORREL_URL } = await import("@/lib/yourSorrel"));
});

after(() => dom.window.close());

async function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const trigger = document.createElement("button");
  trigger.textContent = "Your Sorrel";
  document.body.appendChild(trigger);
  const root = createRoot(container);
  await act(async () => root.render(<YourSorrelPanel />));
  return { container, trigger, root };
}

test("nothing is read until it opens; opening reads once and shows dates, with no locked list", async () => {
  calls.length = 0;
  respond = () =>
    new Response(
      JSON.stringify({
        since: "2026-10-16",
        milestones: [
          { id: "log-1", label: "Your first log", date: "2026-10-17" },
          { id: "first-goal", label: "Your first goal set", date: "2026-10-20" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const { container, trigger, root } = await setup();
  assert.equal(calls.length, 0, "a read before the panel opened");
  assert.equal(container.querySelector("dialog"), null);

  trigger.focus();
  await act(async () => requestYourSorrel(trigger));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, YOUR_SORREL_URL);
  assert.equal(calls[0].init.method ?? "GET", "GET");

  const dialog = container.querySelector("dialog") as HTMLDialogElement;
  assert.ok(dialog.hasAttribute("open"));
  assert.equal(dialog.getAttribute("aria-labelledby") !== null, true);
  const text = dialog.textContent ?? "";
  assert.match(text, /With Sorrel since Oct 16, 2026/);
  assert.match(text, /Your first log/);
  assert.match(text, /Oct 20, 2026/);
  assert.match(text, /More to discover/);
  assert.equal(dialog.querySelectorAll("li").length, 3, "two earned + the one More to discover tile");
  await act(async () => root.unmount());
});

test("Escape closes it and focus goes back to what asked; a second opening reads again", async () => {
  calls.length = 0;
  respond = () => new Response(JSON.stringify({ since: null, milestones: [] }), { status: 200 });
  const { container, trigger, root } = await setup();
  await act(async () => requestYourSorrel(trigger));
  const dialog = container.querySelector("dialog") as HTMLDialogElement;
  assert.match(dialog.textContent ?? "", /More to discover/);
  assert.doesNotMatch(dialog.textContent ?? "", /With Sorrel since/);

  const cancel = new dom.window.Event("cancel", { cancelable: true });
  await act(async () => void dialog.dispatchEvent(cancel));
  assert.equal(cancel.defaultPrevented, true, "the dialog's own close is taken over");
  assert.equal(container.querySelector("dialog"), null);
  assert.equal(document.activeElement, trigger);

  await act(async () => requestYourSorrel(trigger));
  assert.equal(calls.length, 2);
  await act(async () => root.unmount());
});

test("a failed read says so quietly and still closes", async () => {
  respond = () => new Response("{}", { status: 503 });
  const { container, trigger, root } = await setup();
  await act(async () => requestYourSorrel(trigger));
  const dialog = container.querySelector("dialog") as HTMLDialogElement;
  assert.match(dialog.textContent ?? "", /couldn.t load this just now/);
  const close = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Close");
  assert.ok(close);
  await act(async () => (close as HTMLButtonElement).click());
  assert.equal(container.querySelector("dialog"), null);
  await act(async () => root.unmount());
});
