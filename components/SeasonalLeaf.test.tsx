import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";

// The seasonal leaf: still on first sight and on a plain load, plays once
// when the season changed since this device last looked, never when storage
// is unavailable or motion is reduced. Four seasons, four drawings, all
// hidden from assistive tech.

let dom: JSDOM;
let reducedMotion = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let React: any, act: any, createRoot: any, SeasonalLeaf: any, TimeOfDayGlow: any;

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
  ({ SeasonalLeaf } = await import("./SeasonalLeaf"));
  ({ TimeOfDayGlow } = await import("./TimeOfDayGlow"));
});

beforeEach(() => {
  reducedMotion = false;
  dom.window.localStorage.clear();
});

const roots: { unmount(): void }[] = [];
after(async () => {
  await act(async () => roots.forEach((r) => r.unmount()));
  dom.window.close();
});

async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return container;
}
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const playing = (c: HTMLElement) => c.querySelectorAll(".season-leaf--play").length;

test("the server render is still and hidden from assistive tech, whatever the season", () => {
  for (const season of ["spring", "summer", "autumn", "winter"] as const) {
    const html = renderToStaticMarkup(<SeasonalLeaf season={season} />);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, new RegExp(`season-leaf--${season}`));
    assert.doesNotMatch(html, /season-leaf--play/);
  }
});

test("first ever visit: remembers the season, plays nothing", async () => {
  const c = await mount(<SeasonalLeaf season="autumn" />);
  await tick();
  assert.equal(playing(c), 0);
  assert.equal(dom.window.localStorage.getItem("season-seen"), "autumn");
});

test("same season as last visit: still", async () => {
  dom.window.localStorage.setItem("season-seen", "autumn");
  const c = await mount(<SeasonalLeaf season="autumn" />);
  await tick();
  assert.equal(playing(c), 0);
});

test("season changed since last visit: plays once, and the next load is still", async () => {
  dom.window.localStorage.setItem("season-seen", "summer");
  const c = await mount(<SeasonalLeaf season="autumn" />);
  await tick();
  assert.equal(playing(c), 1);
  assert.equal(dom.window.localStorage.getItem("season-seen"), "autumn");
  const again = await mount(<SeasonalLeaf season="autumn" />);
  await tick();
  assert.equal(playing(again), 0);
});

test("reduced motion: never plays, still remembers", async () => {
  reducedMotion = true;
  dom.window.localStorage.setItem("season-seen", "summer");
  const c = await mount(<SeasonalLeaf season="autumn" />);
  await tick();
  assert.equal(playing(c), 0);
  assert.equal(dom.window.localStorage.getItem("season-seen"), "autumn");
});

test("storage unavailable: no animation", async () => {
  const real = dom.window.localStorage;
  Object.defineProperty(dom.window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
  try {
    const c = await mount(<SeasonalLeaf season="winter" />);
    await tick();
    assert.equal(playing(c), 0);
  } finally {
    Object.defineProperty(dom.window, "localStorage", { configurable: true, value: real });
  }
});

test("an unrecognised stored value is not a season change", async () => {
  dom.window.localStorage.setItem("season-seen", "monsoon");
  const c = await mount(<SeasonalLeaf season="autumn" />);
  await tick();
  assert.equal(playing(c), 0);
});

test("the glow names its band, is hidden from assistive tech, and carries no animation class", () => {
  for (const band of ["morning", "afternoon", "evening", "night"] as const) {
    const html = renderToStaticMarkup(<TimeOfDayGlow band={band} />);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, new RegExp(`tod-glow--${band}`));
    assert.doesNotMatch(html, /animate|pulse|drift/);
  }
});
