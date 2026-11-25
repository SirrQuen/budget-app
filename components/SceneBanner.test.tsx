import { test, before, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { SCENE_PALETTES, sampleStops, sceneCss, skyOffsets } from "@/lib/scenes";
import { greetingPhrase, msUntilNextBandBoundary, timeBandAt, type TimeBand } from "@/lib/timeOfDay";

// The dashboard's scene (docs/Scenes.md): one clock with the greeting, only the
// current band drawn, one cross-fade when the band changes with the page open,
// on one timer that is cleared on unmount.

let dom: JSDOM;
let reducedMotion = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let React: any, act: any, createRoot: any, SceneBanner: any;

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
  (dom.window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: reducedMotion && query.includes("reduce"),
    addEventListener() {},
    removeEventListener() {},
  });
  React = await import("react");
  act = React.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ SceneBanner } = await import("./SceneBanner"));
});

const roots: { unmount(): void }[] = [];
const containers: HTMLElement[] = [];
const unmountAll = () => act(async () => roots.splice(0).forEach((r) => r.unmount()));
beforeEach(() => {
  reducedMotion = false;
});
afterEach(async () => {
  await unmountAll();
  containers.splice(0).forEach((c) => c.remove());
  mock.timers.reset();
});
after(() => dom.window.close());

const NY = "America/New_York";
const AUCKLAND = "Pacific/Auckland";
// 2026-11-25: New York is UTC-5, Auckland UTC+13 (daylight time).
const nyAt = (h: number, m: number) => new Date(Date.UTC(2026, 10, 25, h + 5, m));
const aucklandAt = (h: number, m: number) => new Date(Date.UTC(2026, 10, 25, h - 13, m));

const BOUNDARIES: [number, number, TimeBand][] = [
  [4, 59, "night"],
  [5, 0, "morning"],
  [11, 59, "morning"],
  [12, 0, "afternoon"],
  [16, 59, "afternoon"],
  [17, 0, "evening"],
  [21, 59, "evening"],
  [22, 0, "night"],
];

const GREETINGS: Record<TimeBand, string> = {
  morning: greetingPhrase("morning"),
  afternoon: greetingPhrase("afternoon"),
  evening: greetingPhrase("evening"),
  night: greetingPhrase("night"),
};

const banner = (zone: string, band: TimeBand) => (
  <SceneBanner timeZone={zone} initialBand={band} greetings={GREETINGS} today="2026-11-25" />
);

for (const [name, zone, at] of [
  ["New York", NY, nyAt],
  ["Auckland", AUCKLAND, aucklandAt],
] as const) {
  test(`the greeting and the scene agree at every boundary in ${name}`, () => {
    for (const [h, m, band] of BOUNDARIES) {
      const label = `${name} ${h}:${String(m).padStart(2, "0")}`;
      assert.equal(timeBandAt(zone, at(h, m)), band, label);
      const html = renderToStaticMarkup(banner(zone, timeBandAt(zone, at(h, m))));
      assert.deepEqual([...html.matchAll(/data-scene="(\w+)"/g)].map((x) => x[1]), [band], label);
      assert.ok(html.includes(greetingPhrase(band)), label);
    }
  });
}

test("the next band boundary, in the stored zone", () => {
  const m = 60_000;
  for (const [zone, at] of [
    [NY, nyAt],
    [AUCKLAND, aucklandAt],
  ] as const) {
    for (const h of [5, 12, 17, 22]) assert.equal(msUntilNextBandBoundary(zone, at(h - 1, 59)), m, `${zone} ${h}`);
    assert.equal(msUntilNextBandBoundary(zone, at(5, 0)), 7 * 60 * m);
    assert.equal(msUntilNextBandBoundary(zone, at(22, 0)), 7 * 60 * m);
  }
});

test("the server render: this band only, decorative, no text in the drawing, no fade", () => {
  const html = renderToStaticMarkup(banner(NY, "morning"));
  assert.match(html, /aria-hidden="true" class="dash-backdrop"/);
  assert.match(html, /preserveAspectRatio="xMaxYMax slice"/);
  // One drawing; the softened copy (docs/Backdrop.md) is a <use> of its art,
  // not a second drawing.
  assert.equal(html.match(/<svg/g)?.length, 2);
  assert.equal(html.match(/<path/g)?.length, new Set(html.match(/<path[^>]*>/g)).size);
  const art = html.match(/<g id="(scene-art-[^"]+)"/)?.[1];
  assert.ok(art);
  assert.match(html, new RegExp(`<use href="#${art}"`));
  assert.doesNotMatch(html, /<text|tabindex="0"|dash-scene__layer--in/i);
  assert.match(html, /Wednesday 25 November/);
  assert.match(html, /<h1 id="page-title"/);
});

test("each band's drawing stays small, and all four are under 25KB together", () => {
  const sizes = (["morning", "afternoon", "evening", "night"] as const).map(
    (band) => renderToStaticMarkup(banner(NY, band)).length,
  );
  assert.ok(sizes.reduce((a, b) => a + b, 0) < 25_000, sizes.join(", "));
});

/** Real elements, mocked clock and timeouts; every pending timeout is tracked. */
async function mountAt(instant: Date) {
  mock.timers.enable({ apis: ["Date", "setTimeout"], now: instant });
  const pending = new Map<unknown, number>();
  const fired: number[] = [];
  const mockedSet = globalThis.setTimeout;
  const mockedClear = globalThis.clearTimeout;
  globalThis.setTimeout = ((fn: () => void, ms = 0) => {
    const handle: unknown = mockedSet(() => {
      pending.delete(handle);
      fired.push(ms);
      fn();
    }, ms);
    pending.set(handle, ms);
    return handle;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    pending.delete(handle);
    mockedClear(handle);
  }) as typeof clearTimeout;
  const g = globalThis as Record<string, unknown>;
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = () => {};

  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(banner(NY, timeBandAt(NY, instant))));
  return {
    container,
    /** The component's own timers: the boundary's and the fade's. */
    ours: () => [...pending.values()].filter((ms) => ms >= 600),
    fired,
    scenes: () => [...container.querySelectorAll<HTMLElement>("[data-scene]")].map((e) => e.dataset.scene),
    greeting: () => container.querySelector("[data-banner-greeting]")!.textContent,
    // The scene layers; each one's softened copy fades with it.
    fading: () => container.querySelectorAll("[data-scene].dash-scene__layer--in").length,
    tick: (ms: number) => act(async () => mock.timers.tick(ms)),
  };
}

test("one timer to the boundary: it fires once, fades once, and the words change with it", async () => {
  const b = await mountAt(nyAt(11, 59));
  assert.deepEqual(b.scenes(), ["morning"]);
  assert.equal(b.fading(), 0, "on load nothing animates");
  assert.deepEqual(b.ours(), [60_000]);

  await b.tick(59_999);
  assert.deepEqual(b.scenes(), ["morning"]);
  await b.tick(1);
  assert.deepEqual(b.scenes(), ["morning", "afternoon"], "the outgoing scene under the new one");
  assert.equal(b.fading(), 1);
  assert.equal(b.greeting(), "Good afternoon");

  await b.tick(600);
  assert.deepEqual(b.scenes(), ["afternoon"]);
  assert.equal(b.fading(), 0);
  assert.equal(b.fired.filter((ms) => ms === 60_000).length, 1);
  // One timer again, to 17:00.
  assert.deepEqual(b.ours(), [5 * 3600_000]);
});

test("the timer is cleared on unmount, mid-wait and mid-fade", async () => {
  const waiting = await mountAt(nyAt(11, 59));
  assert.equal(waiting.ours().length, 1);
  await unmountAll();
  assert.deepEqual(waiting.ours(), []);

  mock.timers.reset();
  const fading = await mountAt(nyAt(11, 59));
  await fading.tick(60_000);
  assert.equal(fading.ours().length, 2, "the next boundary and the fade's end");
  await unmountAll();
  assert.deepEqual(fading.ours(), []);
});

test("reduced motion: the new scene replaces the old at once", async () => {
  reducedMotion = true;
  const b = await mountAt(nyAt(16, 59));
  await b.tick(60_000);
  assert.deepEqual(b.scenes(), ["evening"]);
  assert.equal(b.fading(), 0);
});

test("nothing is stored", async () => {
  dom.window.localStorage.clear();
  const b = await mountAt(nyAt(21, 59));
  await b.tick(60_000);
  await b.tick(600);
  assert.equal(dom.window.localStorage.length, 0);
  assert.equal(dom.window.document.cookie, "");
});

test("both themes' colours are written for the layer, the dark under the theme tokens' selectors", () => {
  for (const band of ["morning", "afternoon", "evening", "night"] as const) {
    const css = sceneCss(band);
    assert.ok(css.startsWith(`.scene--${band}{--scene-sky-1:${SCENE_PALETTES[band].light.sky[0][1]}`), css.slice(0, 60));
    assert.match(css, /prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)/);
    assert.match(css, /:root\[data-theme="dark"\]/);
  }
});

test("merging the two themes' sky stops leaves each sky as the board draws it", () => {
  assert.deepEqual(skyOffsets("morning"), [0, 55, 60, 100]);
  const { light, dark } = SCENE_PALETTES.morning;
  for (const sky of [light.sky, dark.sky]) {
    for (const [offset, colour] of sky) assert.equal(sampleStops(sky, offset), colour);
  }
  // Halfway between two stops is halfway between their colours.
  assert.equal(sampleStops([[0, "#000000"], [100, "#FF8040"]], 50), "#804020");
});
