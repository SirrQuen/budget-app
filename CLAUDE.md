# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Stack

Multi-user personal finance / budgeting app. Next.js 16 (App Router), TypeScript,
Tailwind v4, Supabase (Postgres + Auth). Currently a fresh `create-next-app`
scaffold — no data layer built yet. Path alias `@/*` -> project root.

## Commands

`npm run dev|build|start|lint`. No test runner configured yet.

## Rules

- Every table holding user data must have Row Level Security enabled, with a
  policy scoping rows to `auth.uid()`. Never write a query that relies on
  client-side filtering for data isolation.
- The Supabase secret/`service_role` key is server-only. Never reference it in
  a Client Component or any file with `"use client"`.
- All database access goes through functions in `lib/` — pages and components
  never call Supabase directly.
- Money is stored as integer cents, never floats.
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
  hairline border   rgba(255,255,255,0.10)
  ink primary       #ffffff     secondary #c3c2b7     muted #898781
  gridline          #2C2C42     baseline  #383850

The eight categorical data colours are re-validated against #1B1B2F and pass
all six checks unchanged. Do not re-step them.

Categorical slots, in this fixed order, never cycled:
  1 blue #3987e5   2 orange #d95926   3 aqua #199e70   4 yellow #c98500
  5 magenta #d55181   6 green #008300   7 violet #9085e9   8 red #e66767

Status (reserved — never used as a series colour):
  good #0ca30c   warning #fab219   serious #ec835a   critical #d03b3b

Sequential (magnitude): one hue, blue, light to dark. Never a rainbow.

### The hard rule

Gold is brand chrome: logo, nav, primary buttons, splash. It never appears as
a data colour, a meter fill, or a status indicator — status warning #fab219 is
the same hue family, and separation depends entirely on gold staying out of
data contexts.

### Hard rules

- Text never wears a data colour. Values, labels and legends use ink tokens;
  a coloured dot beside the text carries identity.
- Status colour never appears alone — always icon + label too.
- Big standalone numbers use proportional figures. `tabular-nums` only in
  columns that must align vertically (table rows).
- Exactly one hero figure per view, >= 48px, same sans as everything else.
- Meters: fill carries severity (accent -> warning -> critical); the unfilled
  track is a lighter step of the same hue, so state reads across the whole bar.
- Every animation respects `prefers-reduced-motion`.

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

### Categories in charts (EverNest-specific)

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

Dark mode is a SELECTED palette, not an inverted one. Both are validated
against their own surface:

  Categorical -- dark      Categorical -- light
  1 blue     #3987E5       1 blue     #2A78D6
  2 orange   #D95926       2 orange   #EB6834
  3 aqua     #199E70       3 aqua     #1BAF7A
  4 yellow   #C98500       4 yellow   #EDA100
  5 magenta  #D55181       5 magenta  #E87BA4
  6 green    #008300       6 green    #008300
  7 violet   #9085E9       7 violet   #4A3AA7
  8 red      #E66767       8 red      #E34948

  Chart chrome            dark            light
  surface                 #1B1B2F         #FBFAF7
  gridline                #2C2C42         #E1E0D9
  baseline                #383850         #C3C2B7
  axis/label ink          #898781         #52514E   <-- NOT #898781 in light;
                                                        it only reaches 3.44:1

Status colours are identical in both modes:
  good #0CA30C · warning #FAB219 · serious #EC835A · critical #D03B3B

In LIGHT mode, aqua, yellow and magenta fall below 3:1 on the surface. The
relief rule applies: those series MUST carry visible direct labels or a table
view. Same for warning and serious, which always ship with icon + label.

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

Not its own git repo — nested two levels inside `evernest/`, the actual git
root (`supabase/migrations/`, `src/types/database.ts`, `DATABASE.md` live
there). `git log`/`git status` here reflect the whole `evernest` repo, not
just this app.

## Backend contract

Read `../../DATABASE.md` before writing any query or signup flow:

- Balances are computed, not stored — read from views (`v_account_balances`,
  `v_goal_progress`), never balance columns.
- Signup must pass `first_name`/`last_name`/`username`/`phone` via
  `auth.signUp()`'s `options.data`.
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
  `service_role`-only).
- Only `Income`/`Expense` transaction types exist — transfers unsupported.
- Accounts/categories are soft-deleted (`is_active`), never hard-deleted.
- Regenerate `lib/database.types.ts` after every migration (see "After any
  migration" below).

## After any migration

1. `npx supabase@latest db push`
2. `npx supabase@latest gen types --linked --lang typescript --schema public > lib/database.types.ts`
3. Commit both together

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
  phone, lastlogin, updated_at. Nothing else is writable — subscription_plan
  and subscription_status included.
- Tier is profiles.subscription_plan / subscription_status, via getPlan().
  subscriptions is a separate table of Stripe billing records, read via
  getStripeSubscription(); it is empty until a user pays and null there
  means "not a paying subscriber", not an error.
- subscriptions: read-only for users. Billing state is service_role only.
- Never use the service role key in application code.
- The data layer test harness lives in git history — recover with
  `git checkout <commit> -- app/db-test`. Re-run it as two different users
  after any change to `lib/db/`.
