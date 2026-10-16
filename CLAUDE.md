# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Stack

Multi-user personal finance / budgeting app. Next.js 16 (App Router), TypeScript,
Tailwind v4, Supabase (Postgres + Auth). The data layer lives in `lib/db/`;
the schema lives in `supabase/migrations/`. Path alias `@/*` -> project root.

## Commands

`npm run dev|build|start|lint|test`. `npm test` runs `node --test` (via `tsx`)
over `lib/**/*.test.ts`, `app/**/*.test.tsx`, `components/**/*.test.tsx` and
`postcss/**/*.test.ts`.
These tests are pure: no database connection.

## Environments — read before any database or deploy command

Projects are identified by REF, not by name. Names can be changed in the
dashboard; refs cannot. Always report the ref.

| | Name | Ref | Used by |
|---|---|---|---|
| Production | `sorrel-prod` | `ybdwqyihvbokowocvlgq` | mysorrel.com. Real user data. |
| Development | `sorrel-dev` | `jmuqtjbntiqmjmpenywl` | localhost (created 2026-10-15) |

Production was `evernestdb` until 2026-10-16. Go by the ref.

**The CLI's resting state is sorrel-dev. After any deliberate push to
production, relink to dev before ending the session.** A command meant for
production needs the link changed first, and that is my call, not yours.
Never relink on your own, and never add `supabase db push` to a permission
allowlist -- I run it myself, every time, for dev and production.

### Before every `supabase db push`

Run `supabase projects list` and state which project is linked, by ref, in
your reply, before running the push. Every single time, including when you
ran it ten minutes ago. The CLI's link is one global setting that persists
between sessions — the link from last week is the link today.

### Never run these

- `supabase db reset --linked` — destroys the remote database.
- `supabase config push` — overwrites remote auth settings that are not
  represented locally.

Ask me to do it in the dashboard instead.

### Before any destructive migration against production

Take a `pg_dump` backup first. Dumps live in `..\sorrel-backups\`, outside
the repo. They contain financial records and password hashes — never commit
one, never read one into context.

### .env.local

It points at `sorrel-dev` (`jmuqtjbntiqmjmpenywl`), as it must. Finding it
on production is a stop condition — tell me, don't work around it.

### Secrets

Never print, echo, or read the value of a secret key, database password, or
access token. Matt enters those himself.

### Timezone

Every calendar date means the user's day in `settings.timezone` (an IANA
name the browser reports through `TodayProvider`, updated when they travel;
null or a name Postgres doesn't know means UTC). The database applies it
per request: the `apply_user_timezone()` pre-request hook (migration 40)
sets the session TimeZone, so `current_date` and `timestamptz::date` casts
in SQL are the user's day -- inside an API request. App code never
reads the process clock for a date: the server uses `getToday()`, Client
Components `useToday()`, both derived from the same stored zone. Comparing
two `date` columns needs no zone; turning a `timestamptz` into a date, or a
date into an instant (start or end of a day), must name the user's zone
explicitly, as migration 48's backfill does, because migrations and the
service role run outside the hook, in UTC.

## Rules

- Every table holding user data must have Row Level Security enabled, with a
  policy scoping rows to `auth.uid()`. Never write a query that relies on
  client-side filtering for data isolation.
- The Supabase secret/`service_role` key is server-only. Never reference it in
  a Client Component or any file with `"use client"`.
- All database access goes through functions in `lib/` — pages and components
  never call Supabase directly.
- Money is never a float. In the database it is exact `numeric` dollars
  (`transactions.amount` is `numeric(12,2)`). Pure TypeScript calculations
  that must do arithmetic convert to integer cents internally and back to
  dollars only at the edges (see `lib/safeToSpendProjection.ts`).
- Foreign key columns in this schema have no underscore: `userid`, `accountid`,
  `categoryid`, `goalid`, `recurringid`. Never write `user_id`.
- `amount` is Postgres `numeric` (exact). Never do money arithmetic in
  JavaScript floats — aggregate in SQL, or use a decimal library. Display
  formatting only on the client.
- `transactions.amount` is always positive (`CHECK amount >= 0`). Direction
  comes from `transaction_type`, which is exactly `'Income'` or `'Expense'`
  (capitalized). Never sum `amount` directly.
- Use `signed_amount(amount, transaction_type)` for any signed money math —
  never hand-roll the Income/Expense `CASE`. It's `IMMUTABLE PARALLEL SAFE`,
  so it's safe in aggregates, indexes, and generated columns.
- Liability accounts (Credit Card, Loan) carry negative balances. `v_net_worth`
  depends on this. Collect a positive number from users and negate on write;
  display the absolute value with "owed". Never sum account balances as
  absolute values.

## Money rules — invariants

These have each caused a real bug. Do not relax one without asking.

**Confirmation gates transaction creation. It never gates the projection.**
Every expected income occurrence in the horizon appears in the safe-to-spend
projection whether or not it is confirmed — unconfirmed ones at the low end of
the amount estimate and the late edge of the date tolerance; confirmed ones at
their confirmed values. Obligations already project across the full horizon
without confirmation; income is symmetric with them.

**Auto-create outflows. Confirm inflows.**
Applies to writing rows into the ledger only. Never to forecasting.
Assuming money left when it didn't makes the user cautious; assuming money
arrived when it didn't makes them overspend.

**Uncertainty always pushes the forecast down.**
Income: low amount, late date. Obligations: high amount, early date.

**One "leaves the set" classifier, three consumers.**
Spendable Cash, the projection, and the cushion suggestion must all use the
same classifier (`lib/safeToSpend.ts`). Never reimplement it — they will drift.
The projection (`lib/safeToSpendProjection.ts`) uses it directly.
SQL can't call TypeScript, so SQL has twins: `is_spendable_account_type(type)`
(migration 47), the set itself, which `spendable_cash_balance()` (Spendable
Cash) filters on; and `leaves_spendable_set(from_type, to_type)`
(migration 45), built on it, which the cushion calls. Never write the set or
the rule inline in SQL; call those functions. `npm run test:parity` checks
both agree with the TS side on every account type and pair read from
`accounts_account_type_check`. Run it after changing either side or the
account types.
Checking→savings is NOT money leaving. Card purchases are NOT counted here;
the card payment obligation already captures them.

**Never discourage the user about spending.**
Forecast copy states facts, names days, names causes. No alarm language.

## Design language

Dark-first. Bold and confident (Cash App / Monzo), encouraging and
streak-driven (Duolingo). Playful in framing, precise in figures.

### Two colour systems, kept separate

**UI colour** — brand personality. Loud is fine.
**Data colour** — charts, meters, category dots. Validated, never ad hoc.

### Brand (chrome only — never in charts, meters, or status)

  brand gold        #E9B949    hover #F2C866    pressed #D4A32F
  Text on gold is ALWAYS dark ink (#0B0B0B). White on gold fails at 1.83:1.

### Surfaces (navy family, matching the logo)

  page plane        #131322
  card surface      #1B1B2F
  raised surface    #23233A
  hairline border   rgba(255,255,255,0.10)   dividers and cards only
  field border      #6d6d98 (light #8383a0)  every control edge -- inputs,
                    selects, chips. Use FIELD_EDGE / FIELD_CLASS from
                    components/ui/Input.tsx; never restate a field style.
  ink primary       #ffffff     secondary #c3c2b7     muted #8e8c86
  gridline          #2C2C42     baseline  #383850

The eight categorical data colours are re-validated against #1B1B2F and pass
all six checks unchanged. Do not re-step them.

Categorical slots, in this fixed order, never cycled:
  1 blue #3987e5   2 orange #d95926   3 aqua #199e70   4 yellow #c98500
  5 magenta #d55181   6 green #008300   7 violet #9085e9   8 red #e66767

Status (reserved — never used as a series colour):
  good #0ca30c   warning #fab219   serious #ec835a

Sequential (magnitude): one hue, blue, light to dark. Never a rainbow.

### The hard rule

Gold is brand chrome: logo, nav, primary buttons, splash. It never appears as
a data colour, a meter fill, or a status indicator — status warning #fab219 is
the same hue family, and separation depends entirely on gold staying out of
data contexts.

### Hard rules

- **Red never describes the user's money.**
  Never for negative amounts, over-budget states, low balances, shortfalls,
  spending levels, or any data value or status derived from someone's finances.

  Red is permitted in exactly three places:
    1. The Sorrel mark
    2. Destructive-action affordances — delete confirmations and irreversible
       operations
    3. Form validation errors and error banners

  Items 2 and 3 describe the INTERFACE. Item 1 is the brand. Anything that
  describes the user's money is out.
- Theme accents remain gold (dark) and navy (light).
- The mark's colour follows the surface it sits on, not the theme setting.
  Its two tokens are named for the ground: `--mark-on-dark`, `--mark-on-light`.
  A fixed-ground surface (the auth splash, the OG image) uses the matching one
  directly. Never add a per-location alias (`--splash-mark`, `--og-mark`).
- Text never wears a data colour. Values, labels and legends use ink tokens;
  a coloured dot beside the text carries identity.
- Status colour never appears alone — always icon + label too.
- Big standalone numbers use proportional figures. `tabular-nums` only in
  columns that must align vertically (table rows).
- Exactly one hero figure per view, >= 48px, same sans as everything else.
- Meters: fill carries severity (accent -> warning, never red); the unfilled
  track is a lighter step of the same hue, so state reads across the whole bar.
- Every animation respects `prefers-reduced-motion`.
- Motion uses one signature: the curve in `--icon-anim-ease` (globals.css),
  shared by the nav icon verbs and the dashboard flower's fold. Durations
  differ by job; the curve never does. The brand mark itself is static.
  A `var()` easing inside `@keyframes` is fine to write --
  `postcss/inline-keyframe-easing.cjs` inlines it, because Chrome would
  otherwise run it linear.
- When a shape has rotational symmetry, end a rotation on a multiple of
  it, so the reset to rest is invisible (the gear turns 45deg, not 60deg).
- A nav icon whose shape can't carry its verb gets the shared fallback,
  `.nav-icon--respond`, never nothing -- a still icon among moving ones
  reads as a missed click.
- Green marks income. Expenses and transfers use the theme accent. No colour
  in the app ever marks spending as negative.

### Voice

Second person, present tense, short. Encouraging, never scolding — over
budget is "let's look at this", not a red alarm. Celebrate specifics
("$240 toward Japan") not generics ("Great job!"). Never shame a user for
spending. Never use exclamation marks in anything showing a figure.

## Charts

Pick the form from the data's job, before any colour decision.

| The data is | Use | Never |
|---|---|---|
| One current value | Stat tile (value + delta + sparkline) | A one-bar bar chart |
| The number the page leads with | Hero figure, >=48px, exactly one per view | — |
| One ratio against a limit | Meter | A two-slice pie |
| Magnitude, low to high | Bar/column, sequential one hue | Categorical colour |
| Trend over time | Line; area for a single series | — |
| "This one moved" | Emphasis: one accent hue, rest grey | Categorical |
| More than ~7 classes | A table | More colours |

### Categories in charts (Sorrel-specific)

- Category charts aggregate by **category group** (11), not by category (57).
  Drilling into a group shows its categories.
- Use a sequential single hue for magnitude. `categories.color` is drawn from
  eight shared slots, so several categories carry the same colour -- stored
  colour is unusable as chart identity. It stays an identity dot in lists only.
- Exclude `is_active = false` categories from every chart. Business categories
  are off by default and shouldn't appear in a spending breakdown unless the
  user has enabled them.
  
### Theming
Charts read colours from CSS custom properties only -- never a hex literal in
a component. Both palettes are defined in globals.css; a chart written against
tokens themes itself.

Each theme has its own SELECTED palette. Light is not an inversion of dark:
each set is validated against its own surfaces. globals.css holds the
authoritative values (`--cat-*`, `--dk-cat-*`) and the measurements behind
them. This table mirrors it, so change both together:

  Categorical -- dark      Categorical -- light
  1 blue     #3987E5       1 blue     #1F5FB0
  2 orange   #D95926       2 orange   #B8431A
  3 aqua     #199E70       3 aqua     #0B8068
  4 yellow   #C98500       4 yellow   #96610A
  5 magenta  #D55181       5 magenta  #B03763
  6 green    #008300       6 green    #0A6B0A
  7 violet   #9085E9       7 violet   #6055C4
  8 red      #E66767       8 red      #C23F3F

  Chart chrome            dark            light       token
  page                    #131322         #ECECF2     --page
  surface                 #1B1B2F         #F8F8FB     --surface
  raised                  #23233A         #FFFFFF     --surface-raised
  gridline                #2C2C42         #D8D8E2     --gridline
  baseline                #383850         #C2C2D0     --baseline
  axis/label ink          #8E8C86         #67677A     --ink-muted

The light set passes all six validator checks on all three light grounds.
Every series is at least 4.15:1 there (aqua on --page is the lowest), so no
light series needs extra relief. Re-run the validator against --page,
--surface and --surface-raised before re-stepping any value.

Status colours differ by theme. Both sets are validated:
  dark   good #0CA30C · warning #FAB219 · serious #EC835A
  light  good #097009 · warning #A46609 · serious #A84718
Warning and serious always ship with icon + label.

### Hard rules
- NEVER a dual-axis chart. Two measures of different scale = two charts.
- Categorical hues in fixed slot order, never cycled. A 9th series folds into
  "Other" -- never a generated hue.
- Sequential = one hue, light to dark. Diverging = two hues + grey midpoint.
- Status colours are reserved. Never a series.
- Text never wears a data colour. Values and labels use ink tokens; a coloured
  mark beside them carries identity.
- Bars <=24px thick, 4px rounded data-end, square at the baseline. Lines 2px.
  Markers >=8px. Area fill ~10% opacity. Gridlines hairline, solid, recessive.
- 2px surface-colour gap between touching marks; 2px surface ring on dots.
  Never a border around a mark.
- Legend for >=2 series; none for one.
- Label selectively -- endpoint or extreme, never every point.
- All money renders through the shared <Amount> component.

### Interaction (not optional)
- Line/area: vertical crosshair snapping to nearest X, one tooltip listing
  every series at that X.
- Bar/cell: the mark is the hit target, it lifts on hover, its own tooltip.
- Hit targets larger than the mark. Keyboard focus shows the same tooltip.
- Tooltips enhance, never gate: every value also reachable via direct label
  or table view.
- Insert series/category names with `textContent`, never innerHTML.
- Filters in ONE row above everything, date range first, presets before custom.
  They scope every chart on the page. On refetch, charts hold their previous
  render at reduced opacity -- no skeleton, no layout jump.

## Repo layout

Its own git repo — `supabase/migrations/` and `lib/database.types.ts` live
here directly. `git log`/`git status` reflect this repo only.

## Shipping

Work is not shipped until it is on `main` and `main` has deployed. Vercel
builds `main` to mysorrel.com. One branch per batch, merged when that
batch's verification passes. Never accumulate more than one batch on a
branch.

## A page render never writes

Rendering a page must not create, update, or delete rows. Phase 7 found
three instances: recurring catch-up (`generateDueOccurrences()`) and
`record_login()`, both still called from `app/(app)/layout.tsx` and the
dashboard and to be removed, and a third the streak rebuild nearly added,
caught before it shipped. If a feature seems to need a write during render,
say so and stop — don't add it.

## Backend contract

The migrations in `supabase/migrations/` and `lib/database.types.ts` are the
authority on the schema. `~/evernest/DATABASE.md` (a separate repo, not an
ancestor directory) has useful background on schema conventions. It is older
than many migrations here (it still says transfers are unsupported), so
check anything taken from it against the migrations. The contract:

- Balances are computed, not stored — read from views (`v_account_balances`,
  `v_goal_progress`), never balance columns.
- Signup passes `first_name` (required) and, when given, `last_name` and
  `preferred_name` via `auth.signUp()`'s `options.data`. Signup collects
  nothing else -- no username, phone, or other personal data. Rules live in
  `lib/signupValidation.ts`, shared by the form and the server action.
- On signup, the `on_auth_user_created` trigger calls `handle_new_user()`
  (`AFTER INSERT ON auth.users`), which creates the `profiles` row, the
  `settings` row, and default `category_groups`/`categories`. App code must
  never insert into `profiles`/`settings`/`category_groups`/`categories`
  directly — the trigger owns them.
- A user's tier lives on `profiles.subscription_plan` /
  `subscription_status` — read it with `getPlan()` in `lib/db/profile.ts`.
  `handle_new_user()` and the service-role billing sync own those columns;
  they are not in the `authenticated` UPDATE grant.
- `subscriptions` holds Stripe billing records only — `stripe_customer_id`,
  `stripe_subscription_id` and `renewal_date` are all NOT NULL, so a row
  exists only once a user actually pays. It is empty until then, and that is
  correct, not a bug. Read it with `getStripeSubscription()`; a `null`
  result means "not a paying subscriber", a normal state.
- `subscriptions` is service_role-only: client code may `SELECT` it, never
  write to it (no INSERT/UPDATE/DELETE policy exists, and the grants are
  revoked for `authenticated`). Neither `profiles` tier columns nor
  `subscriptions` are writable by `authenticated`.
- Username login resolves server-side only (`email_for_username()` is
  `service_role`-only). The app has no username login yet, and signup
  collects no username. This is the rule for when it's built.
- `transaction_type` is only `Income`/`Expense`, but transfers ARE supported
  (migration 07): a transfer is two rows sharing a `transfer_group_id` -- an
  Expense leg on the source account, an Income leg on the destination, no
  category on either -- inserted together by `createTransfer()` in
  `lib/db/transactions.ts`. Every income/expense/spending aggregate must
  exclude rows where `transfer_group_id is not null`, or a transfer inflates
  both sides. Recurring transfers exist too (`recurring_transactions.to_accountid`).
- Accounts/categories are soft-deleted (`is_active`), never hard-deleted.
- Regenerate `lib/database.types.ts` after every migration (see "After any
  migration" below).

## After any migration

1. `npx supabase@latest db push`
2. `npx supabase@latest gen types --linked --lang typescript --schema public > lib/database.types.ts`
3. Commit both together

**Never run `supabase config push`.** It overwrites remote auth settings not
represented locally. Auth configuration lives in the Supabase dashboard and is
recorded in docs/supabase-config.md.

## Data layer rules

- All database access goes through `lib/db/*.ts`. Pages and components never
  call Supabase directly.
- FK columns have no underscore: userid, accountid, categoryid, goalid, recurringid.
- RLS scopes every query to the current user. Never add a userid filter as a
  security measure — it creates the illusion RLS is optional.
- But PostgREST requires an explicit filter on UPDATE and DELETE (error 21000).
  Always target the rows you mean, normally by primary key. Filter for intent,
  never for security.
- Use .maybeSingle() for any read that can legitimately return nothing. Reserve
  .single() for fetches by primary key where absence is genuinely an error.
- On INSERT, userid must be set explicitly from the server session
  (getClaims), never from client input.
- transactions.amount is always positive. Direction is transaction_type,
  exactly 'Income' or 'Expense'.
- A trigger requires transaction_type to match the category's category_type.
  Category pickers must filter by the selected type.
- Never aggregate money in JavaScript. Use the v_* views, or sum
  signed_amount(amount, transaction_type) in SQL.
- profiles: SELECT plus UPDATE on only first_name, last_name, username,
  phone, preferred_name, lastlogin, updated_at. Nothing else is writable —
  subscription_plan and subscription_status included.
- Never display a user's name or email ad hoc — resolve it through
  `lib/displayName.ts` (greeting vs sidebar identity). The full email is
  shown only in Settings.
- "Today" is the user's calendar day in `settings.timezone`, never the
  process clock's. Server code uses `getToday()` (`lib/db/settings.ts`);
  Client Components use `useToday()` (`components/TodayProvider.tsx`) --
  they also render on the server, where `new Date()` is UTC. SQL
  `current_date` is already the user's day: the `apply_user_timezone()`
  pre-request hook (migration 40) sets the session TimeZone per request.
  That hook runs on EVERY API request for every role -- anything that can
  make it raise takes the whole API down (migration 42).
- Never parse a bare `date` column with `new Date("YYYY-MM-DD")` (UTC
  midnight, renders as the previous day west of UTC) -- use
  `parseLocalDate()`; do calendar arithmetic with `addDaysISO()`.
- `bank_holidays` follows the Federal Reserve calendar: Sunday holidays
  are observed Monday, Saturday holidays are NOT observed Friday (the Fed
  is open). See migration 41.
- **A page render never writes.** Writes belong in server actions or
  scheduled work. Two known violations, to be removed, not copied:
  recurring catch-up (`generateDueOccurrences()`, from
  `app/(app)/layout.tsx` and the dashboard) and `record_login()` (every
  full page load and dashboard view). The streak rebuild nearly added a
  third. See `docs/phase-7-findings.md`.
- "First login" is decided when the session starts (`lib/auth/firstSession.ts`),
  never from `lastlogin`, which `record_login()` stamps on every request.
- Tier is profiles.subscription_plan / subscription_status, via getPlan().
  subscriptions is a separate table of Stripe billing records, read via
  getStripeSubscription(); it is empty until a user pays and null there
  means "not a paying subscriber", not an error.
- subscriptions: read-only for users. Billing state is service_role only.
- Never use the service role key in application code.
- Cross-user isolation is asserted by `docs/rls-isolation-test.sql` (two
  throwaway users, one transaction, rolled back). Run it after any change to
  tables, views, grants, policies or functions. There is no in-app test
  harness: `app/db-test/page.tsx` was deleted 2026-10-07 because it was
  deployed and wrote the visitor's real data. Never add a page that does.

## Recurring transactions

Generated automatically on the due date -- never prompted. The app has no bank
sync, so it cannot know a payment cleared; the trade is that generated rows are
obvious and trivially correctable rather than confirmed in advance.

- `transactions.recurringid` non-null means the row was generated from a
  schedule. Nothing else distinguishes them.
- Generated rows carry a small recurring icon in lists -- an icon, not a
  separate status or a different colour. They are normal transactions.
- Editing or deleting a generated transaction is unremarkable: no extra
  confirmation, no warning, no special path.
- When a user edits the AMOUNT on a generated transaction, offer once to update
  the schedule too ("Update the Rent schedule to $1,450?"). Declining leaves the
  schedule alone and is never asked again for that edit. This is what makes
  variable bills (utilities) workable. NOT BUILT YET: editing a generated
  transaction's amount doesn't offer this today.
- Deleting a schedule must NOT delete transactions already generated from it.
  `recurringid` is ON DELETE SET NULL; that history is real.

### Counting, and the safe-to-spend boundary
- Before its due date, a recurrence is a COMMITMENT: it appears in
  `v_upcoming_recurring` and is subtracted from safe-to-spend.
- On its due date it becomes a TRANSACTION: it leaves the commitments list and
  reduces the account balance instead.
- The money is counted exactly once. The hero number must NOT change at that
  boundary -- if it jumps, something is double-counting.

### Generation
- Lazy catch-up when a user opens the app. No scheduler. Today it runs
  from a render, a known violation of "A page render never writes".
- MUST be idempotent, enforced by a database constraint -- not by
  application logic. Two page loads must never create two rows. The unique
  index is `recurring_tx_no_double_post` on
  `(recurringid, transaction_date, transaction_type)` (migration 19). The
  type is in the key because both legs of a recurring transfer share an
  occurrence date.
