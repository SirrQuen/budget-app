// Runner for docs/leaves-spendable-set-parity.sql -- the parity test
// between the two "leaves the set" classifiers (isSafeToSpendCommitment
// here, leaves_spendable_set() in SQL). See that file's header.
//
//   npm run test:parity
//   npm run test:parity -- --with supabase/migrations/<file>.sql
//
// --with runs a migration inside the test's own transaction first, so a
// change to either classifier can be checked against the linked project
// before `db push`. Everything still ends in ROLLBACK.
//
// The TS answers are computed here from ACCOUNT_TYPES, never written out
// by hand: the SQL side compares ACCOUNT_TYPES with the database's
// accounts_account_type_check and fails if they differ.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ACCOUNT_TYPES } from "../lib/accountOptions";
import { SPENDABLE_ACCOUNT_TYPES, isSafeToSpendCommitment } from "../lib/safeToSpend";

const TEST_FILE = resolve(__dirname, "../docs/leaves-spendable-set-parity.sql");
// The whole dollar-quoted literal, so the mention in the header comment is not it.
const MARKER = "$ts$__TS_CLASSIFIER__$ts$";

type Case = { from: string; to: string | null; leaves: boolean };

const cases: Case[] = ACCOUNT_TYPES.flatMap((from) => [
  {
    from,
    to: null,
    leaves: isSafeToSpendCommitment({ transactionType: "Expense", fromAccountType: from, toAccountType: null }),
  },
  ...ACCOUNT_TYPES.map((to) => ({
    from,
    to,
    leaves: isSafeToSpendCommitment({ transactionType: "Transfer", fromAccountType: from, toAccountType: to }),
  })),
]);

const payload = JSON.stringify({
  account_types: [...ACCOUNT_TYPES],
  spendable_types: [...SPENDABLE_ACCOUNT_TYPES],
  cases,
});

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

const dir = mkdtempSync(join(tmpdir(), "parity-"));
const sqlPath = join(dir, "parity.sql");
writeFileSync(sqlPath, sql);

// One command string: npx needs a shell on Windows.
const run = spawnSync(`npx supabase@latest db query --linked -o json -f "${sqlPath}"`, {
  encoding: "utf8",
  shell: true,
});
rmSync(dir, { recursive: true, force: true });

if (run.status !== 0) {
  process.stderr.write(run.stderr || run.stdout);
  process.exit(run.status ?? 1);
}

type Row = { section: string; object: string; check: string; expected: string; actual: string; pass: boolean };
const rows: Row[] = JSON.parse(run.stdout.slice(run.stdout.indexOf("{"))).rows ?? [];
const failures = rows.filter((r) => r.pass !== true);

const bySection = new Map<string, { pass: number; fail: number }>();
for (const r of rows) {
  const s = bySection.get(r.section) ?? { pass: 0, fail: 0 };
  s[r.pass === true ? "pass" : "fail"] += 1;
  bySection.set(r.section, s);
}
for (const [section, s] of bySection) {
  console.log(`${section}: ${s.pass} pass, ${s.fail} fail`);
}

if (rows.length === 0) {
  console.error("No result rows -- the test did not run.");
  process.exit(1);
}
if (failures.length > 0) {
  console.error(`\n${failures.length} of ${rows.length} checks failed:`);
  console.table(failures);
  process.exit(1);
}
console.log(`\nAll ${rows.length} checks pass.`);
