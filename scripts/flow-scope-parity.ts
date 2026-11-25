// Runner for docs/flow-scope-test.sql -- the database test of the Income and
// Spending tiles' scope: v_daily_cashflow (what the tile sums) against the
// drill-down's read (lib/transactionFilters.ts, listReadOptions).
//
//   npm run test:parity:flow
//
// It takes, from the TypeScript, what the app itself would read for October
// 2026 at 23:30 on the 31st in each fixture user's zone, and pastes that into
// the file's __TS_FLOW_SCOPES__ marker. The SQL builds the fixtures, adds up
// both sides and compares. The verdict is the file's own SUMMARY row: ALL
// PASS, or it isn't a pass.
//
// The test writes then rolls back, so it isn't --read-only and the CLI asks
// for confirmation: Matt runs it, reads the Target line and answers. Never
// add --yes here.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { todayInZone } from "../lib/date";
import { flowScope, listReadOptions, periodSpan, type Flow } from "../lib/transactionFilters";

const TEST_FILE = resolve(__dirname, "../docs/flow-scope-test.sql");
const MARKER = "$ts$__TS_FLOW_SCOPES__$ts$";
const PERIOD = "2026-10";

// 23:30 on 31 October, local, in each zone (New York is UTC-4, Auckland UTC+13).
const USERS = [
  { user: "ny", zone: "America/New_York", instant: "2026-11-01T03:30:00Z" },
  { user: "akl", zone: "Pacific/Auckland", instant: "2026-10-31T10:30:00Z" },
];

const scopes = USERS.flatMap(({ user, zone, instant }) => {
  const today = todayInZone(zone, new Date(instant));
  return (["income", "spending"] as Flow[]).map((flow) => {
    const read = listReadOptions({ flow, period: PERIOD }, today);
    return {
      user,
      zone,
      instant,
      flow,
      column: flowScope(flow, periodSpan(PERIOD, today)).column,
      type: read.transaction_type,
      date_from: read.dateFrom,
      date_to: read.dateTo,
      exclude_transfers: read.excludeTransfers === true,
    };
  });
});

let sql = readFileSync(TEST_FILE, "utf8");
if (!sql.includes(MARKER)) {
  throw new Error(`${TEST_FILE} has no ${MARKER} marker`);
}
sql = sql.replace(MARKER, () => `$ts$${JSON.stringify(scopes)}$ts$`);

const dir = mkdtempSync(join(tmpdir(), "flow-parity-"));
const sqlPath = join(dir, "flow.sql");
writeFileSync(sqlPath, sql);

// sorrel-dev by REF, never the link: the link can point at production.
const DEV_REF = "tztbebdzlezlhvsbylsf";
console.log("The verdict is the SUMMARY row (the last row): ALL PASS, or not a pass.\n");
const run = spawnSync(`npx supabase db query --remote=${DEV_REF} -f "${sqlPath}"`, {
  shell: true,
  stdio: "inherit",
});
rmSync(dir, { recursive: true, force: true });
process.exit(run.status ?? 1);
