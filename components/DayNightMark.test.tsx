import { test, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";

// The roselle host: plays its change once per device, waits for the welcome,
// holds the visitor back while it plays, and rests under reduced motion or
// when storage can't be used.

let dom: JSDOM;
let reducedMotion = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let React: any, act: any, createRoot: any, DayNightMark: any, setWelcomeActive: any, isPlantBusy: any;

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
  ({ DayNightMark } = await import("./DayNightMark"));
  ({ setWelcomeActive } = await import("@/lib/welcomeSignals"));
  ({ isPlantBusy } = await import("@/lib/plantSignals"));
});

const roots: { unmount(): void }[] = [];
const containers: HTMLElement[] = [];
const store = () => dom.window.localStorage;

beforeEach(async () => {
  reducedMotion = false;
  mock.timers.reset();
  store().clear();
  setWelcomeActive(false);
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  containers.splice(0).forEach((c) => c.remove());
});
after(async () => {
  await act(async () => roots.forEach((r) => r.unmount()));
  dom.window.close();
});

/** Pin only the Date: the timers stay real, so the plant's own timeouts run. */
function atUTC(iso: string) {
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
}

async function mount(initialState: "open" | "folded") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<DayNightMark timeZone="UTC" initialState={initialState} />));
  return container;
}
const unmountAll = () => act(async () => roots.splice(0).forEach((r) => r.unmount()));
const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const classes = (c: HTMLElement) => c.querySelector("svg.roselle")?.getAttribute("class") ?? "";

test("the server render is the pose for its hour, hidden from assistive tech, calyces and all", () => {
  const html = renderToStaticMarkup(<DayNightMark timeZone="UTC" initialState="folded" />);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /roselle--closed/);
  assert.doesNotMatch(html, /roselle--closing|roselle--opening/);
  assert.doesNotMatch(html, /tabindex/i);
  assert.equal(html.match(/data-calyx/g)?.length, 4, "both stem calyces are always drawn, in both palette layers");
  assert.match(html, /opacity:0/, "no server-rendered pose is visible before the client decides");
});

test("the first visit after a change plays the opening once, then writes what it saw", async () => {
  atUTC("2026-11-22T12:00:00Z");
  const c = await mount("open");
  await wait(260);
  assert.match(classes(c), /roselle--open/);
  assert.match(classes(c), /roselle--opening/);
  assert.equal(store().getItem("sorrel-plant-seen"), "2026-11-22:open");
  assert.equal(isPlantBusy(), true, "the visitor is held while it plays");
  await wait(1700);
  assert.equal(isPlantBusy(), false, "and released when it's done");
});

test("the next visit with the same stamp rests", async () => {
  atUTC("2026-11-22T15:00:00Z");
  store().setItem("sorrel-plant-seen", "2026-11-22:open");
  const c = await mount("open");
  await wait(260);
  assert.match(classes(c), /roselle--open/);
  assert.doesNotMatch(classes(c), /roselle--opening|roselle--closing/);
  assert.equal(isPlantBusy(), false);
});

test("at 19:00 it closes once; the small hours of that night don't close it again", async () => {
  atUTC("2026-11-22T19:00:00Z");
  const c = await mount("folded");
  await wait(260);
  assert.match(classes(c), /roselle--closing/);
  assert.equal(store().getItem("sorrel-plant-seen"), "2026-11-22:closed");
  await wait(1700);

  await unmountAll();
  atUTC("2026-11-23T03:30:00Z");
  const again = await mount("folded");
  await wait(260);
  assert.match(classes(again), /roselle--closed/);
  assert.doesNotMatch(classes(again), /roselle--closing/);
});

test("6:59 is still the night's close, 7:00 opens", async () => {
  atUTC("2026-11-22T06:59:00Z");
  const night = await mount("folded");
  await wait(260);
  assert.match(classes(night), /roselle--closing/);
  assert.equal(store().getItem("sorrel-plant-seen"), "2026-11-21:closed");
  await wait(1700);

  await unmountAll();
  atUTC("2026-11-22T07:00:00Z");
  const day = await mount("open");
  await wait(260);
  assert.match(classes(day), /roselle--opening/);
  assert.equal(store().getItem("sorrel-plant-seen"), "2026-11-22:open");
  await wait(1700);
});

test("until it plays it's held in the pose it is changing from, and it plays after the welcome", async () => {
  atUTC("2026-11-22T12:00:00Z");
  setWelcomeActive(true);
  const c = await mount("open");
  await wait(260);
  assert.match(classes(c), /roselle--closed/, "held closed while the welcome bloom plays");
  assert.doesNotMatch(classes(c), /roselle--opening/);
  assert.equal(store().getItem("sorrel-plant-seen"), null, "nothing is recorded until it plays");
  assert.equal(isPlantBusy(), true, "the visitor already waits");

  await act(async () => setWelcomeActive(false));
  await wait(260);
  assert.match(classes(c), /roselle--open/);
  assert.match(classes(c), /roselle--opening/);
  assert.equal(store().getItem("sorrel-plant-seen"), "2026-11-22:open");
  await wait(1700);
});

test("reduced motion: at rest in the pose for the hour, nothing written, nothing held", async () => {
  reducedMotion = true;
  atUTC("2026-11-22T12:00:00Z");
  const c = await mount("open");
  await wait(260);
  assert.match(classes(c), /roselle--open/);
  assert.doesNotMatch(classes(c), /roselle--opening|roselle--closing/);
  assert.equal(store().getItem("sorrel-plant-seen"), null);
  assert.equal(isPlantBusy(), false);
});

test("storage unavailable (reads throw): at rest, no animation, no exception", async () => {
  atUTC("2026-11-22T12:00:00Z");
  const original = Object.getOwnPropertyDescriptor(dom.window, "localStorage");
  Object.defineProperty(dom.window, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError");
    },
  });
  try {
    const c = await mount("open");
    await wait(260);
    assert.match(classes(c), /roselle--open/);
    assert.doesNotMatch(classes(c), /roselle--opening|roselle--closing/);
    assert.equal(isPlantBusy(), false);
  } finally {
    if (original) Object.defineProperty(dom.window, "localStorage", original);
  }
});

test("storage that reads but won't write: at rest too, since it can't remember a play", async () => {
  atUTC("2026-11-22T12:00:00Z");
  const proto = Object.getPrototypeOf(store()) as Storage;
  const original = proto.setItem;
  proto.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  try {
    const c = await mount("open");
    await wait(400);
    assert.match(classes(c), /roselle--open/);
    assert.doesNotMatch(classes(c), /roselle--opening/);
    assert.equal(isPlantBusy(), false);
  } finally {
    proto.setItem = original;
  }
});

const slotOpacity = (c: HTMLElement) => (c.querySelector(".roselle-slot") as HTMLElement).style.opacity;

test("hidden until the client has decided, then revealed already in its starting pose", async () => {
  atUTC("2026-11-22T12:00:00Z");
  setWelcomeActive(true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  // Rendered, but the frame that decides hasn't run: still hidden.
  const realRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (() => 0) as unknown as typeof requestAnimationFrame;
  await act(async () => root.render(<DayNightMark timeZone="UTC" initialState="open" />));
  assert.equal(slotOpacity(container), "0");
  globalThis.requestAnimationFrame = realRaf;
  await act(async () => root.render(<DayNightMark timeZone="UTC" initialState="open" key="again" />));
  await wait(30);
  assert.equal(slotOpacity(container), "1");
  assert.match(classes(container), /roselle--closed/, "revealed in the pose it opens from");
  assert.doesNotMatch(classes(container), /roselle--opening/);
});

test("if the decision never comes, the resting pose shows after 2s -- and the visitor isn't held", async () => {
  atUTC("2026-11-22T12:00:00Z");
  const realRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (() => 0) as unknown as typeof requestAnimationFrame;
  try {
    const c = await mount("open");
    await wait(100);
    assert.equal(slotOpacity(c), "0");
    await wait(2000);
    assert.equal(slotOpacity(c), "1");
    assert.match(classes(c), /roselle--open/);
    assert.doesNotMatch(classes(c), /roselle--opening|roselle--closing/);
    assert.equal(isPlantBusy(), false);
  } finally {
    globalThis.requestAnimationFrame = realRaf;
  }
});

test("reduced motion reveals at rest straight away", async () => {
  reducedMotion = true;
  atUTC("2026-11-22T12:00:00Z");
  const c = await mount("open");
  await wait(30);
  assert.equal(slotOpacity(c), "1");
});
