import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import type { TransactionType } from "@/lib/db/transactions";
import { describeReadError, describeWriteError } from "@/lib/db/errors";

type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];
type CategoryInsert = Database["public"]["Tables"]["categories"]["Insert"];
type CategoryUpdate = Database["public"]["Tables"]["categories"]["Update"];
type CategoryGroupRow = Database["public"]["Tables"]["category_groups"]["Row"];

export type CategoryWithGroup = CategoryRow & {
  group_name: string | null;
};

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

export type ListCategoriesOptions = {
  category_type?: TransactionType;
  is_active?: boolean;
};

// Joining by alias here (not by ordering the referenced table at the DB
// level) because PostgREST only lets a referenced-table order() affect the
// parent row order when the embed is `!inner` -- simpler and more
// predictable to sort the small in-memory list ourselves.
const CATEGORY_SELECT = "*, group:category_groups(name, sort_order)";

type RawCategoryRow = CategoryRow & {
  group: { name: string; sort_order: number } | null;
};

function flatten(row: RawCategoryRow): CategoryWithGroup {
  const { group, ...rest } = row;
  return {
    ...rest,
    group_name: group?.name ?? null,
  };
}

function sortByGroupThenName(rows: RawCategoryRow[]): RawCategoryRow[] {
  return [...rows].sort((a, b) => {
    const groupOrderDiff = (a.group?.sort_order ?? 0) - (b.group?.sort_order ?? 0);
    if (groupOrderDiff !== 0) {
      return groupOrderDiff;
    }
    return a.category_name.localeCompare(b.category_name);
  });
}

export async function listCategories(
  opts: ListCategoriesOptions = {},
): Promise<DbResult<CategoryWithGroup[]>> {
  const supabase = await createClient();

  let query = supabase.from("categories").select(CATEGORY_SELECT);

  if (opts.category_type) {
    query = query.eq("category_type", opts.category_type);
  }
  if (opts.is_active !== undefined) {
    query = query.eq("is_active", opts.is_active);
  }

  const { data, error } = await query.returns<RawCategoryRow[]>();

  if (error) {
    return { data: null, error: describeReadError(error, "categories") };
  }

  return { data: sortByGroupThenName(data).map(flatten), error: null };
}

// What the transaction form's category dropdown calls: active categories
// for the type the user already picked, so enforce_category_type (the DB
// trigger requiring transaction_type == category.category_type) can never
// fire from a normal form submission.
export async function listCategoriesForType(
  type: TransactionType,
): Promise<DbResult<CategoryWithGroup[]>> {
  return listCategories({ category_type: type, is_active: true });
}

export async function getCategory(id: string): Promise<DbResult<CategoryWithGroup>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("categories")
    .select(CATEGORY_SELECT)
    .eq("id", id)
    .single()
    .returns<RawCategoryRow>();

  if (error) {
    return { data: null, error: describeReadError(error, "category") };
  }

  return { data: flatten(data), error: null };
}

export type CreateCategoryInput = Omit<
  CategoryInsert,
  "userid" | "id" | "created_at"
> & {
  category_type: TransactionType;
};

export async function createCategory(
  input: CreateCategoryInput,
): Promise<DbResult<CategoryRow>> {
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
    .from("categories")
    .insert({ ...input, userid })
    .select()
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "category") };
  }

  return { data, error: null };
}

export type UpdateCategoryPatch = Omit<CategoryUpdate, "id" | "userid" | "created_at">;

export async function updateCategory(
  id: string,
  patch: UpdateCategoryPatch,
): Promise<DbResult<CategoryRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("categories")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "category") };
  }

  return { data, error: null };
}

// Categories are soft-deleted only. transactions.categoryid is
// ON DELETE RESTRICT, so a hard delete of a used category fails at the
// database anyway -- this is the only supported way to retire one.
export async function archiveCategory(id: string): Promise<DbResult<CategoryRow>> {
  return updateCategory(id, { is_active: false });
}

export async function listCategoryGroups(): Promise<DbResult<CategoryGroupRow[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("category_groups")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    return { data: null, error: describeReadError(error, "categories") };
  }

  return { data, error: null };
}
