import { requireUser } from "@/lib/auth/dal";
import { recordLogin } from "@/lib/db/profile";
import { getLoggingStreak } from "@/lib/db/dashboard";
import { listAccounts } from "@/lib/db/accounts";
import { listCategoriesForType } from "@/lib/db/categories";
import { getMostRecentTransactionAccountId } from "@/lib/db/transactions";
import { AppShell } from "@/components/app-shell/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, , streakResult, accountsResult, incomeCategoriesResult, expenseCategoriesResult, recentAccountResult] =
    await Promise.all([
      requireUser(),
      // Every authenticated route runs this layout, including the
      // email-confirmation redirect straight into /dashboard that never
      // touches lib/auth/actions.ts login() -- so the lastlogin
      // read-before-write has to happen here, not there. recordLogin is
      // request-cached, so DashboardPage re-reading it below is free.
      recordLogin(),
      getLoggingStreak(),
      listAccounts({ is_active: true }),
      listCategoriesForType("Income"),
      listCategoriesForType("Expense"),
      getMostRecentTransactionAccountId(),
    ]);

  // Nothing worth showing for a user who hasn't logged anything in the
  // streak window yet -- the badge would just read "0 days," which isn't
  // encouraging, it's a non-event.
  const streak =
    streakResult.data && (streakResult.data.current > 0 || streakResult.data.best > 0)
      ? streakResult.data
      : null;

  // Same graceful-degradation shape as streak -- a load failure here just
  // means no quick-add bar for this request, not a broken page.
  const quickAdd =
    accountsResult.data && incomeCategoriesResult.data && expenseCategoriesResult.data
      ? {
          accounts: accountsResult.data,
          incomeCategories: incomeCategoriesResult.data,
          expenseCategories: expenseCategoriesResult.data,
          defaultAccountId: recentAccountResult.data ?? null,
        }
      : null;

  return (
    <AppShell userEmail={user.email ?? "Signed in"} streak={streak} quickAdd={quickAdd}>
      {children}
    </AppShell>
  );
}
