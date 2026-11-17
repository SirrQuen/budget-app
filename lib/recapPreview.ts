// Development only: see the month recap on any day, for a chosen month.
//
//   http://localhost:3000/dashboard?__sorrelRecapPreview=2026-10
//
// Inert anywhere else, twice over:
//   1. The dashboard imports this module only inside a
//      `process.env.NODE_ENV === "development"` branch, as a dynamic
//      import. `next build` inlines NODE_ENV, drops the branch, and never
//      bundles this file -- `npm run check:recap-preview` proves the
//      parameter's name appears nowhere in .next/ after a build.
//   2. Even if it were bundled, it answers null unless nodeEnv is
//      "development" (lib/recapPreview.test.ts).
//
// The preview skips the first-7-days window and the dismissal cookie, never
// the RECAP_MIN_LOGS gate: it shows exactly what that month would show.

export const RECAP_PREVIEW_PARAM = "__sorrelRecapPreview";

/** The previewed month's first day ("2026-10-01"), or null. */
export function recapPreviewMonth(
  params: Record<string, string | string[] | undefined>,
  nodeEnv: string | undefined,
): string | null {
  if (nodeEnv !== "development") return null;
  const raw = params[RECAP_PREVIEW_PARAM];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return `${value}-01`;
}
