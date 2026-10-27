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
    atRule.walkDecls("animation-timing-function", (decl) => {
      assert.equal(norm(decl.value), token, `@keyframes ${atRule.params} eases with ${decl.value}`);
    });
  });
  assert.equal(flowerFrames, 14, "expected fold x5, unfold x5, bloom x3 and sway keyframes");
});
