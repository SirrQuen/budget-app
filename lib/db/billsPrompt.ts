import "server-only";
import { listAccounts } from "@/lib/db/accounts";
import { listCategoriesForType } from "@/lib/db/categories";
import { listGoalOptions } from "@/lib/db/goals";
import { getBankHolidays } from "@/lib/db/holidays";
import { isSpendableAccountType } from "@/lib/safeToSpend";
import type { BillsFormLists } from "@/app/(app)/dashboard/BillsPrompt";

// "Add your bills" (docs/Decide-and-Grow.md, G, addition): the lists the
// existing recurring form needs, read the way the recurring page reads
// them. null when a list it can't do without fails, or when there's no
// checking or cash account for a bill to come out of -- the bills aren't
// offered rather than offered broken. Reads only.
export async function getBillsFormLists(): Promise<BillsFormLists | null> {
  const [accounts, income, expense, goals, holidays] = await Promise.all([
    listAccounts({ is_active: true }),
    listCategoriesForType("Income"),
    listCategoriesForType("Expense"),
    listGoalOptions(),
    getBankHolidays(),
  ]);
  if (accounts.error !== null || income.error !== null || expense.error !== null) return null;
  const spendable = accounts.data.find((a) => isSpendableAccountType(a.account_type));
  if (!spendable) return null;
  return {
    incomeCategories: income.data,
    expenseCategories: expense.data,
    accounts: accounts.data,
    goals: goals.data ?? [],
    holidays: holidays.data ? Array.from(holidays.data) : [],
    defaultAccountId: spendable.id,
  };
}

/** The user's first account's created_at, archived accounts included; null with none or a failed read. */
export async function getFirstAccountCreatedAt(): Promise<string | null> {
  const all = await listAccounts();
  if (all.error !== null || all.data.length === 0) return null;
  return all.data.map((a) => a.created_at).filter((c): c is string => c !== null).sort()[0] ?? null;
}
