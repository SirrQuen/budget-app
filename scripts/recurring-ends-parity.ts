// Runner for docs/recurring-ends-test.sql -- the database test of the
// recurring end rule (migration 79) plus parity with its TypeScript twin.
//
//   npm run test:parity:ends
//   npm run test:parity:ends -- --with supabase/migrations/<file>.sql
//
// The SQL file passes on its own when its SUMMARY row says ALL PASS. This
// runner also takes every 'state' row -- a schedule's raw end fields after
// a scenario, and the SQL answer, recurring_is_finished() and
// recurring_occurrences_remaining() -- and recomputes both with
// lib/recurringEnds.ts. Any disagreement fails, so the two rules can't
// drift. It also checks that the non_business_day_rule values the
// database saves are exactly NON_BUSINESS_DAY_RULES (migration 79).
//
// --with runs a migration inside the test's own transaction first, so the
// rule can be checked on sorrel-dev before `db push`. Everything still
// ends in ROLLBACK.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isFinished, remainingOccurrences } from "../lib/recurringEnds";
import { NON_BUSINESS_DAY_RULES } from "../lib/businessDays";

const TEST_FILE = resolve(__dirname, "../docs/recurring-ends-test.sql");

let sql = readFileSync(TEST_FILE, "utf8");

const withIndex = process.argv.indexOf("--with");
if (withIndex !== -1) {
  const migrationPath = process.argv[withIndex + 1];
  if (!migrationPath) {
    throw new Error("--with needs a migration file");
  }
  const migration = readFileSync(resolve(migrationPath), "utf8");
  // Directly after the test's own `begin;`, so the ROLLBACK undoes it too.
  sql = sql.replace(/^begin;$/m, () => `begin;\n\n${migration}\n`);
}

const dir = mkdtempSync(join(tmpdir(), "ends-parity-"));
const sqlPath = join(dir, "ends.sql");
writeFileSync(sqlPath, sql);

// Same terms as scripts/leaves-spendable-set-parity.ts: sorrel-dev by REF,
// the CLI's confirmation on the terminal (you read the Target line and
// answer), only stdout captured. Never add --yes here.
const DEV_REF = "tztbebdzlezlhvsbylsf";
const run = spawnSync(`npx supabase db query --remote=${DEV_REF} --output-format json -f "${sqlPath}"`, {
  encoding: "utf8",
  shell: true,
  stdio: ["inherit", "pipe", "inherit"],
});
rmSync(dir, { recursive: true, force: true });

if (run.status !== 0) {
  process.stderr.write(run.stdout ?? "");
  process.exit(run.status ?? 1);
}

type Row = {
  scenario: string;
  consumer: string;
  expected: string;
  actual: string;
  pass: boolean;
  next_run_date: string | null;
  end_date: string | null;
  occurrence_limit: number | null;
  occurrences_done: number | string | null;
  sql_finished: boolean | null;
  sql_remaining: number | string | null;
};
const rows: Row[] = JSON.parse(run.stdout.slice(run.stdout.indexOf("{"))).rows ?? [];

const summary = rows.find((r) => r.scenario === "SUMMARY");
if (!summary) {
  console.error("No SUMMARY row -- the test errored or stopped early. Not a pass.");
  process.exit(1);
}
console.log(`docs/recurring-ends-test.sql: ${summary.consumer}, ${summary.expected}, ${summary.actual}`);

const asNumber = (v: number | string | null) => (v === null ? null : Number(v));
const date = (v: string | null) => (v === null ? null : v.slice(0, 10));

const disagreements = rows
  .filter((r) => r.consumer === "state")
  .flatMap((r) => {
    const end = {
      endDate: date(r.end_date),
      occurrencesRemaining: remainingOccurrences(r.occurrence_limit, asNumber(r.occurrences_done) ?? 0),
    };
    const tsFinished = isFinished(end, date(r.next_run_date)!);
    const sqlRemaining = asNumber(r.sql_remaining);
    return tsFinished === r.sql_finished && end.occurrencesRemaining === sqlRemaining
      ? []
      : [{ scenario: r.scenario, sql_finished: r.sql_finished, ts_finished: tsFinished, sql_remaining: sqlRemaining, ts_remaining: end.occurrencesRemaining }];
  });
const stateRows = rows.filter((r) => r.consumer === "state").length;

console.log(`parity: ${stateRows} state rows, ${disagreements.length} disagree`);
if (disagreements.length > 0) {
  console.table(disagreements);
}

const ruleRow = rows.find((r) => r.consumer === "rule-values");
const tsRules = [...NON_BUSINESS_DAY_RULES].sort().join(",");
const rulesAgree = ruleRow !== undefined && ruleRow.actual === tsRules;
console.log(`timing rules: database saves ${ruleRow?.actual ?? "<no row>"}, NON_BUSINESS_DAY_RULES is ${tsRules}`);

if (stateRows === 0 || disagreements.length > 0 || !rulesAgree || summary.actual !== "ALL PASS") {
  if (summary.actual !== "ALL PASS") console.table(rows.filter((r) => r.pass === false));
  console.error("\nNOT PASSED");
  process.exit(1);
}
console.log("\nALL PASS");
