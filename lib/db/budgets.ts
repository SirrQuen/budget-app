import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

type BudgetRow = Database["public"]["Tables"]["budgets"]["Row"];
type BudgetInsert = Database["public"]["Tables"]["budgets"]["Insert"];
type BudgetUpdate = Database["public"]["Tables"]["budgets"]["Update"];
export type BudgetProgressRow = Database["public"]["Views"]["v_budget_vs_actual"]["Row"];

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

// One budget row per (userid, categoryid, budget_month) -- monthly,
// per-category envelopes, not a date range. budget_month is always
// normalized to the 1st of the month (budgets_month_is_first).
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
    return { data: null, error: error.message };
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
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export type CreateBudgetInput = Omit<BudgetInsert, "userid" | "id" | "created_at">;

export async function createBudget(
  input: CreateBudgetInput,
): Promise<DbResult<BudgetRow>> {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userid = claimsData?.claims?.sub;

  if (claimsError || !userid) {
    return {
      data: null,
      error: "Your session's expired. Log in again to pick up where you left off.",
    };
  }

  const { data, error } = await supabase
    .from("budgets")
    .insert({ ...input, userid })
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export type UpdateBudgetPatch = Omit<BudgetUpdate, "id" | "userid" | "created_at">;

export async function updateBudget(
  id: string,
  patch: UpdateBudgetPatch,
): Promise<DbResult<BudgetRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("budgets")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
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
    return { data: null, error: error.message };
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
    return { data: null, error: error.message };
  }

  return { data, error: null };
}
