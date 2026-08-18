"use server";

import { revalidatePath } from "next/cache";
import { createCategory, updateCategory, archiveCategory } from "@/lib/db/categories";
import type { TransactionType } from "@/lib/db/transactions";
import { CATEGORY_COLOR_SWATCHES, type CategoryColorValue } from "@/lib/categoryOptions";
import { CATEGORY_ICON_NAMES } from "@/components/ui/CategoryIcon";

export type ActionState = { error?: string } | undefined;

const VALID_TYPES = new Set<TransactionType>(["Income", "Expense"]);
const VALID_COLORS = new Set<string>(CATEGORY_COLOR_SWATCHES.map((s) => s.value));
const VALID_ICONS = new Set<string>(CATEGORY_ICON_NAMES);

type ParsedCategoryFields = {
  category_name: string;
  category_type: TransactionType;
  groupid: string;
  icon: string;
  color: CategoryColorValue;
};

// Shared by create and update -- both forms offer the exact same fields, so
// the guards (including the colour allowlist, see CATEGORY_COLOR_SWATCHES)
// only need to live in one place.
function parseCategoryFields(formData: FormData): ParsedCategoryFields | { error: string } {
  const category_name = String(formData.get("category_name") ?? "").trim();
  const category_type = String(formData.get("category_type") ?? "");
  const groupid = String(formData.get("groupid") ?? "");
  const icon = String(formData.get("icon") ?? "");
  const color = String(formData.get("color") ?? "");

  if (!category_name) {
    return { error: "Category name is required." };
  }
  if (!VALID_TYPES.has(category_type as TransactionType)) {
    return { error: "Choose Income or Expense." };
  }
  if (!groupid) {
    return { error: "Choose a group." };
  }
  if (!VALID_ICONS.has(icon)) {
    return { error: "Choose an icon." };
  }
  // Guards against a tampered request as much as a genuine misclick -- the
  // form itself only ever offers these eight swatches. categories.color
  // feeds charts directly, so an arbitrary hex slipping through here becomes
  // an unreadable chart later.
  if (!VALID_COLORS.has(color)) {
    return { error: "Choose one of the provided colours." };
  }

  return {
    category_name,
    category_type: category_type as TransactionType,
    groupid,
    icon,
    color: color as CategoryColorValue,
  };
}

export async function createCategoryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseCategoryFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  const { error } = await createCategory(parsed);

  if (error) {
    return { error };
  }

  revalidatePath("/categories");
}

export async function updateCategoryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) {
    return { error: "Missing category id." };
  }

  const parsed = parseCategoryFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  const { error } = await updateCategory(id, parsed);

  if (error) {
    return { error };
  }

  revalidatePath("/categories");
}

// Archives, never deletes -- transactions.categoryid is ON DELETE RESTRICT,
// so a hard delete of a used category fails at the database anyway. Callers
// should label this "Archive" in the UI, never "Delete", since past
// transactions keep referencing the category and its history survives.
export async function archiveCategoryAction(id: string): Promise<ActionState> {
  if (!id) {
    return { error: "Missing category id." };
  }

  const { error } = await archiveCategory(id);

  if (error) {
    return { error };
  }

  revalidatePath("/categories");
}
