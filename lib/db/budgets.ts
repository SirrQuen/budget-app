import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { describeReadError, describeWriteError, sessionUserId } from "@/lib/db/errors";

type BudgetRow = Database["public"]["Tables"]["budgets"]["Row"];
type BudgetInsert = Database["public"]["Tables"]["budgets"]["Insert"];
export type BudgetProgressRow = Database["public"]["Views"]["v_budget_vs_actual"]["Row"];

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

// One budget row per (userid, categoryid, budget_month), enforced by
// budgets_one_per_category_month (migration 63). budget_month is always
// normalized to the 1st of the month (budgets_month_is_first). An amount
// is standing: a month without its own row for a category shows the most
// recent earlier one (getBudgetsForMonth), and nothing is written until
// the person edits.
//
// Write paths: createBudget (a category with no budget yet -- a second
// row for the same month is refused by the constraint) and
// setBudgetForMonth (change an amount, carried or not). There is no update
// that moves a row to another category or month; that was how two rows
// for one category and month could happen.
export type ListBudgetsOptions = {
  budget_month?: string;
  categoryid?: string;
};

export async function listBudgets(
  opts: ListBudgetsOptions = {},
): Promise<DbResult<BudgetRow[]>> {
  const supabase = await createClient();

  let query = supabase
    .from("budgets")
    .select("*")
    .order("budget_month", { ascending: false });

  if (opts.budget_month) {
    query = query.eq("budget_month", opts.budget_month);
  }
  if (opts.categoryid) {
    query = query.eq("categoryid", opts.categoryid);
  }

  const { data, error } = await query;

  if (error) {
    return { data: null, error: describeReadError(error, "budgets") };
  }

  return { data, error: null };
}

export async function getBudget(id: string): Promise<DbResult<BudgetRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("budgets")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    return { data: null, error: describeReadError(error, "budget") };
  }

  return { data, error: null };
}

export type CreateBudgetInput = Omit<BudgetInsert, "userid" | "id" | "created_at">;

export async function createBudget(
  input: CreateBudgetInput,
): Promise<DbResult<BudgetRow>> {
  const supabase = await createClient();

  const session = sessionUserId(await supabase.auth.getClaims(), "budget");
  if (session.userid === null) {
    return { data: null, error: session.error };
  }
  const { userid } = session;

  const { data, error } = await supabase
    .from("budgets")
    .insert({ ...input, userid })
    .select()
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "budget") };
  }

  return { data, error: null };
}

// Unlike accounts/categories, nothing references budgets.id by FK, so a
// hard delete is safe -- there's no history to preserve the way archived
// accounts/categories preserve past transactions.
export async function deleteBudget(id: string): Promise<DbResult<{ id: string }>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("budgets")
    .delete()
    .eq("id", id)
    .select("id")
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "budget") };
  }

  return { data, error: null };
}

export type GetBudgetProgressOptions = {
  budget_month?: string;
  categoryid?: string;
};

// Spent-vs-budgeted (actual_spend, remaining, pct_used, status) is
// computed entirely in v_budget_vs_actual -- never re-derive it from
// transactions in JS.
export async function getBudgetProgress(
  opts: GetBudgetProgressOptions = {},
): Promise<DbResult<BudgetProgressRow[]>> {
  const supabase = await createClient();

  let query = supabase
    .from("v_budget_vs_actual")
    .select("*")
    .order("budget_month", { ascending: false })
    .order("status_rank", { ascending: false });

  if (opts.budget_month) {
    query = query.eq("budget_month", opts.budget_month);
  }
  if (opts.categoryid) {
    query = query.eq("category_id", opts.categoryid);
  }

  const { data, error } = await query;

  if (error) {
    return { data: null, error: describeReadError(error, "budgets") };
  }

  return { data, error: null };
}

// One month's budgets, carried ones included (budget_progress_for_month,
// migration 63). A budget amount is standing: each category shows its own
// row for the month, else its most recent earlier one, with carried_from
// naming that month. Derived in SQL and written nowhere -- reading this
// creates no rows (CLAUDE.md "A page render never writes").
type MonthBudgetReturn = Database["public"]["Functions"]["budget_progress_for_month"]["Returns"][number];
// Generated types don't carry a RETURNS TABLE column's nullability. These
// two are null by design: budget_id when the amount is carried (no row
// this month), carried_from when it isn't; pct_used for a $0 budget.
export type MonthBudgetRow = Omit<MonthBudgetReturn, "budget_id" | "carried_from" | "pct_used"> & {
  budget_id: string | null;
  carried_from: string | null;
  pct_used: number | null;
};

export async function getBudgetsForMonth(month: string): Promise<DbResult<MonthBudgetRow[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("budget_progress_for_month", { p_month: month })
    .order("status_rank", { ascending: false })
    .order("category_name", { ascending: true });

  if (error) {
    return { data: null, error: describeReadError(error, "budgets") };
  }

  return { data, error: null };
}

// The one write for an amount: this category, this month. Creates the
// month's row when the amount was carried (no row yet), updates it when
// there is one -- one row, never the other categories, which keep
// carrying on their own. Keyed on budgets_one_per_category_month
// (migration 63), so a double submit or two tabs can't make a second row.
export async function setBudgetForMonth(input: {
  categoryid: string;
  budget_month: string;
  budget_amount: number;
}): Promise<DbResult<BudgetRow>> {
  const supabase = await createClient();

  const session = sessionUserId(await supabase.auth.getClaims(), "budget");
  if (session.userid === null) {
    return { data: null, error: session.error };
  }

  const { data, error } = await supabase
    .from("budgets")
    .upsert({ ...input, userid: session.userid }, { onConflict: "userid,budget_month,categoryid" })
    .select()
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "budget") };
  }

  return { data, error: null };
}
