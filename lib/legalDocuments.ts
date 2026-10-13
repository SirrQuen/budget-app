import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLegalMarkdown } from "@/lib/legal";

// Read once at module scope: the /privacy and /terms pages have no dynamic
// input, so they prerender at build time and this runs during the build,
// never per request. A malformed file fails the build (see lib/legal.ts).
export const LEGAL_DOCUMENTS = parseLegalMarkdown(
  readFileSync(join(process.cwd(), "docs/legal/privacy-and-terms.md"), "utf8"),
);
