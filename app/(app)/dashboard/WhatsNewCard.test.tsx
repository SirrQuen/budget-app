import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// The What's new card: lines in order, each wired to what it names; a phone
// shows three with a real "Show all" button that expands in place and works
// from the keyboard; "Got it" calls the Server Function once.

let dom: JSDOM;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let React: any, act: any, createRoot: any, WhatsNewCard: any, whatsNewItems: any;
let OPEN_RUNWAY_EVENT: string, OPEN_YOUR_SORREL_EVENT: string;

before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "self", "document", "navigator", "HTMLElement", "Node", "Element", "CustomEvent", "Event"]) {
    Object.defineProperty(g, key, {
      value: key === "window" || key === "self" ? dom.window : (dom.window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
  }
  g.IS_REACT_ACT_ENVIRONMENT = true;
  (dom.window as unknown as Record<string, unknown>).matchMedia = () => ({
    matches: true, // reduced motion: "Got it" hides at once
    addEventListener() {},
    removeEventListener() {},
  });
  React = await import("react");
  act = React.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ WhatsNewCard } = await import("./WhatsNewCard"));
  ({ whatsNewItems } = await import("@/lib/whatsNew"));
  ({ OPEN_RUNWAY_EVENT } = await import("@/lib/runwayRequest"));
  ({ OPEN_YOUR_SORREL_EVENT } = await import("@/lib/yourSorrel"));
});

const roots: { unmount(): void }[] = [];
const containers: HTMLElement[] = [];
beforeEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  containers.splice(0).forEach((c) => c.remove());
});
after(() => dom.window.close());

async function mount(props: { items?: unknown; runwayAvailable?: boolean; dismiss?: () => Promise<void> } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  const dismiss = props.dismiss ?? (async () => {});
  await act(async () =>
    root.render(
      <WhatsNewCard items={props.items ?? whatsNewItems("2026-11-25")} runwayAvailable={props.runwayAvailable ?? true} dismiss={dismiss} />,
    ),
  );
  return container;
}
const li = (c: HTMLElement, id: string) => c.querySelector(`[data-whats-new="${id}"]`) as HTMLElement;
const showButton = (c: HTMLElement, label: string) =>
  [...c.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement;

test("six lines in order, the recap line plain text, the rest links in the pill style", async () => {
  const c = await mount();
  const items = [...c.querySelectorAll("li")];
  assert.deepEqual(items.map((i) => i.dataset.whatsNew), ["recap", "runway", "goals", "coming-up", "your-sorrel", "privacy"]);
  assert.equal(li(c, "recap").querySelector("a,button"), null, "nothing to open until the 1st");
  assert.match(li(c, "recap").textContent!, /December 1st/);
  assert.equal(li(c, "goals").querySelector("a")!.getAttribute("href"), "/goals");
  assert.equal(li(c, "privacy").querySelector("a")!.getAttribute("href"), "/privacy");
  assert.equal(li(c, "coming-up").querySelector("a")!.getAttribute("href"), "#dash-card-upcoming");
  for (const id of ["runway", "goals", "coming-up", "your-sorrel", "privacy"]) {
    assert.match(li(c, id).querySelector("a,button")!.className, /rounded-2xl/, id);
  }
});

test("the runway line asks the Safe to Spend card to open its runway", async () => {
  const c = await mount();
  let asked = 0;
  const onOpen = (e: Event) => {
    asked++;
    (e as CustomEvent).detail.handled = true;
  };
  window.addEventListener(OPEN_RUNWAY_EVENT, onOpen);
  await act(async () => (li(c, "runway").querySelector("button") as HTMLElement).click());
  window.removeEventListener(OPEN_RUNWAY_EVENT, onOpen);
  assert.equal(asked, 1);
});

test("no Safe to Spend card on the page: the runway line is plain text, not a dead button", async () => {
  const c = await mount({ runwayAvailable: false });
  assert.equal(li(c, "runway").querySelector("a,button"), null);
  assert.match(li(c, "runway").textContent!, /runway/);
});

test("the Your Sorrel line opens the Your Sorrel panel", async () => {
  const c = await mount();
  let asked = 0;
  const onOpen = () => asked++;
  window.addEventListener(OPEN_YOUR_SORREL_EVENT, onOpen);
  await act(async () => (li(c, "your-sorrel").querySelector("button") as HTMLElement).click());
  window.removeEventListener(OPEN_YOUR_SORREL_EVENT, onOpen);
  assert.equal(asked, 1);
});

test("phone: lines four to six are hidden below md until 'Show all 6' expands them in place", async () => {
  const c = await mount();
  const button = showButton(c, "Show all 6");
  assert.ok(button, "a real button");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.match(button.className, /md:hidden/, "not on desktop");
  for (const id of ["recap", "runway", "goals"]) assert.doesNotMatch(li(c, id).className, /hidden/, id);
  for (const id of ["coming-up", "your-sorrel", "privacy"]) {
    assert.match(li(c, id).className, /\bhidden\b.*md:list-item/, `${id} hidden on a phone, shown from md`);
  }
  await act(async () => button.click());
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(button.textContent, "Show fewer");
  for (const id of ["coming-up", "your-sorrel", "privacy"]) assert.doesNotMatch(li(c, id).className, /\bhidden\b/, id);
  assert.equal(button.getAttribute("aria-controls"), c.querySelector("ul")!.id);
});

test("the expand control is a native button, so Enter and Space work from the keyboard", async () => {
  const c = await mount();
  const button = showButton(c, "Show all 6");
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.getAttribute("tabindex"), null, "in the tab order by default");
  assert.equal(button.disabled, false);
});

test("with five lines (after the recap week) the button says Show all 5", async () => {
  const c = await mount({ items: whatsNewItems("2026-12-10") });
  assert.ok(showButton(c, "Show all 5"));
});

test("three lines or fewer: no expand button at all", async () => {
  const c = await mount({ items: whatsNewItems("2026-11-25").slice(0, 3) });
  assert.equal([...c.querySelectorAll("button")].some((b) => /Show/.test(b.textContent ?? "")), false);
});

test("Got it calls the Server Function once and hides the card at once under reduced motion", async () => {
  let calls = 0;
  const c = await mount({ dismiss: async () => void calls++ });
  await act(async () => showButton(c, "Got it").click());
  assert.equal(calls, 1);
  assert.equal(c.querySelector("section"), null);
});

test("neutral: no badge, no count, no status colour classes", async () => {
  const c = await mount();
  assert.doesNotMatch(c.innerHTML, /text-(red|amber|yellow|green)|bg-(red|amber|yellow|green)|badge/i);
});
