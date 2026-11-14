import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DASHBOARD_ORDER,
  moveAmong,
  reorderVisible,
  resolveDashboardLayout,
  setHidden,
  visibleSections,
  layoutsEqual,
  sizeOf,
  DASHBOARD_SECTIONS,
  DEFAULT_DASHBOARD_LAYOUT,
} from "./dashboardLayout";

test("nothing stored resolves to the default order, nothing hidden", () => {
  const l = resolveDashboardLayout(null, null);
  assert.deepEqual(l.order, [...DEFAULT_DASHBOARD_ORDER]);
  assert.deepEqual(l.hidden, []);
});

test("unknown names are ignored; sections the list lacks are appended in default order", () => {
  const l = resolveDashboardLayout(["goals", "retired-widget", "budgets", "goals"], ["nope", "accounts"]);
  assert.deepEqual(l.order.slice(0, 2), ["goals", "budgets"]);
  assert.equal(l.order.length, DEFAULT_DASHBOARD_ORDER.length);
  assert.equal(new Set(l.order).size, l.order.length);
  assert.deepEqual(l.hidden, ["accounts"]);
});

test("garbage resolves to the default instead of throwing", () => {
  assert.deepEqual(resolveDashboardLayout("x", 5).order, [...DEFAULT_DASHBOARD_ORDER]);
  assert.deepEqual(resolveDashboardLayout([1, {}], [null]).hidden, []);
});

test("the hero has no name: it can't be stored, moved or hidden", () => {
  const l = resolveDashboardLayout(["hero", "safe-to-spend"], ["hero"]);
  assert.ok(!l.order.includes("hero" as never));
  assert.deepEqual(l.hidden, []);
});

test("move up and down swap with the neighbour that's on screen and stop at the edges", () => {
  const order = [...DEFAULT_DASHBOARD_ORDER];
  const visible = ["to-confirm", "net-worth", "budgets"] as const;
  assert.deepEqual(moveAmong(order, visible, "to-confirm", 1).slice(0, 2), ["net-worth", "to-confirm"]);
  assert.deepEqual(moveAmong(order, visible, "to-confirm", -1), order);
  assert.deepEqual(moveAmong(order, visible, "budgets", 1), order);
});

test("a move steps over hidden or empty sections, which keep their place", () => {
  const order = [...DEFAULT_DASHBOARD_ORDER];
  // goals and upcoming aren't on screen: budgets' next visible neighbour is accounts.
  const visible = ["budgets", "accounts"] as const;
  const next = moveAmong(order, visible, "budgets", 1);
  assert.equal(next.indexOf("goals"), order.indexOf("goals"));
  assert.equal(next.indexOf("upcoming"), order.indexOf("upcoming"));
  assert.ok(next.indexOf("accounts") < next.indexOf("budgets"));
});

test("reorderVisible only rearranges the sequence it's given", () => {
  const order = [...DEFAULT_DASHBOARD_ORDER];
  const next = reorderVisible(order, ["accounts", "to-confirm"]);
  assert.equal(next[0], "accounts");
  assert.equal(next[order.indexOf("accounts")], "to-confirm");
  assert.equal(next.length, order.length);
  // not a permutation of anything: unchanged
  assert.deepEqual(reorderVisible(order, ["accounts", "accounts"]), order);
  assert.deepEqual(reorderVisible(order, ["retired" as never]), order);
});

test("a section is never moved into the other region", () => {
  const order = [...DEFAULT_DASHBOARD_ORDER];
  const visible = ["income", "cash-flow"] as const;
  assert.deepEqual(moveAmong(order, visible, "income", -1), order);
});

test("hiding removes a section from what renders, and keeps its place", () => {
  const hidden = setHidden([], "upcoming", true);
  const layout = { ...DEFAULT_DASHBOARD_LAYOUT, hidden };
  assert.ok(!visibleSections(layout, "right-now").includes("upcoming"));
  assert.ok(layout.order.includes("upcoming"));
  assert.deepEqual(setHidden(hidden, "upcoming", false), []);
});

test("layoutsEqual ignores hidden order", () => {
  const a = { ...DEFAULT_DASHBOARD_LAYOUT, hidden: ["goals", "budgets"] as const };
  const b = { ...DEFAULT_DASHBOARD_LAYOUT, hidden: ["budgets", "goals"] as const };
  assert.ok(layoutsEqual({ ...a, hidden: [...a.hidden] }, { ...b, hidden: [...b.hidden] }));
});

test("every section has a fixed size, and a lone number is a small tile", () => {
  for (const section of DASHBOARD_SECTIONS) {
    assert.ok(["small", "wide", "full"].includes(sizeOf(section.id)), section.id);
  }
  assert.equal(sizeOf("net-worth"), "small");
});

test("the stored shape is names only: saved layouts from before sizes still resolve", () => {
  const l = resolveDashboardLayout(["goals", "net-worth", "to-confirm"], ["accounts"]);
  assert.deepEqual(l.order.slice(0, 3), ["goals", "net-worth", "to-confirm"]);
  assert.deepEqual(l.hidden, ["accounts"]);
});

test("a saved layout naming the old combined section ignores it and appends the new ones", () => {
  const l = resolveDashboardLayout(["goals", "income-spending", "budgets"], ["income-spending"]);
  assert.deepEqual(l.order.slice(0, 2), ["goals", "budgets"]);
  assert.ok(l.order.includes("income") && l.order.includes("spending"));
  assert.ok(!l.order.includes("income-spending" as never));
  assert.deepEqual(l.hidden, []);
});

test("default order: Budgets and Goals are adjacent, so they share a row", () => {
  const i = DEFAULT_DASHBOARD_ORDER.indexOf("budgets");
  assert.equal(DEFAULT_DASHBOARD_ORDER[i + 1], "goals");
});

test("income and spending are two small tiles", () => {
  assert.equal(sizeOf("income"), "small");
  assert.equal(sizeOf("spending"), "small");
});
