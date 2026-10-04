# Phase 7 findings

## Temporary code that must not ship

| Path | Purpose | Added | Status |
|---|---|---|---|
| `app/(app)/dev-projection/page.tsx` | Prints the signed-in user's safe-to-spend projection (income, obligations, daily balance, trough, cushion, result) to check it against real data. Dev-only (`notFound()` in production); reads through `getSafeToSpend()` under the user's session and RLS. | 2026-10-02 | Deleted 2026-10-04 (never committed) |

## "fiber.reset is not a function" in the dev overlay (2026-10-04)

Seen twice; the second time on setting the safe-to-spend cushion to 0.

**The message does not come from this app's React.** The string
`fiber.reset` / `reset is not a function` appears nowhere in `react`,
`react-dom` or `next` under `node_modules`, nor in app source. `npm ls react
react-dom` resolves a single react@19.2.8 / react-dom@19.2.8, all deduped, so
it isn't a duplicate-React mismatch either.

Source: a browser extension (confirmed by the incognito check below). One
that walks the page's fiber tree -- React DevTools is the prime suspect,
though which extension wasn't isolated. Extensions run inside the page, so their
exceptions surface in Next's dev overlay looking like React internals failing.

**Before debugging a React-internals error in the overlay:**

1. Grep `node_modules/react-dom`, `react`, `next` for the exact message. No
   hit means the code throwing it isn't ours.
2. Reproduce in an incognito window with extensions disabled.
3. Read the dev-server terminal, not the overlay -- the overlay can report
   an error thrown while reporting another.

**Isolation result:** `app/(app)/dashboard/SafeToSpendHero.test.tsx` renders
the hero with its breakdown open at cushion = 0 (with and without a dip below
zero) in jsdom -- no exception, no React warning.

**Incognito check (2026-10-04):** setting the cushion to 0 with extensions
disabled -- no error. Confirms the crash came from a browser extension, not
the app. Not an app bug; nothing to fix.

**Real bug the investigation found (fixed):** the breakdown's cushion line
and obligation rows rendered through the signed `<Amount type="Expense">`,
so the cushion read "−$0.00" (and "−$300.00" beside an unsigned "Cash on
hand"). The breakdown is label-and-value, unsigned throughout; both now use
`formatCurrency`, and the test asserts it.
