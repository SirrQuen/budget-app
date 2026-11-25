import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN_SOFTEN_DISTANCE, backdropGeometry } from "@/lib/backdrop";
import { SCENE_PALETTES, sceneCss } from "@/lib/scenes";

test("the scene goes at the slot's document position, whatever the scroll when read", () => {
  // Measured at 390px on dev: slot 233px down, 140px tall, first card at 441.
  const atTop = backdropGeometry({ stageTop: 233, stageHeight: 140, firstCardTop: 441, scrollY: 0 });
  assert.deepEqual(atTop, { sceneTop: 233, sceneHeight: 140, softenDistance: 208 });
  // The same page read 500px down: the rects have moved, the answer hasn't.
  const scrolled = backdropGeometry({ stageTop: -267, stageHeight: 140, firstCardTop: -59, scrollY: 500 });
  assert.deepEqual(scrolled, atTop);
});

test("softening runs until the first card reaches the top of the scene", () => {
  const g = backdropGeometry({ stageTop: 159, stageHeight: 300, firstCardTop: 527, scrollY: 0 });
  assert.equal(g.softenDistance, 368);
});

test("no card below the banner: softening runs over the scene's own height", () => {
  const g = backdropGeometry({ stageTop: 159, stageHeight: 300, firstCardTop: null, scrollY: 0 });
  assert.equal(g.softenDistance, 300);
});

test("a softening distance is never a flicker", () => {
  const g = backdropGeometry({ stageTop: 100, stageHeight: 40, firstCardTop: 120, scrollY: 0 });
  assert.equal(g.softenDistance, MIN_SOFTEN_DISTANCE);
});

test("the ground starts on the near hill's own colour, in every scene and theme", () => {
  for (const [band, themes] of Object.entries(SCENE_PALETTES)) {
    for (const [theme, p] of Object.entries(themes)) {
      assert.equal(p.ground[0], p.nearHill, `${band} ${theme}`);
    }
  }
});

test("the ground and meadow are written for both themes", () => {
  const css = sceneCss("evening");
  assert.match(css, /\.scene--evening\{[^}]*--scene-ground-1:#B49CBD;--scene-ground-2:#CBB8D2;--scene-ground-3:#E6DCE9;--scene-meadow:rgb\(255 255 255 \/ 0\.28\)/);
  assert.match(css, /:root\[data-theme="dark"\] \.scene--evening\{[^}]*--scene-ground-1:#22152C;--scene-ground-2:#181020;--scene-ground-3:#0F0A15;--scene-meadow:rgb\(255 255 255 \/ 0\.05\)/);
});
