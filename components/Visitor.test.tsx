import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";

// The visitor: arrives once per band per device, then perched; a tap sends it
// away for that band; reduced motion and blocked storage are perched only;
// no room, no visitor; it waits for the welcome and for any open dialog.

let dom: JSDOM;
let reducedMotion = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let React: any, act: any, createRoot: any, Visitor: any, setWelcomeActive: any;

before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "self", "document", "navigator", "HTMLElement", "Node", "Element", "MutationObserver"]) {
    Object.defineProperty(g, key, {
      value: key === "window" || key === "self" ? dom.window : (dom.window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
  }
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0) as unknown as number;
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  (dom.window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: reducedMotion && query.includes("reduce"),
    addEventListener() {},
    removeEventListener() {},
  });
  React = await import("react");
  act = React.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ Visitor } = await import("./Visitor"));
  ({ setWelcomeActive } = await import("@/lib/welcomeSignals"));
});

const roots: { unmount(): void }[] = [];
const containers: HTMLElement[] = [];
beforeEach(async () => {
  reducedMotion = false;
  dom.window.localStorage.clear();
  setWelcomeActive(false);
  document.querySelectorAll("dialog").forEach((d) => d.remove());
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  containers.splice(0).forEach((c) => c.remove());
});
after(async () => {
  await act(async () => roots.forEach((r) => r.unmount()));
  dom.window.close();
});

const TODAY = "2026-11-20";
const yes = () => true;
const no = () => false;

async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return container;
}
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
// The arrival waits a beat (400ms) after the welcome; give it room.
const settle = () => wait(520);
const visitor = (c: HTMLElement) => c.querySelector("[data-visitor]") as HTMLElement | null;
const store = () => dom.window.localStorage;

test("the server render has the empty slot and no drawing, hidden from assistive tech", () => {
  const html = renderToStaticMarkup(<Visitor band="morning" today={TODAY} />);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /<svg/);
  assert.doesNotMatch(html, /tabindex/i);
});

test("a first visit to a band arrives, once, and records it", async () => {
  const c = await mount(<Visitor band="morning" today={TODAY} startDelayMs={0} measure={yes} />);
  assert.equal(visitor(c), null, "nothing before its turn");
  await settle();
  const v = visitor(c)!;
  assert.equal(v.dataset.visitor, "songbird");
  assert.equal(v.dataset.stage, "arrive");
  assert.match(v.className, /visitor--arrive/);
  assert.equal(store().getItem("visitor-seen"), `${TODAY}:morning`);
});

test("a reload in the same band shows it perched, nothing arriving", async () => {
  store().setItem("visitor-seen", `${TODAY}:morning`);
  const c = await mount(<Visitor band="morning" today={TODAY} startDelayMs={0} measure={yes} />);
  await wait(30);
  const v = visitor(c)!;
  assert.equal(v.dataset.stage, "perched");
  assert.doesNotMatch(v.className, /visitor--arrive/);
});

test("all four visitors render and are not focusable", async () => {
  const want = { morning: "songbird", afternoon: "butterfly", evening: "firefly", night: "owl" } as const;
  for (const [band, kind] of Object.entries(want)) {
    store().clear();
    store().setItem("visitor-seen", `${TODAY}:${band}`);
    const c = await mount(<Visitor band={band} today={TODAY} startDelayMs={0} measure={yes} />);
    await wait(30);
    const v = visitor(c)!;
    assert.equal(v.dataset.visitor, kind);
    assert.equal(v.querySelectorAll("svg").length, 1);
    assert.equal(v.querySelector("svg")!.getAttribute("aria-hidden"), "true");
    assert.equal(v.getAttribute("tabindex"), null);
    assert.equal(c.querySelector("[data-visitor-slot]")!.getAttribute("aria-hidden"), "true");
  }
});

test("a tap sends it away: it flies off, then is gone and stays away for that band", async () => {
  store().setItem("visitor-seen", `${TODAY}:night`);
  const c = await mount(<Visitor band="night" today={TODAY} startDelayMs={0} measure={yes} />);
  await wait(30);
  await act(async () => visitor(c)!.click());
  assert.equal(store().getItem("visitor-away"), `${TODAY}:night`);
  assert.match(visitor(c)!.className, /visitor--away/);
  await wait(700);
  assert.equal(visitor(c), null);
  // The next load: still gone, for that band.
  const again = await mount(<Visitor band="night" today={TODAY} startDelayMs={0} measure={yes} />);
  await settle();
  assert.equal(visitor(again), null);
});

test("sent away for one band, the next band still brings its visitor", async () => {
  store().setItem("visitor-away", `${TODAY}:morning`);
  const c = await mount(<Visitor band="afternoon" today={TODAY} startDelayMs={0} measure={yes} />);
  await settle();
  assert.equal(visitor(c)!.dataset.visitor, "butterfly");
});

test("the Settings toggle off: no visitor", async () => {
  store().setItem("visitors-off", "1");
  const c = await mount(<Visitor band="morning" today={TODAY} startDelayMs={0} measure={yes} />);
  await settle();
  assert.equal(visitor(c), null);
  assert.equal(store().getItem("visitor-seen"), null);
});

test("reduced motion: perched, never an arrival; a tap removes it at once", async () => {
  reducedMotion = true;
  const c = await mount(<Visitor band="evening" today={TODAY} startDelayMs={0} measure={yes} />);
  await settle();
  const v = visitor(c)!;
  assert.equal(v.dataset.stage, "perched");
  assert.doesNotMatch(v.className, /visitor--arrive/);
  assert.equal(store().getItem("visitor-seen"), null, "nothing played, nothing recorded");
  await act(async () => v.click());
  assert.equal(visitor(c), null, "no flight, no waiting");
  assert.equal(store().getItem("visitor-away"), `${TODAY}:evening`);
});

test("storage unavailable: perched, no arrival, and a tap still removes it", async () => {
  const real = dom.window.localStorage;
  Object.defineProperty(dom.window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
  try {
    const c = await mount(<Visitor band="morning" today={TODAY} startDelayMs={0} measure={yes} />);
    await settle();
    const v = visitor(c)!;
    assert.equal(v.dataset.stage, "perched");
    assert.doesNotMatch(v.className, /visitor--arrive/);
    await act(async () => v.click());
    await wait(700);
    assert.equal(visitor(c), null);
  } finally {
    Object.defineProperty(dom.window, "localStorage", { configurable: true, value: real });
  }
});

test("no room: not rendered, and nothing recorded as seen", async () => {
  const c = await mount(<Visitor band="morning" today={TODAY} startDelayMs={0} measure={no} />);
  await settle();
  assert.equal(visitor(c), null);
  assert.equal(store().getItem("visitor-seen"), null);
});

test("it waits for the welcome bloom, then arrives", async () => {
  setWelcomeActive(true);
  const c = await mount(<Visitor band="morning" today={TODAY} startDelayMs={0} measure={yes} />);
  await settle();
  assert.equal(visitor(c), null, "the bloom is still playing");
  assert.equal(store().getItem("visitor-seen"), null);
  await act(async () => setWelcomeActive(false));
  await settle();
  assert.equal(visitor(c)!.dataset.stage, "arrive");
});

test("it waits for an open dialog to close, then arrives", async () => {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  document.body.appendChild(dialog);
  const c = await mount(<Visitor band="morning" today={TODAY} startDelayMs={0} measure={yes} />);
  await settle();
  assert.equal(visitor(c), null, "the dialog is open");
  await act(async () => dialog.removeAttribute("open"));
  await settle();
  assert.equal(visitor(c)!.dataset.stage, "arrive");
});

test("two fireflies get different gradient ids", async () => {
  store().setItem("visitor-seen", `${TODAY}:evening`);
  const c = await mount(
    <>
      <Visitor band="evening" today={TODAY} startDelayMs={0} measure={yes} />
      <Visitor band="evening" today={TODAY} startDelayMs={0} measure={yes} />
    </>,
  );
  await wait(30);
  const ids = [...c.querySelectorAll("radialGradient")].map((g) => g.id);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  for (const id of ids) assert.ok(c.querySelector(`circle[fill="url(#${id})"]`), `halo uses ${id}`);
});
