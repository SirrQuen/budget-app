import { test } from "node:test";
import assert from "node:assert/strict";
import { ICON_SIZES, ICON_VARIANTS, iconNames, parseIconName } from "./appIcon";
import manifest from "@/app/manifest";

test("every served name parses, and nothing else does", () => {
  for (const name of iconNames()) assert.ok(parseIconName(name), name);
  assert.equal(iconNames().length, ICON_VARIANTS.length * ICON_SIZES.length);
  for (const bad of ["primary-512", "primary-64.png", "unknown-512.png", "../x.png", "primary-512.png.png", ""]) {
    assert.equal(parseIconName(bad), null, bad);
  }
});

test("the manifest points only at icons the route serves, at sizes 192 and 512", () => {
  const icons = manifest().icons ?? [];
  assert.ok(icons.length >= 3);
  const served = new Set(iconNames().map((n) => `/icons/${n}`));
  for (const icon of icons) assert.ok(served.has(icon.src), icon.src);
  assert.deepEqual(
    [...new Set(icons.map((i) => i.sizes))].sort(),
    ["192x192", "512x512"],
  );
  assert.ok(icons.some((i) => i.purpose === "maskable"));
});

test("the manifest starts on the dashboard in the app's own navy", () => {
  const m = manifest();
  assert.equal(m.start_url, "/dashboard");
  assert.equal(m.display, "standalone");
  assert.equal(m.background_color, "#131322");
});
