import "server-only";
import { createClient } from "@/lib/supabase/server";
import { describeReadError } from "@/lib/db/errors";
import { parseMonthStory, type MonthStory } from "@/lib/monthStory";

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

/**
 * The month recap's figures for the month `monthStart` falls in
 * (month_story(), migration 71). Read-only. Every amount is summed in SQL;
 * nothing here adds money up. A row in an unexpected shape is reported as
 * an error, so the recap is left out rather than shown wrong.
 */
export async function getMonthStory(monthStart: string): Promise<DbResult<MonthStory>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("month_story", { p_month: monthStart });
  if (error) {
    return { data: null, error: describeReadError(error, "dashboard") };
  }
  const row = Array.isArray(data) ? data[0] : null;
  const story = row ? parseMonthStory(row) : null;
  if (story === null) {
    console.error("[month story] unexpected month_story() row");
    return { data: null, error: "We couldn’t load your month." };
  }
  return { data: story, error: null };
}
