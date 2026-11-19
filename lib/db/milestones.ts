import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { describeReadError } from "@/lib/db/errors";
import type { DbResult } from "@/lib/db/dashboard";
import { getTimeZone, getToday } from "@/lib/db/settings";
import { requireUser } from "@/lib/auth/dal";
import {
  earned,
  LOG_THRESHOLDS,
  logMilestoneId,
  milestoneLabel,
  sortEarned,
  timeMilestones,
  type EarnedMilestone,
  type MilestoneId,
} from "@/lib/milestones";

// Lifetime milestones, derived on read (lib/milestones.ts). Read-only: counts
// and dates of rows that already exist, nothing stored, no SQL of its own.
//
// Two readers, one set of facts:
//   getEarnedMilestoneIds()  which are earned -- the dashboard. Three
//                            queries (log count, imports, goals), nothing
//                            per milestone.
//   getEarnedMilestones()    the same set WITH dates -- Settings > Your
//                            Sorrel only. Adds one query per earned log
//                            threshold, for that log's created_at.

// A LOG is a transaction a person made: hand-logged or confirmed from the
// queue, never imported, a transfer counted once (its Expense leg). The same
// rule as month_story() (migration 71), so the recap and this agree.
function logsQuery(supabase: SupabaseClient<Database>) {
  return supabase
    .from("transactions")
    .select("id, created_at", { count: "exact" })
    .is("import_id", null)
    .or("transfer_group_id.is.null,transaction_type.eq.Expense")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
}

async function logCount(): Promise<DbResult<number>> {
  const { count, error } = await logsQuery(await createClient()).limit(1);
  if (error) return { data: null, error: describeReadError(error, "milestones") };
  return { data: count ?? 0, error: null };
}

/** The nth log (1-based), oldest first. */
async function nthLog(n: number): Promise<DbResult<{ id: string; created_at: string } | null>> {
  const { data, error } = await logsQuery(await createClient()).range(n - 1, n - 1);
  if (error) return { data: null, error: describeReadError(error, "milestones") };
  return { data: data[0] ?? null, error: null };
}

type Facts = {
  timeZone: string | null;
  today: string;
  /** When the account was created -- the signed-in user, already resolved by the layout (no query). */
  createdAt: string;
  count: number;
  firstImportAt: string | null;
  /** Every goal, archived ones included: setting one is a thing that happened. */
  goalCreated: string[];
  goalCompleted: string[];
};

async function readFacts(): Promise<DbResult<Facts>> {
  const supabase = await createClient();
  const [timeZone, today, user, count, firstImport, goals] = await Promise.all([
    getTimeZone(),
    getToday(),
    requireUser(),
    logCount(),
    supabase.from("imports").select("created_at").order("created_at", { ascending: true }).limit(1),
    supabase.from("goals").select("created_at, completed_at"),
  ]);
  if (count.error !== null) return { data: null, error: count.error };
  if (firstImport.error) return { data: null, error: describeReadError(firstImport.error, "milestones") };
  if (goals.error) return { data: null, error: describeReadError(goals.error, "milestones") };

  return {
    data: {
      timeZone,
      today,
      createdAt: user.created_at,
      count: count.data,
      firstImportAt: firstImport.data[0]?.created_at ?? null,
      goalCreated: goals.data.map((g) => g.created_at).sort(),
      goalCompleted: goals.data.flatMap((g) => (g.completed_at ? [g.completed_at] : [])).sort(),
    },
    error: null,
  };
}

function earnedIds(f: Facts): MilestoneId[] {
  const ids: MilestoneId[] = timeMilestones(f.createdAt, f.today, f.timeZone).map((m) => m.id);
  for (const t of LOG_THRESHOLDS) {
    const id = logMilestoneId(t);
    if (id !== null && t <= f.count) ids.push(id);
  }
  if (f.firstImportAt !== null) ids.push("first-import");
  if (f.goalCreated.length > 0) ids.push("first-goal");
  if (f.goalCompleted.length > 0) ids.push("first-goal-reached");
  return ids;
}

/** Which milestones are earned -- no dates. The dashboard's read: nothing per milestone. */
export async function getEarnedMilestoneIds(): Promise<DbResult<{ id: MilestoneId; label: string }[]>> {
  const facts = await readFacts();
  if (facts.error !== null) return { data: null, error: facts.error };
  return { data: earnedIds(facts.data).map((id) => ({ id, label: milestoneLabel(id) })), error: null };
}

/** Every milestone earned so far, with its date, oldest first. Settings > Your Sorrel only. */
export async function getEarnedMilestones(): Promise<DbResult<EarnedMilestone[]>> {
  const facts = await readFacts();
  if (facts.error !== null) return { data: null, error: facts.error };
  const f = facts.data;

  const list: EarnedMilestone[] = [...timeMilestones(f.createdAt, f.today, f.timeZone)];
  for (const t of LOG_THRESHOLDS.filter((n) => n <= f.count)) {
    const id = logMilestoneId(t);
    const row = await nthLog(t);
    if (id === null || row.error !== null) continue;
    list.push(...earned(id, row.data?.created_at ?? null, f.timeZone));
  }
  list.push(...earned("first-import", f.firstImportAt, f.timeZone));
  list.push(...earned("first-goal", f.goalCreated[0] ?? null, f.timeZone));
  list.push(...earned("first-goal-reached", f.goalCompleted[0] ?? null, f.timeZone));

  return { data: sortEarned(list), error: null };
}

/**
 * The log milestone a save just crossed: the one whose Nth log is among the
 * rows it created. A save adds at most two rows (a transfer), so only the
 * thresholds in the last few counts are asked. A failure is silence.
 */
export async function logMilestoneCrossedBy(savedIds: string[]): Promise<{ id: MilestoneId; label: string } | null> {
  try {
    const count = await logCount();
    if (count.error !== null) return null;
    for (const t of LOG_THRESHOLDS) {
      if (t > count.data || t <= count.data - savedIds.length - 1) continue;
      const row = await nthLog(t);
      const id = logMilestoneId(t);
      if (id !== null && row.data !== null && savedIds.includes(row.data.id)) return { id, label: milestoneLabel(id) };
    }
    return null;
  } catch {
    return null;
  }
}
