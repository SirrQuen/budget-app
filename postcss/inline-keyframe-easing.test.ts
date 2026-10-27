import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import inlineKeyframeEasing from "./inline-keyframe-easing.cjs";

const run = (css: string) => postcss([inlineKeyframeEasing()]).process(css, { from: undefined }).css;

test("inlines a :root easing token inside @keyframes", () => {
  const out = run(`
    :root { --ease: cubic-bezier(0.34, 0.02, 0.24, 1); }
    @keyframes k { 0% { opacity: 0; animation-timing-function: var(--ease); } }
  `);
  assert.match(out, /animation-timing-function: cubic-bezier\(0\.34, 0\.02, 0\.24, 1\)/);
  assert.doesNotMatch(out, /animation-timing-function: var\(/);
});

test("leaves var() alone outside @keyframes, where Chrome resolves it", () => {
  const out = run(`
    :root { --ease: ease-out; }
    .a { animation: k 1s var(--ease); animation-timing-function: var(--ease); }
  `);
  assert.match(out, /animation: k 1s var\(--ease\)/);
  assert.match(out, /\.a \{[^}]*animation-timing-function: var\(--ease\)/);
});

test("fails the build on a keyframe easing it can't resolve", () => {
  assert.throws(
    () => run(`@keyframes k { 0% { animation-timing-function: var(--missing); } }`),
    /--missing is used in @keyframes k but isn't declared on :root/,
  );
});

// The real stylesheet: every var() easing in a keyframe resolves, so none
// ships to the browser as a silently-linear interval.
test("app/globals.css: no unresolved var() easing survives inside @keyframes", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const out = postcss([inlineKeyframeEasing()]).process(css, { from: undefined });
  out.root.walkAtRules("keyframes", (atRule) => {
    atRule.walkDecls("animation-timing-function", (decl) => {
      assert.doesNotMatch(decl.value, /var\(/, `@keyframes ${atRule.params} still has ${decl.value}`);
    });
  });
});

// One motion signature. The flower's fold, bloom and sway are slower than
// the nav verbs, not different: every interval eases with --icon-anim-ease.
test("app/globals.css: the flower's fold, bloom and sway use --icon-anim-ease", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const out = postcss([inlineKeyframeEasing()]).process(css, { from: undefined });
  const norm = (v: string) => v.replace(/\s+/g, "");
  let token = "";
  out.root.walkRules(":root", (rule) => {
    rule.walkDecls("--icon-anim-ease", (decl) => {
      token = norm(decl.value);
    });
  });
  assert.ok(token, "--icon-anim-ease not found");

  let flowerFrames = 0;
  out.root.walkAtRules("keyframes", (atRule) => {
    if (!atRule.params.startsWith("sorrel-flower-")) return;
    flowerFrames++;
    // The gate sway starts mid-interval, so its outer intervals are the
    // token's curve split in two -- checked in the next test.
    if (atRule.params === "sorrel-flower-gate-sway") return;
    atRule.walkDecls("animation-timing-function", (decl) => {
      assert.equal(norm(decl.value), token, `@keyframes ${atRule.params} eases with ${decl.value}`);
    });
  });
  assert.equal(flowerFrames, 15, "expected fold x5, unfold x5, bloom x3, sway and gate-sway keyframes");
});

// The daily gate's sway is the standard sway phase-shifted to start at the
// zero crossing. Its middle interval is the token itself; the first and last
// are the token's curve split where it reaches 0.5 (de Casteljau), each half
// normalised to [0,1] -- the same curve, not a lookalike.
test("app/globals.css: the gate sway's split intervals are exactly the token's halves", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const out = postcss([inlineKeyframeEasing()]).process(css, { from: undefined });
  const numbers = (v: string) => v.match(/-?[\d.]+/g)!.map(Number);
  let token: number[] = [];
  out.root.walkRules(":root", (rule) => {
    rule.walkDecls("--icon-anim-ease", (decl) => {
      token = numbers(decl.value);
    });
  });
  const [x1, y1, x2, y2] = token;
  type P = [number, number];
  const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const P0: P = [0, 0];
  const P1: P = [x1, y1];
  const P2: P = [x2, y2];
  const P3: P = [1, 1];
  const split = (s: number) => {
    const a = lerp(P0, P1, s);
    const b = lerp(P1, P2, s);
    const c = lerp(P2, P3, s);
    const d = lerp(a, b, s);
    const e = lerp(b, c, s);
    return { a, c, d, e, p: lerp(d, e, s) };
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (split(m).p[1] < 0.5) lo = m;
    else hi = m;
  }
  const { a, c, d, e, p } = split(lo);
  const first = [a[0] / p[0], a[1] / p[1], d[0] / p[0], d[1] / p[1]];
  const second = [
    (e[0] - p[0]) / (1 - p[0]),
    (e[1] - p[1]) / (1 - p[1]),
    (c[0] - p[0]) / (1 - p[0]),
    (c[1] - p[1]) / (1 - p[1]),
  ];

  const easings: number[][] = [];
  const offsets: string[] = [];
  out.root.walkAtRules("keyframes", (atRule) => {
    if (atRule.params !== "sorrel-flower-gate-sway") return;
    atRule.walkRules((rule) => {
      offsets.push(rule.selector);
      rule.walkDecls("animation-timing-function", (decl) => {
        easings.push(numbers(decl.value));
      });
    });
  });
  const close = (got: number[], want: number[], what: string) =>
    got.forEach((v, i) =>
      assert.ok(Math.abs(v - want[i]) < 1e-3, `${what}: ${got} vs ${want.map((n) => n.toFixed(4))}`),
    );
  assert.equal(easings.length, 3);
  close(easings[0], second, "0 -> +2.5 (the curve after the crossing)");
  close(easings[1], token, "+2.5 -> -2.5 (the token)");
  close(easings[2], first, "-2.5 -> 0 (the curve before the crossing)");

  const crossingMs = p[0] * 1600;
  const pct = (ms: number) => (((ms - crossingMs) / 3200) * 100).toFixed(3);
  assert.deepEqual(offsets, ["0%", `${pct(1600)}%`, `${pct(3200)}%`, "100%"]);
});
