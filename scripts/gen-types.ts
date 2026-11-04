// npm run types:dev -- regenerate lib/database.types.ts from sorrel-dev.
//
// The only way to generate the types (CLAUDE.md "After any migration").
// Never `gen types ... > lib/database.types.ts`: Windows PowerShell 5.x's
// `>` writes UTF-16LE, git stores the file as binary, and `git diff` shows
// nothing -- which is how a regenerated file once sat uncommitted on the
// wrong branch looking like an opaque blob (2026-11-03).
//
// Targets sorrel-dev by REF, not the link, so it reads the same project
// whatever is linked. The CLI's Target line goes to the terminal (stderr is
// inherited): check it names tztbebdzlezlhvsbylsf. Writes UTF-8, no BOM,
// LF line endings, and only after the output looks like the types file --
// a failed run never truncates the committed one.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const DEV_REF = "tztbebdzlezlhvsbylsf";
const OUT = "lib/database.types.ts";

// One command string: npx needs a shell on Windows.
const run = spawnSync(
  `npx supabase gen types --remote=${DEV_REF} --lang typescript --schema public`,
  { encoding: "utf8", shell: true, stdio: ["inherit", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 },
);

if (run.status !== 0) {
  console.error(`gen types failed (exit ${run.status}); ${OUT} left unchanged.`);
  process.exit(run.status ?? 1);
}

const types = run.stdout.replace(/^﻿/, "").replace(/\r\n/g, "\n");
if (!types.startsWith("export type Json")) {
  console.error(`gen types printed something other than the types file; ${OUT} left unchanged.`);
  console.error(types.slice(0, 500));
  process.exit(1);
}

writeFileSync(OUT, types, { encoding: "utf8" });
console.log(`Wrote ${OUT} (UTF-8) from sorrel-dev (${DEV_REF}). Review with git diff before committing.`);
