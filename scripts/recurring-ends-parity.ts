// Runner for docs/recurring-ends-test.sql -- the database test of the
// recurring end rule (migration 79) and its parity with the TypeScript
// twin (lib/recurringEnds.ts).
//
//   npm run test:parity:ends
//   npm run test:parity:ends -- --with supabase/migrations/<file>.sql
//
// It evaluates the TS rule over a grid of cases -- every order of the
// next date against the end date (or none), every limit a scenario uses,
// 0..6 done -- and pastes the answers, with NON_BUSINESS_DAY_RULES, into
// the file's __TS_ENDS_RULE__ marker. The SQL compares them with
// recurring_is_finished() (P1), with every scenario's state (P2) and with
// the timing rules the database saves (R1). So the verdict is the file's
// own SUMMARY row: ALL PASS, or it isn't a pass.
//
// The CLI's default text output, with stdin, stdout and stderr all the
// terminal's: the test writes then rolls back, so the pinned CLI (3.x)
// asks before running it, and it can only ask in text output (with
// --output-format json it refuses -- HostedMutationConsentRequiredError,
// 2026-11-22). You see the Target line, check the ref, and answer. Never
// add --yes here.
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
// The whole dollar-quoted literal, so the mention in the header comment is not it.
const MARKER = "$ts$__TS_ENDS_RULE__$ts$";

// The same concrete dates the SQL's P1 uses for each order.
const NEXT = "2026-12-01";
const END_FOR: Record<string, string | null> = { "-1": "2026-12-02", "0": "2026-12-01", "1": "2026-11-30", null: null };

const cases = [null, -1, 0, 1].flatMap((rel) =>
  [null, 1, 2, 3, 5].flatMap((lim) =>
    [0, 1, 2, 3, 4, 5, 6].map((done) => {
      const end = {
        endDate: END_FOR[String(rel)],
        occurrencesRemaining: remainingOccurrences(lim, done),
      };
      return { rel, lim, done, finished: isFinished(end, NEXT), remaining: end.occurrencesRemaining };
    }),
  ),
);

const payload = JSON.stringify({ cases, rules: [...NON_BUSINESS_DAY_RULES] });

let sql = readFileSync(TEST_FILE, "utf8");
if (!sql.includes(MARKER)) {
  throw new Error(`${TEST_FILE} has no ${MARKER} marker`);
}
sql = sql.replace(MARKER, () => `$ts$${payload}$ts$`);

const withIndex = process.argv.indexOf("--with");
if (withIndex !== -1) {
  const migrationPath = process.argv[withIndex + 1];
  if (!migrationPath) {
    throw new Error("--with needs a migration file");
  }
  const migration = readFileSync(resolve(migrationPath), "utf8");
  // Directly after the test's own `begin;`, so the ROLLBACK undoes it too.
  // A function replacer: a string one would read the migration's `$$` as a pattern.
  sql = sql.replace(/^begin;$/m, () => `begin;\n\n${migration}\n`);
}

const dir = mkdtempSync(join(tmpdir(), "ends-parity-"));
const sqlPath = join(dir, "ends.sql");
writeFileSync(sqlPath, sql);

// sorrel-dev by REF, never the link: the link can point at production.
const DEV_REF = "tztbebdzlezlhvsbylsf";
console.log(`${cases.length} TS cases. The verdict is the SUMMARY row (the last row): ALL PASS, or not a pass.\n`);
const run = spawnSync(`npx supabase db query --remote=${DEV_REF} -f "${sqlPath}"`, {
  shell: true,
  stdio: "inherit",
});
rmSync(dir, { recursive: true, force: true });
process.exit(run.status ?? 1);
