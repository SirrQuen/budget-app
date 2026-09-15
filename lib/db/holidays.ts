import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { describeReadError } from "@/lib/db/errors";

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

// bank_holidays is shared reference data (no userid column -- see
// 20260914000025_25_bank_holidays.sql), ~110 rows covering 2026-2035, so
// this fetches the whole table rather than windowing by date. cache()'d
// per request the same way getSettings() is -- lib/db/recurring.ts's
// generateDueOccurrences and lib/db/dashboard.ts's getSafeToSpend can both
// ask without a second round trip.
export const getBankHolidays = cache(async (): Promise<DbResult<Set<string>>> => {
  const supabase = await createClient();

  const { data, error } = await supabase.from("bank_holidays").select("date");

  if (error) {
    return { data: null, error: describeReadError(error, "holiday calendar") };
  }

  return { data: new Set(data.map((row) => row.date)), error: null };
});
