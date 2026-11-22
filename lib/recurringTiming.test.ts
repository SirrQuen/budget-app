import { test } from "node:test";
import assert from "node:assert/strict";
import { NEAREST_DIRECTIONS, TIMING_MODES, parseTiming } from "./recurringTiming";
import { NON_BUSINESS_DAY_RULES, resolveDueDate } from "./businessDays";

// The form, the TypeScript cadence and the database agree on ONE set of
// non_business_day_rule values (migration 79). The database's side --
// each value saves, nothing else does -- is docs/recurring-ends-test.sql,
// checked against NON_BUSINESS_DAY_RULES by npm run test:parity:ends.

const everyChoice = TIMING_MODES.flatMap((mode) => NEAREST_DIRECTIONS.map((direction) => ({ mode, direction })));

test("every timing choice the form offers writes a rule in the one set", () => {
  for (const { mode, direction } of everyChoice) {
    const t = parseTiming(mode, direction, "2");
    assert.ok(!("error" in t), `${mode}/${direction}`);
    assert.ok(NON_BUSINESS_DAY_RULES.includes(t.non_business_day_rule), `${mode}/${direction}: ${t.non_business_day_rule}`);
  }
});

test("every rule in the set is reachable from the form", () => {
  const written = new Set(
    everyChoice.map(({ mode, direction }) => {
      const t = parseTiming(mode, direction, "2");
      return "error" in t ? null : t.non_business_day_rule;
    }),
  );
  assert.deepEqual([...written].sort(), [...NON_BUSINESS_DAY_RULES].sort());
});

test("earlier / later are before / after, and the cadence moves a weekend date by them", () => {
  const before = parseTiming("nearest", "earlier", "");
  const afterRule = parseTiming("nearest", "later", "");
  assert.deepEqual(before, { business_day_offset: 0, non_business_day_rule: "before" });
  assert.deepEqual(afterRule, { business_day_offset: 0, non_business_day_rule: "after" });
  // 2026-11-28 is a Saturday.
  assert.equal(resolveDueDate("2026-11-28", 0, "before", new Set()), "2026-11-27");
  assert.equal(resolveDueDate("2026-11-28", 0, "after", new Set()), "2026-11-30");
  assert.equal(resolveDueDate("2026-11-28", 0, "none", new Set()), "2026-11-28");
});

test("an offset, and what isn't offered, are refused or kept to 'none'", () => {
  assert.deepEqual(parseTiming("after", "", "3"), { business_day_offset: 3, non_business_day_rule: "none" });
  assert.ok("error" in parseTiming("after", "", "11"));
  assert.ok("error" in parseTiming("nearest", "forward", ""));
  assert.ok("error" in parseTiming("sideways", "", ""));
  assert.deepEqual(parseTiming("exact", "later", ""), { business_day_offset: 0, non_business_day_rule: "none" });
});
