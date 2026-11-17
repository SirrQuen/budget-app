// After `next build`: the month recap's development preview parameter must
// appear NOWHERE in the build output. lib/recapPreview.ts is imported only
// inside a NODE_ENV === "development" branch, which the production build
// drops -- this proves it did, over every file the build wrote, server and
// client, source maps included.
//
//   npm run check:recap-preview     (builds, then scans)
//
// .next/dev is skipped: since Next 16 it is `next dev`'s own output,
// separate from the build's, and a running dev server legitimately holds
// the preview there. Everything else under .next/ is scanned.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { RECAP_PREVIEW_PARAM } from "../lib/recapPreview";

const root = join(process.cwd(), ".next");
const needle = Buffer.from(RECAP_PREVIEW_PARAM, "utf8");

if (!existsSync(join(root, "BUILD_ID"))) {
  console.error("No production build in .next/ (no BUILD_ID). Run `next build` first.");
  process.exit(1);
}

const hits: string[] = [];
let scanned = 0;

function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (dir === root && name === "dev") continue;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
    } else if (stat.isFile()) {
      scanned += 1;
      if (readFileSync(path).includes(needle)) hits.push(relative(process.cwd(), path));
    }
  }
}

walk(root);

if (hits.length > 0) {
  console.error(`The recap preview parameter appears in ${hits.length} build file(s):`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`Recap preview parameter absent from the build: ${scanned} files scanned under .next/ (dev output excluded).`);
